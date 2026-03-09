import { describe, expect, it } from "bun:test";
import {
  findNextTask,
  isRunBlocked,
  isRunFinished,
} from "../orchestrator/scheduler";
import { buildRunPaths, createInitialRunState } from "../state/run-state";
import type { TasksDocument } from "../state/types";

function makeDocument(): TasksDocument {
  return {
    idea: "idea",
    generatedAt: "2026-01-01T00:00:00.000Z",
    repo: "repo",
    phases: [
      {
        id: "phase-1",
        name: "Phase 1",
        goal: "Ship",
        exitCriteria: ["Done"],
        tasks: [
          {
            id: "task-001",
            status: "todo",
            title: "Task 1",
            description: "Do 1",
            notes: [],
          },
          {
            id: "task-002",
            status: "todo",
            title: "Task 2",
            description: "Do 2",
            notes: [],
          },
        ],
      },
      {
        id: "phase-2",
        name: "Phase 2",
        goal: "Polish",
        exitCriteria: ["Done"],
        tasks: [
          {
            id: "task-003",
            status: "todo",
            title: "Task 3",
            description: "Do 3",
            notes: [],
          },
        ],
      },
    ],
  };
}

function makeState() {
  const doc = makeDocument();
  const paths = buildRunPaths("/tmp", "test-run");
  return {
    state: createInitialRunState({
      runId: "test-run",
      branch: "main",
      retryLimit: 1,
      defaultRuntime: "claude-code" as const,
      paths,
      tasksDocument: doc,
    }),
    phases: doc.phases,
  };
}

describe("findNextTask", () => {
  it("returns the first pending task", () => {
    const { state, phases } = makeState();
    const result = findNextTask(state, phases);
    expect(result).not.toBeNull();
    expect(result!.task.id).toBe("task-001");
    expect(result!.phase.id).toBe("phase-1");
  });

  it("skips passed tasks", () => {
    const { state, phases } = makeState();
    state.tasks[0]!.status = "passed";
    const result = findNextTask(state, phases);
    expect(result).not.toBeNull();
    expect(result!.task.id).toBe("task-002");
  });

  it("moves to next phase when first is complete", () => {
    const { state, phases } = makeState();
    state.tasks[0]!.status = "passed";
    state.tasks[1]!.status = "passed";
    state.phases[0]!.status = "completed";
    const result = findNextTask(state, phases);
    expect(result).not.toBeNull();
    expect(result!.task.id).toBe("task-003");
    expect(result!.phase.id).toBe("phase-2");
  });

  it("returns null when blocked", () => {
    const { state, phases } = makeState();
    state.tasks[0]!.status = "blocked";
    state.tasks[1]!.status = "blocked";
    const result = findNextTask(state, phases);
    expect(result).toBeNull();
  });
});

describe("isRunFinished", () => {
  it("returns false when tasks pending", () => {
    const { state, phases } = makeState();
    expect(isRunFinished(state, phases)).toBe(false);
  });

  it("returns true when all phases complete", () => {
    const { state, phases } = makeState();
    state.tasks.forEach((t) => {
      t.status = "passed";
    });
    state.phases.forEach((p) => {
      p.status = "completed";
    });
    expect(isRunFinished(state, phases)).toBe(true);
  });
});

describe("isRunBlocked", () => {
  it("returns true when blocked with no pending", () => {
    const { state } = makeState();
    state.tasks[0]!.status = "blocked";
    state.tasks[1]!.status = "passed";
    state.tasks[2]!.status = "passed";
    expect(isRunBlocked(state)).toBe(true);
  });

  it("returns false when there are pending tasks", () => {
    const { state } = makeState();
    state.tasks[0]!.status = "blocked";
    expect(isRunBlocked(state)).toBe(false);
  });
});
