import type { RunState, TaskRuntimeState, PlanPhase } from "../state/types";
import { getPhaseState, isPhaseComplete } from "../state/selectors";

/**
 * Find the next task to work on. Follows phase order, then task order within phases.
 * Returns null if no task is available (all done or all blocked).
 */
export function findNextTask(
  state: RunState,
  phases: PlanPhase[],
): { task: TaskRuntimeState; phase: PlanPhase } | null {
  for (const phase of phases) {
    const phaseState = getPhaseState(state, phase.id);
    if (phaseState.status === "completed") continue;

    // Find first non-completed task in this phase
    for (const planTask of phase.tasks) {
      const taskState = state.tasks.find(
        (t) => t.id === planTask.id && t.phaseId === phase.id,
      );
      if (!taskState) continue;
      if (taskState.status === "passed" || taskState.status === "blocked") {
        continue;
      }
      return { task: taskState, phase };
    }

    // If we reach here, all tasks in this phase are either passed or blocked
    // Check if phase should be marked as blocked
    const hasBlocked = state.tasks.some(
      (t) => t.phaseId === phase.id && t.status === "blocked",
    );
    if (hasBlocked && !isPhaseComplete(state, phase.id)) {
      return null; // Phase is blocked
    }
  }
  return null;
}

/**
 * Check if the entire run should be considered complete.
 */
export function isRunFinished(state: RunState, phases: PlanPhase[]): boolean {
  return phases.every((phase) => isPhaseComplete(state, phase.id));
}

/**
 * Check if the run is blocked (has blocked tasks preventing progress).
 */
export function isRunBlocked(state: RunState): boolean {
  const hasBlockedTask = state.tasks.some((t) => t.status === "blocked");
  const hasPendingOrRunning = state.tasks.some(
    (t) => t.status === "pending" || t.status === "running",
  );
  return hasBlockedTask && !hasPendingOrRunning;
}
