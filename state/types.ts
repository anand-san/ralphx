// ── Input types (backward-compatible with Ralph TasksDocument) ──

export type InputTaskStatus = "todo" | "done" | "pending";

export interface PlanTask {
  id: string;
  status: InputTaskStatus;
  title: string;
  description: string;
  notes: string[];
}

export interface PlanPhase {
  id: string;
  name: string;
  goal: string;
  exitCriteria: string[];
  tasks: PlanTask[];
}

export interface TasksDocument {
  idea: string;
  generatedAt: string;
  repo: string;
  phases: PlanPhase[];
}

// ── Runtime types ──

export type SandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";
export type RuntimeName = "claude-code" | "codex";

export type PhaseRunStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked";
export type TaskRunStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "blocked";
export type RunOverallStatus = "running" | "completed" | "blocked";

export interface PhaseRuntimeState {
  id: string;
  name: string;
  status: PhaseRunStatus;
}

export interface AgentRuntimeState {
  agentId: string;
  taskId: string;
  phaseId: string;
  pid?: number;
  runtime: RuntimeName;
  status: "idle" | "running" | "completed" | "failed" | "timeout";
  startedAt?: string;
  completedAt?: string;
  lastHeartbeat?: string;
  progressPath?: string;
  exitCode?: number;
  error?: string;
}

export interface TaskRuntimeState {
  id: string;
  phaseId: string;
  title: string;
  status: TaskRunStatus;
  attempts: number;
  lastError?: string;
  lastExitCode?: number;
  lastQualityGate?: string;
  lastCommit?: string;
  changedFiles: string[];
  lastLogPath?: string;
  lastMessagePath?: string;
  currentAgent?: string;
  qaCycles: number;
}

export interface RunState {
  schemaVersion: 2;
  runId: string;
  createdAt: string;
  updatedAt: string;
  status: RunOverallStatus;
  branch: string;
  retryLimit: number;
  defaultRuntime: RuntimeName;
  teamConfigPath?: string;
  // Paths within .ralphx/<run-id>/
  runDir: string;
  sourcesDir: string;
  decisionsDir: string;
  progressDir: string;
  logDir: string;
  messageDir: string;
  handoffPath: string;
  eventsPath: string;
  // Phase & task tracking
  phases: PhaseRuntimeState[];
  tasks: TaskRuntimeState[];
  agents: AgentRuntimeState[];
}

// ── Process types ──

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

// ── Task attempt result ──

export type FailureCategory =
  | "runtime_not_found"
  | "runtime_crash"
  | "runtime_timeout"
  | "agent_no_changes"
  | "agent_invalid_output"
  | "gate_format"
  | "gate_lint"
  | "gate_types"
  | "gate_test"
  | "git_conflict"
  | "task_blocked";

export interface TaskAttemptResult {
  success: boolean;
  commitHash?: string;
  changedFiles: string[];
  failureCategory?: FailureCategory;
  failureDetails?: string;
}

// ── Agent types ──

export type AgentCapability = "read" | "write" | "execute" | "commit";

export interface AgentOutput {
  agentId: string;
  taskId: string;
  raw: string;
  parsed?: unknown;
  exitCode: number;
  durationMs: number;
  changedFiles: string[];
}

export interface FailedAttempt {
  agentId: string;
  diff: string;
  qaNotes: string[];
  cycle: number;
}

export interface AgentInput {
  task: PlanTask;
  phase: PlanPhase;
  planPath: string;
  tasksPath: string;
  previousOutputs: AgentOutput[];
  peerProgress: Map<string, string>;
  previousFailedAttempts: FailedAttempt[];
  failureContext?: string;
  agentContext?: string;
  attempt: number;
  maxAttempts: number;
}

// ── Verifier / QA types ──

export type VerifierStatus = "DONE" | "REFACTOR" | "ISSUES";

export interface VerifierDecision {
  status: VerifierStatus;
  notes: string[];
}

export interface ConventionalCommitMessage {
  subject: string;
  body: string;
}

// ── CLI options ──

export interface RunnerOptions {
  command: "start" | "resume" | "attach" | "stop" | "status" | "list";
  planPath: string;
  tasksPath: string;
  runtime: RuntimeName;
  teamPath?: string;
  retry: number;
  timeout: number;
  heartbeatInterval: number;
  noTui: boolean;
  detached: boolean;
  /** Internal flag: set when re-spawned as daemon child */
  _daemon: boolean;
  model?: string;
  skipQualityGates: boolean;
  allowDirty: boolean;
  dryRun: boolean;
  runId?: string;
}

// ── Planner types ──

export type PlannerAction =
  | "dispatch_agent"
  | "retry_task"
  | "skip_task"
  | "block_task"
  | "task_complete";

export const WRITE_AGENT_IDS = new Set([
  "software-developer",
  "software-architect",
  "refactorer",
  "bug-fixer",
]);

// ── Decision log types ──

export type DecisionAction =
  | "dispatch_agent"
  | "qa_verdict"
  | "task_complete"
  | "task_failed"
  | "task_blocked"
  | "phase_complete"
  | "run_complete"
  | "run_blocked"
  | "retry"
  | "skip"
  | "escalate"
  | "planner_consulted"
  | "planner_fallback";

export interface Decision {
  ts: string;
  action: DecisionAction;
  agentId?: string;
  taskId?: string;
  phaseId?: string;
  rationale?: string;
  verdict?: VerifierStatus;
  notes?: string[];
  commit?: string;
  outcome?: string;
}

// ── Orchestrator planner output ──

export interface PlannerRecommendation {
  contextBriefing: string;
  recommendation: {
    action: string;
    agentId?: string;
    taskId?: string;
    rationale: string;
    agentContext?: string;
    scope?: string[];
  };
  warnings: string[];
}
