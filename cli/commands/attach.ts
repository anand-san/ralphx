import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { RunnerOptions } from "../../state/types";
import { getRalphxDir, loadRunState } from "../../state/run-state";

export async function attachCommand(options: RunnerOptions): Promise<void> {
  if (!options.runId) {
    throw new Error("--run <run-id> is required for attach");
  }

  const rootDir = process.cwd();
  const ralphxDir = getRalphxDir(rootDir);
  const runDir = resolve(ralphxDir, options.runId);
  const statePath = resolve(runDir, "state.json");
  const eventsPath = resolve(runDir, "events.jsonl");
  const pidPath = resolve(runDir, "daemon.pid");

  // Check if daemon is running
  let daemonPid: number | null = null;
  try {
    const pidStr = await readFile(pidPath, "utf8");
    daemonPid = parseInt(pidStr.trim(), 10);
    // Check if process is alive
    try {
      process.kill(daemonPid, 0);
      console.log(`Attached to running daemon (PID ${daemonPid})`);
    } catch {
      console.log(`Daemon (PID ${daemonPid}) is no longer running`);
      daemonPid = null;
    }
  } catch {
    console.log("No daemon PID file found — viewing completed/interrupted run");
  }

  // Load state for display
  const state = await loadRunState(statePath);
  console.log(`\nRun: ${state.runId}`);
  console.log(`Status: ${state.status}`);
  console.log(`Branch: ${state.branch}`);
  console.log(`Runtime: ${state.defaultRuntime}`);

  // Show phases
  console.log(`\nPhases:`);
  for (const phase of state.phases) {
    console.log(`  ${phase.id} [${phase.status}] ${phase.name}`);
  }

  // Show tasks
  console.log(`\nTasks:`);
  for (const task of state.tasks) {
    const commit = task.lastCommit ? ` (${task.lastCommit.slice(0, 7)})` : "";
    const error = task.lastError ? ` — ${task.lastError}` : "";
    console.log(`  ${task.id} [${task.status}] ${task.title}${commit}${error}`);
  }

  // Tail events file for live updates
  if (daemonPid) {
    console.log(`\nTailing events (Ctrl+C to detach)...`);
    let lastLineCount = 0;

    // Show recent events first
    try {
      const eventsContent = await readFile(eventsPath, "utf8");
      const lines = eventsContent.trim().split("\n").filter(Boolean);
      const recent = lines.slice(-10);
      for (const line of recent) {
        try {
          const event = JSON.parse(line) as {
            type: string;
            ts: string;
            message?: string;
          };
          console.log(
            `  [${event.ts}] ${event.type}${event.message ? `: ${event.message}` : ""}`,
          );
        } catch {
          // Skip malformed lines
        }
      }
      lastLineCount = lines.length;
    } catch {
      console.log("  (no events yet)");
    }

    // Poll for new events
    const poll = setInterval(async () => {
      try {
        const content = await readFile(eventsPath, "utf8");
        const lines = content.trim().split("\n").filter(Boolean);
        const newLines = lines.slice(lastLineCount);
        lastLineCount = lines.length;
        for (const line of newLines) {
          try {
            const event = JSON.parse(line) as {
              type: string;
              ts: string;
              message?: string;
            };
            console.log(
              `  [${event.ts}] ${event.type}${event.message ? `: ${event.message}` : ""}`,
            );
          } catch {
            // Skip malformed lines
          }
        }

        // Check if daemon is still alive
        try {
          process.kill(daemonPid!, 0);
        } catch {
          console.log("\nDaemon process has exited.");
          clearInterval(poll);
          process.exit(0);
        }
      } catch {
        // File not ready yet
      }
    }, 1000);

    // Keep process alive until Ctrl+C
    process.on("SIGINT", () => {
      clearInterval(poll);
      console.log("\nDetached.");
      process.exit(0);
    });
    await new Promise(() => {}); // Block forever
  }
}
