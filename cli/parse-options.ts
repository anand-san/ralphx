import type { RunnerOptions, RuntimeName } from "../state/types";

function parseNumber(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric value for ${flag}: ${value}`);
  }
  return parsed;
}

export function parseCliOptions(argv: string[]): RunnerOptions {
  const command = argv[0];
  if (
    command !== "start" &&
    command !== "resume" &&
    command !== "attach" &&
    command !== "stop" &&
    command !== "status" &&
    command !== "list"
  ) {
    throw new Error(
      "Usage: ralphx <start|resume|attach|stop|status|list> [options]",
    );
  }

  let planPath = "PLAN.md";
  let tasksPath = "tasks.json";
  let runtime: RuntimeName = "codex";
  let runtimeExplicit = false;
  let teamPath: string | undefined;
  let retry = 3;
  let timeout = 600000;
  let heartbeatInterval = 30000;
  let noTui = false;
  let detached = false;
  let _daemon = false;
  let model: string | undefined;
  let skipQualityGates = false;
  let allowDirty = false;
  let dryRun = false;
  let runId: string | undefined;

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];

    // Boolean flags
    if (arg === "--no-tui") {
      noTui = true;
      continue;
    }
    if (arg === "--detached") {
      detached = true;
      noTui = true;
      continue;
    }
    if (arg === "--skip-quality-gates") {
      skipQualityGates = true;
      continue;
    }
    if (arg === "--allow-dirty") {
      allowDirty = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--_daemon") {
      _daemon = true;
      noTui = true;
      continue;
    }

    // Key-value flags
    const next = argv[i + 1];
    if (!next) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--plan") {
      planPath = next;
    } else if (arg === "--tasks") {
      tasksPath = next;
    } else if (arg === "--runtime") {
      if (next !== "claude-code" && next !== "codex") {
        throw new Error(
          `Invalid runtime: ${next}. Must be "claude-code" or "codex".`,
        );
      }
      runtime = next;
      runtimeExplicit = true;
    } else if (arg === "--team") {
      teamPath = next;
    } else if (arg === "--retry") {
      retry = parseNumber(next, arg);
    } else if (arg === "--timeout") {
      timeout = parseNumber(next, arg);
    } else if (arg === "--heartbeat-interval") {
      heartbeatInterval = parseNumber(next, arg);
    } else if (arg === "--model") {
      model = next;
    } else if (arg === "--run") {
      runId = next;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
    i += 1;
  }

  if (command === "start" && retry < 0) {
    throw new Error("--retry must be >= 0");
  }

  return {
    command,
    planPath,
    tasksPath,
    runtime,
    runtimeExplicit,
    teamPath,
    retry,
    timeout,
    heartbeatInterval,
    noTui,
    detached,
    _daemon,
    model,
    skipQualityGates,
    allowDirty,
    dryRun,
    runId,
  };
}
