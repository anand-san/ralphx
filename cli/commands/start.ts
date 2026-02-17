import { resolve, join } from "node:path";
import { writeFile, open } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { RunnerOptions, TasksDocument } from "../../state/types";
import type { TeamConfig } from "../../config/types";
import { tasksDocumentSchema, teamConfigSchema } from "../../config/schema";
import { readFile } from "node:fs/promises";
import {
  buildRunId,
  buildRunPaths,
  copySourceFiles,
  createInitialRunState,
  ensureRunDirectories,
  saveRunState,
} from "../../state/run-state";
import {
  createRunBranch,
  currentBranch,
  ensureCleanWorkingTree,
  ensureGitRepo,
  hasChanges,
} from "../../git/operations";
import { getEventBus } from "../../monitor/event-bus";
import { registerDefaultAgents } from "../../agents/register-defaults";
import { ClaudeCodeProvider } from "../../runtime/providers/claude-code";
import { CodexProvider } from "../../runtime/providers/codex";
import { executeOrchestrator } from "../../orchestrator/orchestrator";
import { HeartbeatMonitor } from "../../monitor/heartbeat";
import { Watchdog } from "../../monitor/watchdog";

async function loadTasksDocument(path: string): Promise<TasksDocument> {
  const raw = await readFile(path, "utf8");
  const json = JSON.parse(raw) as unknown;
  return tasksDocumentSchema.parse(json);
}

function printDryRun(document: TasksDocument): void {
  for (const phase of document.phases) {
    console.log(`${phase.id} | ${phase.name}`);
    for (const task of phase.tasks) {
      console.log(`  - ${task.id} [${task.status}] ${task.title}`);
    }
  }
}

export async function startCommand(options: RunnerOptions): Promise<void> {
  const rootDir = process.cwd();

  await ensureGitRepo(rootDir);

  const planPath = resolve(options.planPath);
  const tasksPath = resolve(options.tasksPath);
  const teamPath = options.teamPath ? resolve(options.teamPath) : undefined;

  const document = await loadTasksDocument(tasksPath);

  if (options.dryRun) {
    printDryRun(document);
    return;
  }

  if (!options.allowDirty) {
    await ensureCleanWorkingTree(rootDir);
  }

  // Initialize
  const runId = buildRunId();
  const paths = buildRunPaths(rootDir, runId);
  const branch = await createRunBranch(runId, rootDir);

  const state = createInitialRunState({
    runId,
    branch,
    retryLimit: options.retry,
    defaultRuntime: options.runtime,
    teamConfigPath: teamPath,
    paths,
    tasksDocument: document,
  });

  await ensureRunDirectories(state);
  await copySourceFiles({
    sourcesDir: paths.sourcesDir,
    planPath,
    tasksPath,
    teamPath,
  });
  await saveRunState(paths.statePath, state);

  // Event bus
  const eventBus = getEventBus();
  eventBus.setEventsPath(paths.eventsPath);

  // Register agents
  registerDefaultAgents();

  // Select runtime
  const runtime =
    options.runtime === "codex"
      ? new CodexProvider()
      : new ClaudeCodeProvider();

  const available = await runtime.isAvailable();
  if (!available) {
    throw new Error(
      `Runtime "${options.runtime}" is not available. Ensure the CLI is installed and in PATH.`,
    );
  }

  // Load team config
  let teamConfig: TeamConfig | undefined;
  if (teamPath) {
    const teamRaw = await readFile(teamPath, "utf8");
    teamConfig = teamConfigSchema.parse(JSON.parse(teamRaw) as unknown);
  }

  // Monitoring
  const heartbeat = new HeartbeatMonitor({
    eventBus,
    state,
    intervalMs: options.heartbeatInterval,
    defaultTimeout: options.timeout,
  });
  const watchdog = new Watchdog({ eventBus, state });

  heartbeat.start();
  watchdog.start();

  // Detached mode: spawn daemon child and exit parent
  if (options.detached && !options._daemon) {
    const logPath = join(paths.runDir, "daemon.log");
    const logFd = await open(logPath, "w");
    const logStream = logFd.createWriteStream();

    // Build child args: same args minus --detached, plus --_daemon
    const childArgs = process.argv
      .slice(1)
      .filter((a) => a !== "--detached")
      .concat("--_daemon");

    const child = spawn(process.argv[0]!, childArgs, {
      stdio: ["ignore", logStream, logStream],
      detached: true,
      cwd: rootDir,
    });
    child.unref();

    await writeFile(paths.pidPath, String(child.pid), "utf8");
    console.log(`RalphX daemon started (PID ${child.pid})`);
    console.log(`Run ID: ${runId}`);
    console.log(`Log: ${logPath}`);
    console.log(`Attach: ralphx attach --run ${runId}`);
    process.exit(0);
  }

  // Daemon child: ignore SIGHUP so it survives terminal close
  if (options._daemon) {
    process.on("SIGHUP", () => {});
    await writeFile(paths.pidPath, String(process.pid), "utf8");
  }

  if (!options._daemon) {
    console.log(`RalphX run ${runId} started on branch ${branch}`);
    console.log(`Runtime: ${options.runtime}`);
    console.log(`Retry limit: ${options.retry}`);
  }

  const onSignal = async (signal: "SIGTERM" | "SIGINT") => {
    state.status = "blocked";
    await saveRunState(paths.statePath, state);
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
      statePath: paths.statePath,
      document,
      runtime,
      eventBus,
      model: options.model,
      streamOutput: !options.noTui,
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

  // Report result
  console.log(`\nRalphX run ${runId} finished with status: ${state.status}`);
  console.log(`State: ${paths.statePath}`);
  if (state.status === "blocked") {
    console.log(`Handoff: ${state.handoffPath}`);
  }
}
