import { describe, expect, it } from "bun:test";
import { getRecoveryStrategy, isRecoverable } from "../errors/recovery";
import {
  categorizeQualityGateFailure,
  ERROR_CATEGORIES,
} from "../errors/categories";
import { RalphxRuntimeError } from "../errors/types";

describe("error categories", () => {
  it("has all expected categories", () => {
    expect(ERROR_CATEGORIES.runtime_not_found).toBeDefined();
    expect(ERROR_CATEGORIES.runtime_crash).toBeDefined();
    expect(ERROR_CATEGORIES.runtime_timeout).toBeDefined();
    expect(ERROR_CATEGORIES.agent_no_changes).toBeDefined();
    expect(ERROR_CATEGORIES.git_conflict).toBeDefined();
    expect(ERROR_CATEGORIES.task_blocked).toBeDefined();
  });

  it("categorizeQualityGateFailure maps correctly", () => {
    expect(categorizeQualityGateFailure("format")).toBe("gate_format");
    expect(categorizeQualityGateFailure("lint")).toBe("gate_lint");
    expect(categorizeQualityGateFailure("frontend-check-types")).toBe(
      "gate_types",
    );
    expect(categorizeQualityGateFailure("test")).toBe("gate_test");
  });
});

describe("recovery strategy", () => {
  it("returns retry for runtime crash", () => {
    expect(getRecoveryStrategy("runtime_crash", 0)).toBe("retry_with_context");
  });

  it("escalates after max retries", () => {
    expect(getRecoveryStrategy("runtime_crash", 3)).toBe("escalate_to_em");
  });

  it("returns auto_fix for format/lint", () => {
    expect(getRecoveryStrategy("gate_format", 0)).toBe("auto_fix_retry");
    expect(getRecoveryStrategy("gate_lint", 0)).toBe("auto_fix_retry");
  });

  it("returns block for non-recoverable", () => {
    expect(getRecoveryStrategy("task_blocked", 0)).toBe("block_and_handoff");
    // git_conflict has maxRetries: 0 and recoverable: false, so 0 >= 0 → block
    expect(getRecoveryStrategy("git_conflict", 0)).toBe("block_and_handoff");
  });

  it("isRecoverable checks attempts", () => {
    expect(isRecoverable("runtime_crash", 0)).toBe(true);
    expect(isRecoverable("runtime_crash", 3)).toBe(false);
    expect(isRecoverable("task_blocked", 0)).toBe(false);
  });
});

describe("RalphxRuntimeError", () => {
  it("has correct properties", () => {
    const error = new RalphxRuntimeError({
      category: "runtime_crash",
      message: "Process died",
      recoverable: true,
      suggestedAction: "retry",
    });

    expect(error.name).toBe("RalphxRuntimeError");
    expect(error.category).toBe("runtime_crash");
    expect(error.message).toBe("Process died");
    expect(error.recoverable).toBe(true);
    expect(error).toBeInstanceOf(Error);
  });
});
