import { describe, expect, it, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import {
  appendDecision,
  readDecisions,
  readRecentDecisions,
} from "../orchestrator/decision-log";
import type { Decision } from "../state/types";

const TEST_DIR = `/tmp/ralphx-decisions-${process.pid}`;

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("decision-log", () => {
  it("appends and reads decisions", async () => {
    await mkdir(TEST_DIR, { recursive: true });

    const decision1: Decision = {
      ts: "2026-01-01T10:00:00Z",
      action: "dispatch_agent",
      agentId: "software-developer",
      taskId: "task-001",
      rationale: "First task",
    };
    const decision2: Decision = {
      ts: "2026-01-01T10:05:00Z",
      action: "qa_verdict",
      taskId: "task-001",
      verdict: "DONE",
      notes: [],
    };

    await appendDecision(TEST_DIR, decision1);
    await appendDecision(TEST_DIR, decision2);

    const all = await readDecisions(TEST_DIR);
    expect(all).toHaveLength(2);
    expect(all[0]!.action).toBe("dispatch_agent");
    expect(all[1]!.action).toBe("qa_verdict");
  });

  it("reads recent decisions", async () => {
    await mkdir(TEST_DIR, { recursive: true });

    for (let i = 0; i < 5; i++) {
      await appendDecision(TEST_DIR, {
        ts: `2026-01-01T10:0${i}:00Z`,
        action: "dispatch_agent",
        taskId: `task-00${i}`,
      });
    }

    const recent = await readRecentDecisions(TEST_DIR, 3);
    expect(recent).toHaveLength(3);
    expect(recent[0]!.taskId).toBe("task-002");
  });

  it("returns empty array for missing file", async () => {
    const decisions = await readDecisions("/tmp/nonexistent-dir-xyz");
    expect(decisions).toHaveLength(0);
  });
});
