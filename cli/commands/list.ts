import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RunnerOptions, RunState } from "../../state/types";
import { getRalphxDir } from "../../state/run-state";

export async function listCommand(_options: RunnerOptions): Promise<void> {
  const rootDir = process.cwd();
  const ralphxDir = getRalphxDir(rootDir);

  let entries: string[];
  try {
    entries = await readdir(ralphxDir);
  } catch {
    console.log("No .ralphx/ directory found. No runs yet.");
    return;
  }

  const runs: Array<{
    runId: string;
    status: string;
    branch: string;
    runtime: string;
    created: string;
    updated: string;
    taskCount: number;
    passedCount: number;
  }> = [];

  for (const entry of entries) {
    if (entry === ".gitignore") continue;
    const statePath = resolve(ralphxDir, entry, "state.json");
    try {
      const raw = await readFile(statePath, "utf8");
      const state = JSON.parse(raw) as RunState;
      runs.push({
        runId: state.runId,
        status: state.status,
        branch: state.branch,
        runtime: state.defaultRuntime,
        created: state.createdAt,
        updated: state.updatedAt,
        taskCount: state.tasks.length,
        passedCount: state.tasks.filter((t) => t.status === "passed").length,
      });
    } catch {
      // Skip entries without valid state
    }
  }

  if (runs.length === 0) {
    console.log("No runs found.");
    return;
  }

  // Sort by creation date, newest first
  runs.sort(
    (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime(),
  );

  console.log("RalphX Runs:");
  console.log("─".repeat(80));
  for (const run of runs) {
    const progress = `${run.passedCount}/${run.taskCount}`;
    console.log(
      `  ${run.runId}  [${run.status}]  ${progress} tasks  ${run.runtime}  branch:${run.branch}`,
    );
    console.log(`    created: ${run.created}  updated: ${run.updated}`);
  }
}
