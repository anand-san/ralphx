import type { EventBus } from "./event-bus";
import type { RunState } from "../state/types";

const FORCE_KILL_GRACE_MS = 5000;

export class Watchdog {
  private eventBus: EventBus;
  private state: RunState;
  private saveState: () => Promise<void>;
  private unsubscribe: (() => void) | null = null;

  constructor(params: {
    eventBus: EventBus;
    state: RunState;
    saveState: () => Promise<void>;
  }) {
    this.eventBus = params.eventBus;
    this.state = params.state;
    this.saveState = params.saveState;
  }

  start(): void {
    this.unsubscribe = this.eventBus.on("process:timeout", (event) => {
      if (event.type !== "process:timeout") return;
      this.handleTimeout(event.agentId, event.taskId, event.pid);
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private handleTimeout(agentId: string, taskId?: string, pid?: number): void {
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
    const agent = this.state.agents.find(
      (entry) =>
        entry.agentId === agentId &&
        (taskId === undefined || entry.taskId === taskId),
    );
    if (agent) {
      agent.status = "timeout";
      agent.completedAt = new Date().toISOString();
    }

    // Persist state update
    this.saveState().catch(() => {
      // State saving shouldn't crash the watchdog
    });

    this.eventBus.emit({
      type: "log:warn",
      ts: new Date().toISOString(),
      runId: this.state.runId,
      message: `Watchdog killed agent ${agentId} (PID ${pid}) after timeout`,
      source: "watchdog",
    });
  }
}
