import { resolve } from "node:path";
import type { RunnerOptions } from "../../state/types";
import { getRalphxDir, loadRunState } from "../../state/run-state";

export async function statusCommand(options: RunnerOptions): Promise<void> {
  if (!options.runId) {
    throw new Error("--run <run-id> is required for status");
  }

  const rootDir = process.cwd();
  const ralphxDir = getRalphxDir(rootDir);
  const runDir = resolve(ralphxDir, options.runId);
  const statePath = resolve(runDir, "state.json");

  const state = await loadRunState(statePath);

  console.log(`Run: ${state.runId}`);
  console.log(`Status: ${state.status}`);
  console.log(`Branch: ${state.branch}`);
  console.log(`Runtime: ${state.defaultRuntime}`);
  console.log(`Created: ${state.createdAt}`);
  console.log(`Updated: ${state.updatedAt}`);
  console.log(`Retry Limit: ${state.retryLimit}`);

  const totalTasks = state.tasks.length;
  const passed = state.tasks.filter((t) => t.status === "passed").length;
  const failed = state.tasks.filter((t) => t.status === "failed").length;
  const blocked = state.tasks.filter((t) => t.status === "blocked").length;
  const pending = state.tasks.filter((t) => t.status === "pending").length;
  const running = state.tasks.filter((t) => t.status === "running").length;

  console.log(
    `\nProgress: ${passed}/${totalTasks} passed, ${running} running, ${pending} pending, ${failed} failed, ${blocked} blocked`,
  );

  console.log(`\nPhases:`);
  for (const phase of state.phases) {
    console.log(`  ${phase.id} [${phase.status}] ${phase.name}`);
  }

  console.log(`\nTasks:`);
  for (const task of state.tasks) {
    const commit = task.lastCommit
      ? ` commit:${task.lastCommit.slice(0, 7)}`
      : "";
    const error = task.lastError ? `\n    Error: ${task.lastError}` : "";
    const attempts = task.attempts > 0 ? ` (attempt ${task.attempts})` : "";
    console.log(
      `  ${task.id} [${task.status}] ${task.title}${attempts}${commit}${error}`,
    );
  }
}
