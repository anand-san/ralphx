import type { EventBus } from "./event-bus";
import type { RunState } from "../state/types";

export class HeartbeatMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private eventBus: EventBus;
  private state: RunState;
  private intervalMs: number;
  private agentTimeouts: Map<string, number> = new Map();
  private defaultTimeout: number;

  constructor(params: {
    eventBus: EventBus;
    state: RunState;
    intervalMs: number;
    defaultTimeout: number;
  }) {
    this.eventBus = params.eventBus;
    this.state = params.state;
    this.intervalMs = params.intervalMs;
    this.defaultTimeout = params.defaultTimeout;
  }

  start(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.check();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  registerAgent(agentId: string, timeout?: number): void {
    this.agentTimeouts.set(agentId, timeout ?? this.defaultTimeout);
  }

  unregisterAgent(agentId: string): void {
    this.agentTimeouts.delete(agentId);
  }

  private check(): void {
    const now = Date.now();

    for (const agent of this.state.agents) {
      if (agent.status !== "running") continue;
      if (!agent.startedAt) continue;

      const startedAt = new Date(agent.startedAt).getTime();
      const timeout =
        this.agentTimeouts.get(agent.agentId) ?? this.defaultTimeout;
      const elapsed = now - startedAt;

      // 80% warning
      if (elapsed > timeout * 0.8 && elapsed < timeout) {
        this.eventBus.emit({
          type: "process:warning",
          ts: new Date().toISOString(),
          runId: this.state.runId,
          agentId: agent.agentId,
          taskId: agent.taskId,
          pid: agent.pid,
        });
      }

      // Timeout exceeded
      if (elapsed >= timeout) {
        this.eventBus.emit({
          type: "process:timeout",
          ts: new Date().toISOString(),
          runId: this.state.runId,
          agentId: agent.agentId,
          taskId: agent.taskId,
          pid: agent.pid,
        });
      }
    }
  }
}
