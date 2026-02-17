import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TasksDocument } from "../state/types";

/**
 * Load the tasks document from the sources directory (copied at start).
 */
export async function loadTasksFromSources(
  sourcesDir: string,
): Promise<TasksDocument> {
  const raw = await readFile(join(sourcesDir, "tasks.json"), "utf8");
  return JSON.parse(raw) as TasksDocument;
}

/**
 * Load the plan from the sources directory.
 */
export async function loadPlanFromSources(sourcesDir: string): Promise<string> {
  return readFile(join(sourcesDir, "PLAN.md"), "utf8");
}

/**
 * Get the plan path pointing to the sources copy (for agent prompts).
 */
export function getSourcesPlanPath(sourcesDir: string): string {
  return join(sourcesDir, "PLAN.md");
}

/**
 * Get the tasks path pointing to the sources copy (for agent prompts).
 */
export function getSourcesTasksPath(sourcesDir: string): string {
  return join(sourcesDir, "tasks.json");
}

/**
 * Mark a task as "done" in the sources/tasks.json file.
 * This persists completion status so that a fresh `start` with the same
 * file skips already-completed tasks.
 */
export async function markTaskDoneInSources(
  sourcesDir: string,
  taskId: string,
): Promise<void> {
  const tasksPath = join(sourcesDir, "tasks.json");
  const raw = await readFile(tasksPath, "utf8");
  const doc = JSON.parse(raw) as TasksDocument;

  for (const phase of doc.phases) {
    for (const task of phase.tasks) {
      if (task.id === taskId) {
        task.status = "done";
      }
    }
  }

  await writeFile(tasksPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}
