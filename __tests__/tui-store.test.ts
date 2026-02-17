import { describe, expect, it } from "bun:test";
import { createInitialTuiState, applyEvent } from "../tui/store";
import { buildRunPaths, createInitialRunState } from "../state/run-state";
import type { TasksDocument } from "../state/types";
import type {
  AgentEvent,
  TaskEvent,
  LogEvent,
  RunEvent,
  QualityGateEvent,
} from "../monitor/types";

function makeState() {
  const doc: TasksDocument = {
    idea: "Test",
    generatedAt: "2026-01-01T00:00:00Z",
    repo: "test",
    phases: [
      {
        id: "phase-1",
        name: "Phase 1",
        goal: "Ship",
        exitCriteria: [],
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
    ],
  };
  const paths = buildRunPaths("/tmp", "test-run");
  return createInitialRunState({
    runId: "test-run",
    branch: "main",
    retryLimit: 1,
    defaultRuntime: "claude-code",
    paths,
    tasksDocument: doc,
  });
}

describe("TUI store", () => {
  it("creates initial state from RunState", () => {
    const state = makeState();
    const tui = createInitialTuiState(state);
    expect(tui.runId).toBe("test-run");
    expect(tui.totalTasks).toBe(2);
    expect(tui.agents).toHaveLength(9);
    expect(tui.tasks).toHaveLength(2);
    expect(tui.logs).toHaveLength(0);
  });

  it("updates agent status on dispatch", () => {
    const state = makeState();
    let tui = createInitialTuiState(state);

    const event: AgentEvent = {
      type: "agent:dispatched",
      ts: "2026-01-01T10:00:00Z",
      runId: "test-run",
      agentId: "software-developer",
      taskId: "task-001",
      message: "Starting implementation",
    };

    tui = applyEvent(tui, event);
    const dev = tui.agents.find((a) => a.id === "software-developer");
    expect(dev?.status).toBe("running");
    expect(dev?.taskId).toBe("task-001");
    expect(tui.activity).toHaveLength(1);
  });

  it("updates task status on completion", () => {
    const state = makeState();
    let tui = createInitialTuiState(state);

    const event: TaskEvent = {
      type: "task:completed",
      ts: "2026-01-01T10:05:00Z",
      runId: "test-run",
      taskId: "task-001",
      phaseId: "phase-1",
      commitHash: "abc1234567890",
    };

    tui = applyEvent(tui, event);
    const task = tui.tasks.find((t) => t.id === "task-001");
    expect(task?.status).toBe("passed");
    expect(task?.commit).toBe("abc1234");
    expect(tui.currentTaskIndex).toBe(1);
  });

  it("updates task status on failure", () => {
    const state = makeState();
    let tui = createInitialTuiState(state);

    const event: TaskEvent = {
      type: "task:failed",
      ts: "2026-01-01T10:05:00Z",
      runId: "test-run",
      taskId: "task-001",
      phaseId: "phase-1",
      failureDetails: "QA cycles exhausted",
    };

    tui = applyEvent(tui, event);
    const task = tui.tasks.find((t) => t.id === "task-001");
    expect(task?.status).toBe("failed");
    expect(task?.error).toBe("QA cycles exhausted");
  });

  it("updates status on run completion", () => {
    const state = makeState();
    let tui = createInitialTuiState(state);

    const event: RunEvent = {
      type: "run:completed",
      ts: "2026-01-01T10:10:00Z",
      runId: "test-run",
    };

    tui = applyEvent(tui, event);
    expect(tui.status).toBe("completed");
  });

  it("populates qualityGateSteps on quality-gate:discovered", () => {
    const state = makeState();
    let tui = createInitialTuiState(state);
    expect(tui.qualityGateSteps).toHaveLength(0);

    const event: QualityGateEvent = {
      type: "quality-gate:discovered",
      ts: "2026-01-01T10:00:00Z",
      runId: "test-run",
      steps: [
        { name: "format", cmd: ["bun", "run", "format"] },
        { name: "lint", cmd: ["bun", "run", "lint"] },
      ],
    };

    tui = applyEvent(tui, event);
    expect(tui.qualityGateSteps).toHaveLength(2);
    expect(tui.qualityGateSteps[0]?.name).toBe("format");
    expect(tui.qualityGateSteps[1]?.cmd).toEqual(["bun", "run", "lint"]);
    expect(tui.activity).toHaveLength(1);
    expect(tui.activity[0]?.message).toContain("Discovered 2 quality gate(s)");
  });

  it("appends log entries", () => {
    const state = makeState();
    let tui = createInitialTuiState(state);

    const event: LogEvent = {
      type: "log:info",
      ts: "2026-01-01T10:00:00Z",
      runId: "test-run",
      message: "Hello world",
      source: "test",
    };

    tui = applyEvent(tui, event);
    expect(tui.activity).toHaveLength(1);
    expect(tui.activity[0]?.message).toBe("[test] Hello world");
  });
});
