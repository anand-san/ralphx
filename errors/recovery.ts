import type { FailureCategory } from "../state/types";
import { ERROR_CATEGORIES } from "./categories";

export type RecoveryStrategy =
  | "planner_decides"
  | "escalate_to_em"
  | "block_and_handoff";

export function getRecoveryStrategy(
  category: FailureCategory,
  attemptsSoFar: number,
): RecoveryStrategy {
  const info = ERROR_CATEGORIES[category];

  if (!info.recoverable) {
    return "block_and_handoff";
  }

  if (attemptsSoFar >= info.maxRetries) {
    return "escalate_to_em";
  }

  // All other strategies delegate to the planner, which can already
  // decide to retry the same agent, try a different agent, provide
  // additional context, etc.
  return "planner_decides";
}

export function isRecoverable(
  category: FailureCategory,
  attemptsSoFar: number,
): boolean {
  const info = ERROR_CATEGORIES[category];
  return info.recoverable && attemptsSoFar < info.maxRetries;
}
