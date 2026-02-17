import { describe, expect, it, afterEach } from "bun:test";
import { rm, readFile } from "node:fs/promises";
import { EventBus, resetEventBus } from "../monitor/event-bus";
import type { RalphxEvent, LogEvent } from "../monitor/types";

const TEST_DIR = `/tmp/ralphx-eventbus-${process.pid}`;

afterEach(async () => {
  resetEventBus();
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("EventBus", () => {
  it("notifies type-specific listeners", async () => {
    const bus = new EventBus();
    const received: RalphxEvent[] = [];

    bus.on("log:info", (event) => received.push(event));

    await bus.emit({
      type: "log:info",
      ts: "2026-01-01T00:00:00Z",
      runId: "test",
      message: "hello",
      source: "test",
    });

    expect(received).toHaveLength(1);
    expect((received[0] as LogEvent).message).toBe("hello");
  });

  it("notifies wildcard listeners", async () => {
    const bus = new EventBus();
    const received: RalphxEvent[] = [];

    bus.on("*", (event) => received.push(event));

    await bus.emit({
      type: "log:info",
      ts: "2026-01-01T00:00:00Z",
      runId: "test",
      message: "hello",
      source: "test",
    });

    await bus.emit({
      type: "run:completed",
      ts: "2026-01-01T00:00:01Z",
      runId: "test",
    });

    expect(received).toHaveLength(2);
  });

  it("unsubscribes correctly", async () => {
    const bus = new EventBus();
    const received: RalphxEvent[] = [];

    const unsub = bus.on("log:info", (event) => received.push(event));

    await bus.emit({
      type: "log:info",
      ts: "2026-01-01T00:00:00Z",
      runId: "test",
      message: "first",
      source: "test",
    });

    unsub();

    await bus.emit({
      type: "log:info",
      ts: "2026-01-01T00:00:01Z",
      runId: "test",
      message: "second",
      source: "test",
    });

    expect(received).toHaveLength(1);
  });

  it("persists events to file", async () => {
    const bus = new EventBus();
    const eventsPath = `${TEST_DIR}/events.jsonl`;
    bus.setEventsPath(eventsPath);

    await bus.emit({
      type: "log:info",
      ts: "2026-01-01T00:00:00Z",
      runId: "test",
      message: "persist me",
      source: "test",
    });

    const content = await readFile(eventsPath, "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as LogEvent;
    expect(parsed.message).toBe("persist me");
  });
});
