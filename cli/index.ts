#!/usr/bin/env bun
import { parseCliOptions } from "./parse-options";
import { startCommand } from "./commands/start";
import { resumeCommand } from "./commands/resume";
import { attachCommand } from "./commands/attach";
import { stopCommand } from "./commands/stop";
import { statusCommand } from "./commands/status";
import { listCommand } from "./commands/list";

export { parseCliOptions } from "./parse-options";

function printHelp(): void {
  console.log(`ralphx v0.1.0 — AI-powered task runner

Usage: ralphx <command> [options]

Commands:
  start    Start a new run from a plan and tasks file
  resume   Resume a previously stopped or blocked run
  attach   Attach to a running detached session
  stop     Stop a running session
  status   Show the status of a run
  list     List all runs

Options:
  --plan <path>              Path to plan file (default: PLAN.md)
  --tasks <path>             Path to tasks file (default: tasks.json)
  --runtime <name>           Runtime to use: "claude-code" or "codex" (default: codex)
  --team <path>              Path to team configuration file
  --model <model>            Model to use for the runtime
  --retry <n>               Max retry attempts per task (default: 3)
  --timeout <ms>            Timeout per task in milliseconds (default: 600000)
  --heartbeat-interval <ms> Heartbeat interval in milliseconds (default: 30000)
  --run <id>                Specify a run ID (for resume/attach/stop/status)
  --no-tui                  Disable the TUI, use plain text output
  --detached                Run in detached mode (background)
  --skip-quality-gates      Skip quality gate checks
  --allow-dirty             Allow starting with uncommitted changes
  --dry-run                 Preview what would happen without executing

Examples:
  ralphx start                          Start with defaults
  ralphx start --plan my-plan.md        Start with a custom plan
  ralphx start --runtime claude-code    Start using claude-code runtime
  ralphx status                         Show current run status
  ralphx list                           List all runs
  ralphx stop --run <id>                Stop a specific run`);
}

async function main(): Promise<void> {
  const options = parseCliOptions(Bun.argv.slice(2));

  switch (options.command) {
    case "help":
      printHelp();
      break;
    case "start":
      await startCommand(options);
      break;
    case "resume":
      await resumeCommand(options);
      break;
    case "attach":
      await attachCommand(options);
      break;
    case "stop":
      await stopCommand(options);
      break;
    case "status":
      await statusCommand(options);
      break;
    case "list":
      await listCommand(options);
      break;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
