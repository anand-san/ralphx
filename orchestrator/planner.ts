import { readFile } from "node:fs/promises";
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
