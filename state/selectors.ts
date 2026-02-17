import type { RunState, TaskRuntimeState } from "./types";

export function getTaskState(
  state: RunState,
  phaseId: string,
  taskId: string,
): TaskRuntimeState {
  const found = state.tasks.find(
    (task) => task.id === taskId && task.phaseId === phaseId,
  );
  if (!found) {
    throw new Error(`Task runtime state not found for ${phaseId}/${taskId}`);
  }
  return found;
}

export function getPhaseState(
  state: RunState,
  phaseId: string,
): RunState["phases"][number] {
  const found = state.phases.find((phase) => phase.id === phaseId);
  if (!found) {
    throw new Error(`Phase runtime state not found for ${phaseId}`);
  }
  return found;
}

export function getPendingTasks(state: RunState): TaskRuntimeState[] {
  return state.tasks.filter((t) => t.status === "pending");
}

export function getRunningTasks(state: RunState): TaskRuntimeState[] {
  return state.tasks.filter((t) => t.status === "running");
}

export function getCompletedTasks(state: RunState): TaskRuntimeState[] {
  return state.tasks.filter((t) => t.status === "passed");
}

export function getBlockedTasks(state: RunState): TaskRuntimeState[] {
  return state.tasks.filter((t) => t.status === "blocked");
}

export function isPhaseComplete(state: RunState, phaseId: string): boolean {
  const phaseTasks = state.tasks.filter((t) => t.phaseId === phaseId);
  return phaseTasks.every((t) => t.status === "passed");
}

export function isRunComplete(state: RunState): boolean {
  return state.phases.every((p) => p.status === "completed");
}
