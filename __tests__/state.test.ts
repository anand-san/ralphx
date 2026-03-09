import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildRunId,
  buildRunPaths,
  createInitialRunState,
  ensureRunDirectories,
  saveRunState,
  loadRunState,
  copySourceFiles,
} from "../state/run-state";
import {
  getTaskState,
  getPendingTasks,
  isPhaseComplete,
} from "../state/selectors";
import type { TasksDocument } from "../state/types";

const TEST_DIR = `/tmp/ralphx-tests-${process.pid}`;
const ROOT_DIR = join(TEST_DIR, "repo");

function makeDocument(): TasksDocument {
  return {
    idea: "Test idea",
    generatedAt: "2026-01-01T00:00:00.000Z",
    repo: "test-repo",
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
    ],
  };
}

beforeEach(async () => {
  await mkdir(ROOT_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("buildRunId", () => {
  it("returns a timestamp-based ID", () => {
    const id = buildRunId();
    expect(id).toMatch(/^\d{8}-\d{6}$/);
  });
});

describe("buildRunPaths", () => {
  it("builds correct paths under .ralphx/<run-id>/", () => {
    const paths = buildRunPaths("/repo", "20260101-120000");
    expect(paths.runDir).toBe("/repo/.ralphx/20260101-120000");
    expect(paths.sourcesDir).toBe("/repo/.ralphx/20260101-120000/sources");
    expect(paths.decisionsDir).toBe("/repo/.ralphx/20260101-120000/decisions");
    expect(paths.statePath).toBe("/repo/.ralphx/20260101-120000/state.json");
    expect(paths.eventsPath).toBe("/repo/.ralphx/20260101-120000/events.jsonl");
  });
});

describe("createInitialRunState", () => {
  it("creates state with schemaVersion 2", () => {
    const doc = makeDocument();
    const paths = buildRunPaths(ROOT_DIR, "test-run");
    const state = createInitialRunState({
      runId: "test-run",
      branch: "ralphx/test-run",
      retryLimit: 3,
      defaultRuntime: "claude-code",
      paths,
      tasksDocument: doc,
    });

    expect(state.schemaVersion).toBe(2);
    expect(state.runId).toBe("test-run");
    expect(state.status).toBe("running");
    expect(state.defaultRuntime).toBe("claude-code");
    expect(state.phases).toHaveLength(1);
    expect(state.tasks).toHaveLength(2);
    expect(state.tasks[0]?.status).toBe("pending");
    expect(state.agents).toHaveLength(0);
  });

  it("marks done tasks as passed", () => {
    const doc = makeDocument();
    doc.phases[0]!.tasks[0]!.status = "done";
    const paths = buildRunPaths(ROOT_DIR, "test-run");
    const state = createInitialRunState({
      runId: "test-run",
      branch: "main",
      retryLimit: 1,
      defaultRuntime: "codex",
      paths,
      tasksDocument: doc,
    });

    expect(state.tasks[0]?.status).toBe("passed");
    expect(state.tasks[1]?.status).toBe("pending");
  });
});

describe("saveRunState / loadRunState", () => {
  it("round-trips state through JSON", async () => {
    const doc = makeDocument();
    const paths = buildRunPaths(ROOT_DIR, "test-run");
    const state = createInitialRunState({
      runId: "test-run",
      branch: "main",
      retryLimit: 2,
      defaultRuntime: "claude-code",
      paths,
      tasksDocument: doc,
    });

    await ensureRunDirectories(state);
    await saveRunState(paths.statePath, state);

    const loaded = await loadRunState(paths.statePath);
    expect(loaded.schemaVersion).toBe(2);
    expect(loaded.runId).toBe("test-run");
    expect(loaded.tasks).toHaveLength(2);
  });
});

describe("selectors", () => {
  it("getTaskState finds task by phase+task id", () => {
    const doc = makeDocument();
    const paths = buildRunPaths(ROOT_DIR, "test-run");
    const state = createInitialRunState({
      runId: "test-run",
      branch: "main",
      retryLimit: 1,
      defaultRuntime: "claude-code",
      paths,
      tasksDocument: doc,
    });

    const task = getTaskState(state, "phase-1", "task-001");
    expect(task.title).toBe("Task 1");
  });

  it("getTaskState throws for unknown task", () => {
    const doc = makeDocument();
    const paths = buildRunPaths(ROOT_DIR, "test-run");
    const state = createInitialRunState({
      runId: "test-run",
      branch: "main",
      retryLimit: 1,
      defaultRuntime: "claude-code",
      paths,
      tasksDocument: doc,
    });

    expect(() => getTaskState(state, "phase-1", "task-999")).toThrow();
  });

  it("getPendingTasks returns only pending", () => {
    const doc = makeDocument();
    const paths = buildRunPaths(ROOT_DIR, "test-run");
    const state = createInitialRunState({
      runId: "test-run",
      branch: "main",
      retryLimit: 1,
      defaultRuntime: "claude-code",
      paths,
      tasksDocument: doc,
    });
    state.tasks[0]!.status = "passed";
    expect(getPendingTasks(state)).toHaveLength(1);
  });

  it("isPhaseComplete detects all-passed", () => {
    const doc = makeDocument();
    const paths = buildRunPaths(ROOT_DIR, "test-run");
    const state = createInitialRunState({
      runId: "test-run",
      branch: "main",
      retryLimit: 1,
      defaultRuntime: "claude-code",
      paths,
      tasksDocument: doc,
    });
    state.tasks[0]!.status = "passed";
    state.tasks[1]!.status = "passed";
    expect(isPhaseComplete(state, "phase-1")).toBe(true);
  });
});

describe("copySourceFiles", () => {
  it("copies plan and tasks to sources dir", async () => {
    const sourcesDir = join(ROOT_DIR, "sources");
    const planPath = join(ROOT_DIR, "PLAN.md");
    const tasksPath = join(ROOT_DIR, "tasks.json");

    await mkdir(sourcesDir, { recursive: true });
    await Bun.write(planPath, "# Plan\n");
    await Bun.write(tasksPath, JSON.stringify(makeDocument()));

    await copySourceFiles({
      sourcesDir,
      planPath,
      tasksPath,
    });

    const copiedPlan = await readFile(join(sourcesDir, "PLAN.md"), "utf8");
    expect(copiedPlan).toBe("# Plan\n");

    const copiedTasks = await readFile(join(sourcesDir, "tasks.json"), "utf8");
    const parsed = JSON.parse(copiedTasks) as TasksDocument;
    expect(parsed.idea).toBe("Test idea");
  });
});
