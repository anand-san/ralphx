import type { EventBus } from "./event-bus";
import type { RunState } from "../state/types";

const FORCE_KILL_GRACE_MS = 5000;

export class Watchdog {
  private eventBus: EventBus;
  private state: RunState;
  private unsubscribe: (() => void) | null = null;

  constructor(params: { eventBus: EventBus; state: RunState }) {
    this.eventBus = params.eventBus;
    this.state = params.state;
  }

  start(): void {
    this.unsubscribe = this.eventBus.on("process:timeout", (event) => {
      if (event.type !== "process:timeout") return;
      this.handleTimeout(event.agentId, event.pid);
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private handleTimeout(agentId: string, pid?: number): void {
    if (!pid) return;

    // Attempt graceful kill
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may already be dead
      return;
    }

    // Force kill after grace period
    setTimeout(() => {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Process already dead
      }
    }, FORCE_KILL_GRACE_MS);

    // Update agent state
    const agent = this.state.agents.find((a) => a.agentId === agentId);
    if (agent) {
      agent.status = "timeout";
      agent.completedAt = new Date().toISOString();
    }

    this.eventBus.emit({
      type: "log:warn",
      ts: new Date().toISOString(),
      runId: this.state.runId,
      message: `Watchdog killed agent ${agentId} (PID ${pid}) after timeout`,
      source: "watchdog",
    });
  }
}
