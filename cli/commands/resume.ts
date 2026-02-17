import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { RunnerOptions } from "../../state/types";
import type { TeamConfig } from "../../config/types";
import { teamConfigSchema } from "../../config/schema";
import { getRalphxDir, saveRunState } from "../../state/run-state";
import { loadResumeContext } from "../../orchestrator/resume";
import {
  currentBranch,
  checkoutBranch,
  ensureCleanWorkingTree,
  ensureGitRepo,
} from "../../git/operations";
import { getEventBus } from "../../monitor/event-bus";
import { registerDefaultAgents } from "../../agents/register-defaults";
import { ClaudeCodeProvider } from "../../runtime/providers/claude-code";
import { CodexProvider } from "../../runtime/providers/codex";
import { executeOrchestrator } from "../../orchestrator/orchestrator";
import { HeartbeatMonitor } from "../../monitor/heartbeat";
import { Watchdog } from "../../monitor/watchdog";
import { renderTui } from "../../tui/app";

export async function resumeCommand(options: RunnerOptions): Promise<void> {
  const rootDir = process.cwd();

  if (!options.runId) {
    throw new Error("--run <run-id> is required for resume");
  }

  await ensureGitRepo(rootDir);

  if (!options.allowDirty) {
    await ensureCleanWorkingTree(rootDir);
  }

  const ralphxDir = getRalphxDir(rootDir);
  const runDir = resolve(ralphxDir, options.runId);

  const { state, document, statePath } = await loadResumeContext(runDir);

  // Ensure we're on the right branch
  const branch = await currentBranch(rootDir);
  if (branch !== state.branch) {
    console.log(`Switching to branch ${state.branch}...`);
    await checkoutBranch(state.branch, rootDir);
  }

  // Reset blocked status for retry
  if (state.status === "blocked") {
    state.status = "running";
    for (const task of state.tasks) {
      if (task.status === "blocked") {
        task.status = "pending";
      }
    }
    for (const phase of state.phases) {
      if (phase.status === "blocked") {
        phase.status = "in_progress";
      }
    }
  }

  // Load team config
  let teamConfig: TeamConfig | undefined;
  if (state.teamConfigPath) {
    try {
      const teamRaw = await readFile(state.teamConfigPath, "utf8");
      teamConfig = teamConfigSchema.parse(JSON.parse(teamRaw) as unknown);
    } catch {
      // Team config may have been removed; continue with defaults
    }
  }

  // Event bus
  const eventBus = getEventBus();
  eventBus.setEventsPath(state.eventsPath);

  registerDefaultAgents();

  const runtime =
    state.defaultRuntime === "codex"
      ? new CodexProvider()
      : new ClaudeCodeProvider();

  const available = await runtime.isAvailable();
  if (!available) {
    throw new Error(`Runtime "${state.defaultRuntime}" is not available.`);
  }

  const heartbeat = new HeartbeatMonitor({
    eventBus,
    state,
    intervalMs: options.heartbeatInterval,
    defaultTimeout: options.timeout,
  });
  const watchdog = new Watchdog({ eventBus, state });

  heartbeat.start();
  watchdog.start();

  if (!options.noTui) {
    renderTui({ initialState: state, eventBus });
  } else {
    console.log(`Resuming RalphX run ${state.runId} on branch ${state.branch}`);
  }

  const onSignal = async (signal: "SIGTERM" | "SIGINT") => {
    state.status = "blocked";
    await saveRunState(statePath, state);
    heartbeat.stop();
    watchdog.stop();
    await eventBus.emit({
      type: "run:blocked",
      ts: new Date().toISOString(),
      runId: state.runId,
      details: `Run interrupted by ${signal}`,
    });
    process.exit(signal === "SIGTERM" ? 143 : 130);
  };
  process.on("SIGTERM", () => void onSignal("SIGTERM"));
  process.on("SIGINT", () => void onSignal("SIGINT"));

  try {
    await executeOrchestrator({
      rootDir,
      state,
      statePath,
      document,
      runtime,
      eventBus,
      model: options.model,
      streamOutput: !!options.noTui,
      skipQualityGates: options.skipQualityGates,
      timeout: options.timeout,
      teamConfig,
    });
  } finally {
    heartbeat.stop();
    watchdog.stop();
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
  }

  const finalStatus = state.status as string;
  console.log(
    `\nRalphX run ${state.runId} finished with status: ${finalStatus}`,
  );
  if (finalStatus === "blocked") {
    console.log(`Handoff: ${state.handoffPath}`);
  }
}
