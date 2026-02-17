import type { RalphxEvent } from "../monitor/types";
import type { RunState, TaskRuntimeState } from "../state/types";

export interface TuiState {
  runId: string;
  status: string;
  runtime: string;
  startedAt: string;
  elapsedMs: number;
  currentPhaseIndex: number;
  totalPhases: number;
  currentTaskIndex: number;
  totalTasks: number;
  agents: AgentDisplayState[];
  tasks: TaskDisplayState[];
  logs: LogEntry[];
  recentDecisions: DecisionEntry[];
  selectedAgent: string | null;
}

export interface AgentDisplayState {
  id: string;
  name: string;
  status: "idle" | "running" | "completed" | "failed";
  taskId?: string;
  elapsedMs?: number;
}

export interface TaskDisplayState {
  id: string;
  title: string;
  status: string;
  commit?: string;
  attempt?: number;
  error?: string;
}

export interface LogEntry {
  ts: string;
  source: string;
  message: string;
}

export interface DecisionEntry {
  ts: string;
  action: string;
  taskId?: string;
  rationale?: string;
}

export function createInitialTuiState(state: RunState): TuiState {
  const completedPhases = state.phases.filter(
    (p) => p.status === "completed",
  ).length;
  const completedTasks = state.tasks.filter(
    (t) => t.status === "passed",
  ).length;

  return {
    runId: state.runId,
    status: state.status,
    runtime: state.defaultRuntime,
    startedAt: state.createdAt,
    elapsedMs: Date.now() - new Date(state.createdAt).getTime(),
    currentPhaseIndex: completedPhases,
    totalPhases: state.phases.length,
    currentTaskIndex: completedTasks,
    totalTasks: state.tasks.length,
    agents: [
      { id: "engineering-manager", name: "EM", status: "idle" },
      { id: "product-manager", name: "PM", status: "idle" },
      { id: "product-designer", name: "PD", status: "idle" },
      { id: "software-developer", name: "DEV", status: "idle" },
      { id: "qa-engineer", name: "QA", status: "idle" },
    ],
    tasks: state.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      commit: t.lastCommit?.slice(0, 7),
      attempt: t.attempts > 0 ? t.attempts : undefined,
      error: t.lastError,
    })),
    logs: [],
    recentDecisions: [],
    selectedAgent: null,
  };
}

export function applyEvent(tuiState: TuiState, event: RalphxEvent): TuiState {
  const next = { ...tuiState };

  switch (event.type) {
    case "agent:dispatched": {
      next.agents = next.agents.map((a) =>
        a.id === event.agentId
          ? { ...a, status: "running" as const, taskId: event.taskId }
          : a,
      );
      next.logs = [
        ...next.logs.slice(-99),
        {
          ts: event.ts,
          source: event.agentId,
          message: event.message ?? `Dispatched for ${event.taskId}`,
        },
      ];
      break;
    }
    case "agent:completed": {
      next.agents = next.agents.map((a) =>
        a.id === event.agentId
          ? {
              ...a,
              status: (event.exitCode === 0 ? "completed" : "failed") as
                | "completed"
                | "failed",
              elapsedMs: event.durationMs,
            }
          : a,
      );
      break;
    }
    case "task:started": {
      next.tasks = next.tasks.map((t) =>
        t.id === event.taskId ? { ...t, status: "running" } : t,
      );
      break;
    }
    case "task:completed": {
      next.tasks = next.tasks.map((t) =>
        t.id === event.taskId
          ? { ...t, status: "passed", commit: event.commitHash?.slice(0, 7) }
          : t,
      );
      next.currentTaskIndex = next.tasks.filter(
        (t) => t.status === "passed",
      ).length;
      // Reset agents to idle
      next.agents = next.agents.map((a) => ({
        ...a,
        status: "idle" as const,
        taskId: undefined,
      }));
      break;
    }
    case "task:blocked": {
      next.tasks = next.tasks.map((t) =>
        t.id === event.taskId
          ? { ...t, status: "blocked", error: event.failureDetails }
          : t,
      );
      break;
    }
    case "decision:made": {
      next.recentDecisions = [
        ...next.recentDecisions.slice(-19),
        {
          ts: event.ts,
          action: event.action,
          taskId: event.taskId,
          rationale: event.rationale,
        },
      ];
      break;
    }
    case "quality-gate:running": {
      next.logs = [
        ...next.logs.slice(-99),
        {
          ts: event.ts,
          source: "quality-gates",
          message: "Running quality gates...",
        },
      ];
      break;
    }
    case "quality-gate:passed": {
      next.logs = [
        ...next.logs.slice(-99),
        { ts: event.ts, source: "quality-gates", message: "All gates passed" },
      ];
      break;
    }
    case "quality-gate:failed": {
      next.logs = [
        ...next.logs.slice(-99),
        {
          ts: event.ts,
          source: "quality-gates",
          message: `Failed: ${event.gate} — ${event.details}`,
        },
      ];
      break;
    }
    case "run:completed": {
      next.status = "completed";
      break;
    }
    case "run:blocked": {
      next.status = "blocked";
      break;
    }
    case "log:info":
    case "log:warn":
    case "log:error": {
      next.logs = [
        ...next.logs.slice(-99),
        {
          ts: event.ts,
          source: event.source ?? "system",
          message: event.message,
        },
      ];
      break;
    }
  }

  next.elapsedMs = Date.now() - new Date(next.startedAt).getTime();
  return next;
}
