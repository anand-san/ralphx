import type { FailureCategory } from "../state/types";

export interface ErrorCategoryInfo {
  category: FailureCategory;
  description: string;
  recoverable: boolean;
  maxRetries: number;
}

export const ERROR_CATEGORIES: Record<FailureCategory, ErrorCategoryInfo> = {
  runtime_not_found: {
    category: "runtime_not_found",
    description: "Runtime CLI binary not found in PATH",
    recoverable: true,
    maxRetries: 1,
  },
  runtime_crash: {
    category: "runtime_crash",
    description: "Runtime process exited with non-zero code",
    recoverable: true,
    maxRetries: 3,
  },
  runtime_timeout: {
    category: "runtime_timeout",
    description: "Runtime process exceeded timeout",
    recoverable: true,
    maxRetries: 2,
  },
  agent_no_changes: {
    category: "agent_no_changes",
    description: "Agent produced no file changes",
    recoverable: true,
    maxRetries: 2,
  },
  agent_invalid_output: {
    category: "agent_invalid_output",
    description: "Agent produced unparseable output",
    recoverable: true,
    maxRetries: 2,
  },
  gate_format: {
    category: "gate_format",
    description: "Code formatting check failed",
    recoverable: true,
    maxRetries: 3,
  },
  gate_lint: {
    category: "gate_lint",
    description: "Linting check failed",
    recoverable: true,
    maxRetries: 3,
  },
  gate_types: {
    category: "gate_types",
    description: "Type checking failed",
    recoverable: true,
    maxRetries: 2,
  },
  gate_test: {
    category: "gate_test",
    description: "Test suite failed",
    recoverable: true,
    maxRetries: 2,
  },
  git_conflict: {
    category: "git_conflict",
    description: "Git merge conflict or commit failure",
    recoverable: false,
    maxRetries: 0,
  },
  task_blocked: {
    category: "task_blocked",
    description: "All retries exhausted, task cannot proceed",
    recoverable: false,
    maxRetries: 0,
  },
};

export function categorizeQualityGateFailure(
  failedStep: string,
): FailureCategory {
  const step = failedStep.toLowerCase();
  if (step === "format") return "gate_format";
  if (step === "lint") return "gate_lint";
  if (step === "test") return "gate_test";
  if (step.includes("type") || step.includes("check-types")) {
    return "gate_types";
  }
  return "gate_lint";
}
