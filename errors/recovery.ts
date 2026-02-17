import type { FailureCategory } from "../state/types";
import { ERROR_CATEGORIES } from "./categories";

export type RecoveryStrategy =
  | "retry_same_agent"
  | "retry_with_context"
  | "auto_fix_retry"
  | "escalate_to_em"
  | "try_alternate_runtime"
  | "block_and_handoff";

export function getRecoveryStrategy(
  category: FailureCategory,
  attemptsSoFar: number,
): RecoveryStrategy {
  const info = ERROR_CATEGORIES[category];

  if (attemptsSoFar >= info.maxRetries) {
    return info.recoverable ? "escalate_to_em" : "block_and_handoff";
  }

  switch (category) {
    case "runtime_not_found":
      return "try_alternate_runtime";
    case "runtime_crash":
    case "runtime_timeout":
      return "retry_with_context";
    case "agent_no_changes":
      return "retry_with_context";
    case "agent_invalid_output":
      return "retry_same_agent";
    case "gate_format":
    case "gate_lint":
      return "auto_fix_retry";
    case "gate_types":
    case "gate_test":
      return "escalate_to_em";
    case "git_conflict":
      return "escalate_to_em";
    case "task_blocked":
      return "block_and_handoff";
  }
}

export function isRecoverable(
  category: FailureCategory,
  attemptsSoFar: number,
): boolean {
  const info = ERROR_CATEGORIES[category];
  return info.recoverable && attemptsSoFar < info.maxRetries;
}
