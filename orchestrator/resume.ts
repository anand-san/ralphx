import { readDecisions } from "./decision-log";
import { loadRunState } from "../state/run-state";
import { loadTasksFromSources } from "./planner";
import type { Decision, RunState, TasksDocument } from "../state/types";
import { join } from "node:path";

export interface ResumeContext {
  state: RunState;
  document: TasksDocument;
  decisions: Decision[];
  statePath: string;
}

/**
 * Load everything needed to resume a run from .ralphx/<run-id>/.
 * Reads from sources/ (not original paths) so resume works even if
 * the user deleted the original plan/tasks files.
 */
export async function loadResumeContext(
  runDir: string,
): Promise<ResumeContext> {
  const statePath = join(runDir, "state.json");
  const state = await loadRunState(statePath);

  const document = await loadTasksFromSources(state.sourcesDir);
  const decisions = await readDecisions(state.decisionsDir);

  return { state, document, decisions, statePath };
}
