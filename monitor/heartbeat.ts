import type { EventBus } from "./event-bus";
import type { RunState } from "../state/types";

export class HeartbeatMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private eventBus: EventBus;
  private state: RunState;
  private intervalMs: number;
  private agentTimeouts: Map<string, number> = new Map();
  private defaultTimeout: number;
  private timedOutAgents = new Set<string>();
  private warnedAgents = new Set<string>();

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
    this.timedOutAgents.delete(agentId);
    this.warnedAgents.delete(agentId);
  }

  resetForTask(): void {
    this.timedOutAgents.clear();
    this.warnedAgents.clear();
  }

  private buildAgentKey(agent: RunState["agents"][number]): string {
    return `${agent.agentId}:${agent.phaseId}:${agent.taskId}`;
  }

  private check(): void {
    const now = Date.now();

    for (const agent of this.state.agents) {
      if (agent.status !== "running") continue;
      if (!agent.startedAt) continue;

      const referenceTime = agent.lastHeartbeat ?? agent.startedAt;
      const timeout =
        this.agentTimeouts.get(agent.agentId) ?? this.defaultTimeout;
      const elapsed = now - new Date(referenceTime).getTime();
      const agentKey = this.buildAgentKey(agent);

      // 80% warning (deduplicated)
      if (
        elapsed > timeout * 0.8 &&
        elapsed < timeout &&
        !this.warnedAgents.has(agentKey)
      ) {
        this.warnedAgents.add(agentKey);
        this.eventBus.emit({
          type: "process:warning",
          ts: new Date().toISOString(),
          runId: this.state.runId,
          agentId: agent.agentId,
          taskId: agent.taskId,
          pid: agent.pid,
        });
      }

      // Timeout exceeded (deduplicated)
      if (elapsed >= timeout && !this.timedOutAgents.has(agentKey)) {
        this.timedOutAgents.add(agentKey);
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
