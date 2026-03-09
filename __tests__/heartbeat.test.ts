import { describe, expect, it } from "bun:test";
import { EventBus } from "../monitor/event-bus";
import { HeartbeatMonitor } from "../monitor/heartbeat";
import type { RalphxEvent } from "../monitor/types";
import type { RunState } from "../state/types";

function makeState(): RunState {
  return {
    schemaVersion: 2,
    runId: "test-run",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "running",
    branch: "main",
    retryLimit: 1,
    defaultRuntime: "codex",
    runDir: "/tmp/test/.ralphx/test-run",
    sourcesDir: "/tmp/test/.ralphx/test-run/sources",
    decisionsDir: "/tmp/test/.ralphx/test-run/decisions",
    progressDir: "/tmp/test/.ralphx/test-run/progress",
    logDir: "/tmp/test/.ralphx/test-run/logs",
    messageDir: "/tmp/test/.ralphx/test-run/messages",
    handoffPath: "/tmp/test/.ralphx/test-run/HANDOFF.md",
    eventsPath: "/tmp/test/.ralphx/test-run/events.jsonl",
    phases: [{ id: "phase-1", name: "Phase 1", status: "in_progress" }],
    tasks: [],
    agents: [],
  };
}

describe("HeartbeatMonitor", () => {
  it("tracks timeout warnings per agent-task key, not just per agent id", async () => {
    const bus = new EventBus();
    const state = makeState();
    const now = new Date(Date.now() - 50).toISOString();

    state.agents = [
      {
        agentId: "software-developer",
        taskId: "task-1",
        phaseId: "phase-1",
        runtime: "codex",
        status: "running",
        startedAt: now,
        pid: 1001,
      },
      {
        agentId: "software-developer",
        taskId: "task-2",
        phaseId: "phase-1",
        runtime: "codex",
        status: "running",
        startedAt: now,
        pid: 1002,
      },
    ];

    const events: RalphxEvent[] = [];
    bus.on("process:timeout", (event) => {
      events.push(event);
    });

    const monitor = new HeartbeatMonitor({
      eventBus: bus,
      state,
      intervalMs: 5,
      defaultTimeout: 1,
    });

    monitor.start();
    await Bun.sleep(25);
    monitor.stop();

    const timeouts = events.filter(
      (event): event is Extract<RalphxEvent, { type: "process:timeout" }> =>
        event.type === "process:timeout",
    );

    expect(timeouts).toHaveLength(2);
    expect(timeouts.map((event) => event.taskId).sort()).toEqual([
      "task-1",
      "task-2",
    ]);
  });
});
