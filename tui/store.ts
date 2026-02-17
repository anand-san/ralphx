import type { RalphxEvent } from "../monitor/types";
import type { RunState } from "../state/types";

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
  activity: ActivityEntry[];
  recentDecisions: DecisionEntry[];
  qualityGateSteps: Array<{ name: string; cmd: string[] }>;
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

export interface ActivityEntry {
  ts: string;
  level: "info" | "warn" | "error";
  message: string;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m${s % 60}s`;
  return `${s}s`;
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
      {
        id: "engineering-manager",
        name: "Engineering Manager",
        status: "idle",
      },
      { id: "product-manager", name: "Product Manager", status: "idle" },
      { id: "product-designer", name: "Product Designer", status: "idle" },
      { id: "software-developer", name: "Software Developer", status: "idle" },
      { id: "qa-engineer", name: "QA Engineer", status: "idle" },
      { id: "bug-fixer", name: "Bug Fixer", status: "idle" },
      { id: "refactorer", name: "Refactorer", status: "idle" },
      { id: "commit-generator", name: "Commit Generator", status: "idle" },
      {
        id: "quality-gate-discoverer",
        name: "Repo Discovery Agent",
        status: "idle",
      },
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
    activity: [],
    recentDecisions: [],
    qualityGateSteps: state.qualityGateSteps ?? [],
    selectedAgent: null,
  };
}

export function applyEvent(tuiState: TuiState, event: RalphxEvent): TuiState {
  const next = { ...tuiState };

  switch (event.type) {
    case "agent:dispatched": {
      const knownAgent = next.agents.find((a) => a.id === event.agentId);
      if (knownAgent) {
        next.agents = next.agents.map((a) =>
          a.id === event.agentId
            ? { ...a, status: "running" as const, taskId: event.taskId }
            : a,
        );
      } else {
        next.agents = [
          ...next.agents,
          {
            id: event.agentId,
            name: event.agentId.slice(0, 3).toUpperCase(),
            status: "running" as const,
            taskId: event.taskId,
          },
        ];
      }
      next.activity = [
        ...next.activity.slice(-99),
        {
          ts: event.ts,
          level: "info",
          message:
            event.message ?? `Dispatched ${event.agentId} for ${event.taskId}`,
        },
      ];
      break;
    }
    case "agent:output": {
      next.logs = [
        ...next.logs.slice(-99),
        {
          ts: event.ts,
          source: event.agentId,
          message: event.message ?? "",
        },
      ];
      break;
    }
    case "agent:completed": {
      const ok = event.exitCode === 0;
      next.agents = next.agents.map((a) =>
        a.id === event.agentId
          ? {
              ...a,
              status: (ok ? "completed" : "failed") as "completed" | "failed",
              elapsedMs: event.durationMs,
            }
          : a,
      );
      next.activity = [
        ...next.activity.slice(-99),
        {
          ts: event.ts,
          level: ok ? "info" : "error",
          message: `${event.agentId} ${ok ? "completed" : `failed (exit ${event.exitCode})`}${event.durationMs ? ` in ${formatDuration(event.durationMs)}` : ""}`,
        },
      ];
      break;
    }
    case "task:started": {
      next.tasks = next.tasks.map((t) =>
        t.id === event.taskId ? { ...t, status: "running" } : t,
      );
      next.activity = [
        ...next.activity.slice(-99),
        {
          ts: event.ts,
          level: "info",
          message: `Task ${event.taskId} started`,
        },
      ];
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
      next.activity = [
        ...next.activity.slice(-99),
        {
          ts: event.ts,
          level: "info",
          message: `Task ${event.taskId} completed${event.commitHash ? ` (${event.commitHash.slice(0, 7)})` : ""}`,
        },
      ];
      break;
    }
    case "task:failed": {
      next.tasks = next.tasks.map((t) =>
        t.id === event.taskId
          ? { ...t, status: "failed", error: event.failureDetails }
          : t,
      );
      next.activity = [
        ...next.activity.slice(-99),
        {
          ts: event.ts,
          level: "error",
          message: `Task ${event.taskId} failed: ${event.failureDetails ?? "unknown"}`,
        },
      ];
      break;
    }
    case "task:blocked": {
      next.tasks = next.tasks.map((t) =>
        t.id === event.taskId
          ? { ...t, status: "blocked", error: event.failureDetails }
          : t,
      );
      next.activity = [
        ...next.activity.slice(-99),
        {
          ts: event.ts,
          level: "error",
          message: `Task ${event.taskId} blocked: ${event.failureDetails ?? "unknown"}`,
        },
      ];
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
      next.activity = [
        ...next.activity.slice(-99),
        {
          ts: event.ts,
          level: "info",
          message: `${event.action}${event.taskId ? ` [${event.taskId}]` : ""}${event.rationale ? ` — ${event.rationale}` : ""}`,
        },
      ];
      break;
    }
    case "quality-gate:discovered": {
      const steps = event.steps ?? [];
      next.qualityGateSteps = steps;
      const msg =
        steps.length > 0
          ? `Discovered ${steps.length} quality gate(s): ${steps.map((s) => s.name).join(", ")}`
          : "No quality gates discovered for this repo.";
      next.activity = [
        ...next.activity.slice(-99),
        { ts: event.ts, level: "info", message: msg },
      ];
      break;
    }
    case "quality-gate:running": {
      next.activity = [
        ...next.activity.slice(-99),
        { ts: event.ts, level: "info", message: "Running quality gates..." },
      ];
      break;
    }
    case "quality-gate:passed": {
      next.activity = [
        ...next.activity.slice(-99),
        { ts: event.ts, level: "info", message: "Quality gates passed" },
      ];
      break;
    }
    case "quality-gate:failed": {
      next.activity = [
        ...next.activity.slice(-99),
        {
          ts: event.ts,
          level: "error",
          message: `Quality gate failed: ${event.gate} — ${event.details}`,
        },
      ];
      break;
    }
    case "run:completed": {
      next.status = "completed";
      next.activity = [
        ...next.activity.slice(-99),
        { ts: event.ts, level: "info", message: "Run completed" },
      ];
      break;
    }
    case "run:blocked": {
      next.status = "blocked";
      next.activity = [
        ...next.activity.slice(-99),
        {
          ts: event.ts,
          level: "error",
          message: `Run blocked${event.details ? `: ${event.details}` : ""}`,
        },
      ];
      break;
    }
    case "log:info":
    case "log:warn":
    case "log:error": {
      const level =
        event.type === "log:error"
          ? "error"
          : event.type === "log:warn"
            ? "warn"
            : "info";
      const source = event.source ?? "system";
      next.activity = [
        ...next.activity.slice(-99),
        {
          ts: event.ts,
          level,
          message:
            source !== "orchestrator"
              ? `[${source}] ${event.message}`
              : event.message,
        },
      ];
      break;
    }
  }

  next.elapsedMs = Date.now() - new Date(next.startedAt).getTime();
  return next;
}
