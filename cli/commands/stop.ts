import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { RunnerOptions } from "../../state/types";
import { getRalphxDir } from "../../state/run-state";

export async function stopCommand(options: RunnerOptions): Promise<void> {
  if (!options.runId) {
    throw new Error("--run <run-id> is required for stop");
  }

  const rootDir = process.cwd();
  const ralphxDir = getRalphxDir(rootDir);
  const runDir = resolve(ralphxDir, options.runId);
  const pidPath = resolve(runDir, "daemon.pid");

  let pid: number;
  try {
    const pidStr = await readFile(pidPath, "utf8");
    pid = parseInt(pidStr.trim(), 10);
  } catch {
    throw new Error(
      `No daemon PID file found for run ${options.runId}. Is it running?`,
    );
  }

  try {
    process.kill(pid, 0); // Check if alive
  } catch {
    console.log(`Daemon (PID ${pid}) is not running.`);
    return;
  }

  console.log(`Sending SIGTERM to daemon (PID ${pid})...`);
  process.kill(pid, "SIGTERM");

  // Wait for graceful shutdown
  let attempts = 0;
  while (attempts < 10) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      process.kill(pid, 0);
      attempts += 1;
    } catch {
      console.log("Daemon stopped gracefully.");
      return;
    }
  }

  console.log("Daemon did not stop in 10s. Force killing...");
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already dead
  }
  console.log("Daemon killed.");
}
