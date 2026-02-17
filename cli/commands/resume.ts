import { resolve } from "node:path";
import type { RunnerOptions } from "../../state/types";
import { getRalphxDir } from "../../state/run-state";
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

  console.log(`Resuming RalphX run ${state.runId} on branch ${state.branch}`);

  try {
    await executeOrchestrator({
      rootDir,
      state,
      statePath,
      document,
      runtime,
      eventBus,
      model: options.model,
      streamOutput: !options.noTui,
      skipQualityGates: options.skipQualityGates,
      timeout: options.timeout,
    });
  } finally {
    heartbeat.stop();
    watchdog.stop();
  }

  console.log(
    `\nRalphX run ${state.runId} finished with status: ${state.status}`,
  );
  if (state.status === "blocked") {
    console.log(`Handoff: ${state.handoffPath}`);
  }
}
