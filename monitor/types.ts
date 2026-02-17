import type { FailureCategory, VerifierStatus } from "../state/types";

export type EventType =
  | "process:registered"
  | "process:completed"
  | "process:failed"
  | "process:timeout"
  | "process:warning"
  | "task:started"
  | "task:completed"
  | "task:failed"
  | "task:blocked"
  | "agent:dispatched"
  | "agent:output"
  | "agent:completed"
  | "decision:made"
  | "quality-gate:running"
  | "quality-gate:passed"
  | "quality-gate:failed"
  | "run:started"
  | "run:completed"
  | "run:blocked"
  | "log:info"
  | "log:warn"
  | "log:error";

export interface BaseEvent {
  type: EventType;
  ts: string;
  runId: string;
}

export interface ProcessEvent extends BaseEvent {
  type:
    | "process:registered"
    | "process:completed"
    | "process:failed"
    | "process:timeout"
    | "process:warning";
  pid?: number;
  agentId: string;
  taskId?: string;
  exitCode?: number;
  error?: string;
  durationMs?: number;
}

export interface TaskEvent extends BaseEvent {
  type: "task:started" | "task:completed" | "task:failed" | "task:blocked";
  taskId: string;
  phaseId: string;
  attempt?: number;
  commitHash?: string;
  failureCategory?: FailureCategory;
  failureDetails?: string;
}

export interface AgentEvent extends BaseEvent {
  type: "agent:dispatched" | "agent:output" | "agent:completed";
  agentId: string;
  taskId: string;
  phaseId?: string;
  message?: string;
  exitCode?: number;
  durationMs?: number;
}

export interface DecisionEvent extends BaseEvent {
  type: "decision:made";
  action: string;
  agentId?: string;
  taskId?: string;
  rationale?: string;
  verdict?: VerifierStatus;
}

export interface QualityGateEvent extends BaseEvent {
  type: "quality-gate:running" | "quality-gate:passed" | "quality-gate:failed";
  gate?: string;
  details?: string;
}

export interface RunEvent extends BaseEvent {
  type: "run:started" | "run:completed" | "run:blocked";
  details?: string;
}

export interface LogEvent extends BaseEvent {
  type: "log:info" | "log:warn" | "log:error";
  message: string;
  source?: string;
}

export type RalphxEvent =
  | ProcessEvent
  | TaskEvent
  | AgentEvent
  | DecisionEvent
  | QualityGateEvent
  | RunEvent
  | LogEvent;
