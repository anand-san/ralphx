# RalphX Architecture & Developer Guide

This document explains how RalphX works internally so that any AI agent or human contributor can understand the codebase and make changes effectively.

## What is RalphX?

RalphX is an autonomous multi-agent orchestration system that executes software development tasks through AI-powered agents. Given a plan (Markdown) and a structured task list (JSON), it:

1. Creates an isolated git branch for the run
2. Iterates through phases and tasks sequentially
3. Dispatches AI agents (via Claude Code or Codex CLI) to implement, verify, and fix code
4. Enforces quality gates (format, lint, type-check, test) between steps
5. Generates conventional commits for each completed task
6. Tracks all decisions, events, and progress in structured files
7. Handles failures with retries, categorized errors, and human handoff

It is designed for **overnight unattended operation** — reliable, observable, resumable, and crash-resilient.

---

## Directory Structure

```
scripts/ralphx/
├── cli/                          # Entry point & command routing
│   ├── index.ts                  # Main entry, routes to command handlers
│   ├── parse-options.ts          # CLI argument parser (extracted for testability)
│   └── commands/
│       ├── start.ts              # Initialize and begin a new run
│       ├── resume.ts             # Resume an interrupted/blocked run
│       ├── attach.ts             # Attach to a running daemon
│       ├── stop.ts               # Gracefully stop a daemon
│       ├── status.ts             # Display run status
│       └── list.ts               # List all past runs
├── config/                       # Configuration & validation
│   ├── schema.ts                 # Zod schemas for tasks.json and team config
│   ├── defaults.ts               # Default 5-agent engineering team definition
│   ├── loader.ts                 # Team config file loader
│   └── types.ts                  # TeamConfig, TeamRoleConfig types
├── orchestrator/                 # The brain — task execution engine
│   ├── orchestrator.ts           # Main loop: dev → gates → QA → commit
│   ├── planner.ts                # Load plan/tasks from sources directory
│   ├── scheduler.ts              # Find next task, check run completion
│   ├── decision-log.ts           # Append/read decisions.jsonl
│   ├── resume.ts                 # Load resume context from run directory
│   └── handoff.ts                # Write HANDOFF.md on failure
├── agents/                       # Agent abstraction layer
│   ├── base-agent.ts             # AgentDefinition interface
│   ├── registry.ts               # Agent registry (register/get/list/clear)
│   ├── agent-runner.ts           # Execute an agent via runtime provider
│   ├── register-defaults.ts      # Registers all 11 default agents
│   ├── built-in/                 # Full team agents
│   │   ├── software-developer.ts # Primary implementer
│   │   ├── qa-engineer.ts        # QA verification (DONE/REFACTOR/ISSUES)
│   │   ├── engineering-manager.ts# Triage and coordination
│   │   ├── product-manager.ts    # Requirements refinement
│   │   └── product-designer.ts   # UI/UX guidance
│   ├── mini/                     # Atomic utility agents
│   │   ├── orchestrator-planner.ts # Plans next step (schema-validated JSON)
│   │   ├── commit-generator.ts   # Conventional commit from diff
│   │   ├── code-reviewer.ts      # Quick code review
│   │   ├── refactorer.ts         # Style improvements from QA notes
│   │   ├── bug-fixer.ts          # Bug fixes from QA notes
│   │   └── doc-updater.ts        # Documentation updates
│   └── prompts/
│       ├── context-builder.ts    # Builds XML context blocks for agent prompts
│       └── templates.ts          # Commit parsing, verifier parsing, prompt utils
├── runtime/                      # AI backend abstraction
│   ├── provider.ts               # RuntimeProvider interface
│   ├── providers/
│   │   ├── claude-code.ts        # Claude Code CLI adapter
│   │   └── codex.ts              # Codex CLI adapter
│   ├── process.ts                # Bun.spawn wrapper with timeout + SIGKILL
│   ├── quality-gates.ts          # Sequential: format → lint → types → test
│   ├── sandbox.ts                # Sandbox mode resolution
│   └── log.ts                    # Append-only log utility
├── state/                        # Persistence & tracking
│   ├── types.ts                  # All type definitions (the source of truth)
│   ├── run-state.ts              # RunState CRUD, directory building, ID generation
│   ├── artifacts.ts              # Log/message/commit path building
│   ├── selectors.ts              # State query helpers
│   └── progress-writer.ts        # progress.md per agent per task
├── monitor/                      # Health & observability
│   ├── event-bus.ts              # Central event emitter + JSONL persistence
│   ├── heartbeat.ts              # Periodic agent health checks
│   ├── watchdog.ts               # Kill hung agents (SIGTERM → SIGKILL)
│   └── types.ts                  # 20+ typed event definitions
├── tui/                          # Terminal UI (Ink/React)
│   ├── app.tsx                   # Ink root component with dashboard
│   └── store.ts                  # TUI state, event reducer
├── git/
│   └── operations.ts             # All git operations (branch, stage, commit, etc.)
├── errors/
│   ├── types.ts                  # RalphxRuntimeError class
│   ├── categories.ts             # 11 error categories with metadata
│   └── recovery.ts               # Recovery strategy per category + attempt count
├── __tests__/                    # 9 test files, 59 tests
│   ├── state.test.ts
│   ├── event-bus.test.ts
│   ├── scheduler.test.ts
│   ├── decision-log.test.ts
│   ├── agents.test.ts
│   ├── errors.test.ts
│   ├── cli.test.ts
│   ├── config.test.ts
│   └── tui-store.test.ts
├── package.json                  # Standalone package (zod, @types/bun, prettier, typescript)
└── tsconfig.json                 # ESNext, bundler resolution, react-jsx
```

---

## Core Concepts

### Run

A run is a single end-to-end execution of a task plan. It gets:
- A unique ID (timestamp format: `YYYYMMDD-HHMMSS`)
- A dedicated git branch (`ralphx-<run-id>`)
- A self-contained directory (`.ralphx/<run-id>/`)
- A state file tracking all phases, tasks, and agents

### Phase

Phases are sequential groups of tasks (e.g., "Foundation", "Core Features"). A phase completes when all its tasks pass. Phases execute in order — phase N+1 doesn't start until phase N is complete.

### Task

A task is a single unit of work (e.g., "Implement user auth endpoint"). Tasks go through this lifecycle:
```
pending → running → passed
                  → failed (retryable)
                  → blocked (needs human intervention)
```

### Agent

An agent is a specialized AI persona that performs a specific role. Each agent has:
- An ID and human-readable name
- Capabilities: `read`, `write`, `execute`, `commit`
- A sandbox mode: `read-only`, `workspace-write`, `danger-full-access`
- A prompt builder function that takes context and produces a prompt string
- An optional output parser

### Runtime Provider

The abstraction over the AI CLI tool. Both providers implement the same interface:

```typescript
interface RuntimeProvider {
  name: string;
  execute(params: {
    rootDir: string;           // Set via Bun.spawn({ cwd })
    prompt: string;            // Piped via stdin
    logPath: string;           // Where to write execution log
    outputPath: string;        // Where provider writes output
    model?: string;
    sandbox?: SandboxMode;
    timeout?: number;
    streamOutput?: boolean;
    outputSchema?: object;     // JSON Schema for structured output
  }): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    output: string;            // Extracted/normalized output
    durationMs: number;
  }>;
  isAvailable(): Promise<boolean>;
}
```

**Claude Code adapter:** `claude --print --dangerously-skip-permissions` with prompt via stdin. Supports `--output-format json --json-schema` for structured output.

**Codex adapter:** `codex exec --full-auto -o <output> -s <sandbox> -` with prompt via stdin. Supports `--output-schema` for structured output.

Both: working directory set via `Bun.spawn({ cwd })`, never via CLI flag.

---

## Task Execution Flow

This is the core algorithm in `orchestrator/orchestrator.ts`:

```
For each phase (sequential):
  For each task in phase (sequential):
    For each attempt (1 to retryLimit+1):

      1. IMPLEMENT
         Agent: software-developer (workspace-write)
         → Writes code based on task description, plan context, and failure history
         → If exit code != 0: retry from step 1
         → If no files changed: retry from step 1

      2. QUALITY GATES (unless --skip-quality-gates)
         Steps: format → lint → check-types (frontend) → check-types (server) → test
         → If any step fails: retry from step 1 with error context

      3. QA VERIFICATION LOOP (max 5 cycles)
         Agent: qa-engineer (read-only)
         → Returns JSON: { status: "DONE" | "REFACTOR" | "ISSUES", notes: [...] }

         If DONE: proceed to step 4
         If REFACTOR: dispatch refactorer → quality gates → back to QA
         If ISSUES: dispatch bug-fixer → quality gates → back to QA

         Failed attempts are tracked (diff + QA notes) and passed to subsequent
         fix agents to prevent repeating the same approach.

      4. COMMIT
         Agent: commit-generator (read-only)
         → Generates conventional commit message from diff
         → Stage all, commit, record hash

      5. PROGRESS
         → Write progress.md for this task
         → Mark task as passed
         → Emit task:completed event

    If all attempts exhausted:
      → Mark task as blocked
      → Write HANDOFF.md
      → Stop run
```

---

## Event System

The EventBus (`monitor/event-bus.ts`) is the central nervous system. All components emit events, and all observers subscribe via the bus.

### Event Types

| Event | When |
|---|---|
| `run:started` | Orchestrator begins |
| `run:completed` | All phases complete |
| `run:blocked` | Task blocked, run stops |
| `task:started` | Task execution begins |
| `task:completed` | Task passed QA + committed |
| `task:blocked` | Task exhausted retries |
| `agent:dispatched` | Agent process spawned |
| `agent:completed` | Agent process finished |
| `quality-gate:running` | Quality gates starting |
| `quality-gate:passed` | All gates passed |
| `quality-gate:failed` | A gate failed |
| `decision:made` | Orchestrator recorded a decision |
| `process:warning` | Agent at 80% of timeout |
| `process:timeout` | Agent exceeded timeout |
| `log:info/warn/error` | General logging |

### Persistence

Every event is appended to `.ralphx/<run-id>/events.jsonl` as one JSON line. This file is always written (not just in daemon mode) and is the source of truth for:
- The TUI dashboard
- The `attach` command
- Post-run analysis

### Subscription

```typescript
// Listen to specific event type
eventBus.on("task:completed", (event) => { ... });

// Listen to all events (wildcard)
eventBus.on("*", (event) => { ... });
```

---

## State Management

### RunState (state/types.ts)

The central state object tracks everything about a run:

```typescript
interface RunState {
  schemaVersion: 2;
  runId: string;
  createdAt: string;
  updatedAt: string;
  status: "running" | "completed" | "blocked";
  branch: string;
  retryLimit: number;
  defaultRuntime: "claude-code" | "codex";
  teamConfigPath?: string;
  // Directory paths
  runDir: string;
  sourcesDir: string;
  decisionsDir: string;
  progressDir: string;
  logDir: string;
  messageDir: string;
  handoffPath: string;
  eventsPath: string;
  // Tracking arrays
  phases: PhaseRuntimeState[];
  tasks: TaskRuntimeState[];
  agents: AgentRuntimeState[];
}
```

State is saved to `.ralphx/<run-id>/state.json` after every significant operation. The `updatedAt` field is refreshed on each save.

### Selectors (state/selectors.ts)

Helper functions to query state:
- `getTaskState(state, phaseId, taskId)` — find specific task
- `getPhaseState(state, phaseId)` — find specific phase
- `getPendingTasks(state)` — all pending tasks
- `getRunningTasks(state)` — all running tasks
- `isPhaseComplete(state, phaseId)` — check phase completion
- `isRunComplete(state)` — check run completion

---

## Agent System Details

### Agent Definition Interface

```typescript
interface AgentDefinition {
  id: string;
  name: string;
  capabilities: ("read" | "write" | "execute" | "commit")[];
  defaultSandbox: SandboxMode;
  buildPrompt(input: AgentInput): string;
  parseOutput?(raw: string): unknown;
}
```

### Agent Registry

Global registry at `agents/registry.ts`. Functions:
- `registerAgent(agent)` — register an agent definition
- `getAgent(id)` — retrieve by ID (throws if not found)
- `listAgents()` — list all registered agents
- `hasAgent(id)` — check existence
- `clearRegistry()` — reset (useful for tests)

All 11 default agents are registered via `registerDefaultAgents()` called at startup.

### Agent Input Context

Every agent receives rich context via `AgentInput`:

```typescript
interface AgentInput {
  task: PlanTask;                          // Current task details
  phase: PlanPhase;                        // Current phase context
  planPath: string;                        // Path to PLAN.md (in sources/)
  tasksPath: string;                       // Path to tasks.json (in sources/)
  previousOutputs: AgentOutput[];          // Outputs from prior agents on this task
  peerProgress: Map<string, string>;       // Other agents' data (e.g., diff for commit-gen)
  previousFailedAttempts: FailedAttempt[]; // QA cycle failures (prevents loops)
  failureContext?: string;                 // Error from previous retry
  attempt: number;                         // Current attempt number
  maxAttempts: number;                     // Total allowed attempts
}
```

### Prompt Building

`agents/prompts/context-builder.ts` provides utilities:
- `buildContextBlock(input)` — XML block with phase, task, plan references
- `buildPeerProgressBlock(map)` — peer agent progress data
- `buildPreviousOutputsBlock(outputs)` — prior agent outputs
- `buildFailedAttemptsBlock(attempts)` — failed QA cycle history
- `truncateText(text, maxLen)` — safely truncate large texts

### Agent Roster

| ID | Role | Sandbox | Used In Default Flow |
|---|---|---|---|
| `software-developer` | Implements task | workspace-write | Yes — step 1 |
| `qa-engineer` | Verifies implementation | read-only | Yes — step 3 |
| `refactorer` | Style improvements | workspace-write | Yes — QA loop (REFACTOR) |
| `bug-fixer` | Fix defects | workspace-write | Yes — QA loop (ISSUES) |
| `commit-generator` | Conventional commit | read-only | Yes — step 4 |
| `engineering-manager` | Triage/coordination | read-only | Available, not in default flow |
| `product-manager` | Requirements | read-only | Available, not in default flow |
| `product-designer` | UI/UX decisions | read-only | Available, not in default flow |
| `orchestrator-planner` | Dynamic planning | read-only | Available, not in default flow |
| `code-reviewer` | Code review | read-only | Available, not in default flow |
| `doc-updater` | Doc updates | workspace-write | Available, not in default flow |

---

## Quality Gates

Configurable validation pipeline in `runtime/quality-gates.ts`.

Default steps (run sequentially in the target repo's root):

1. **Format**: `bun run format` — runs code formatting
2. **Lint**: `bun run lint` — runs linting checks
3. **Check-types**: `bun run check-types` — TypeScript type check
4. **Test**: `bun run test` — runs all test suites

Stops on first failure. Returns `{ passed, failedStep, details }`.

Custom steps can be passed via the `steps` parameter to `runQualityGates()`, allowing any repo to define its own gate pipeline.

Can be skipped with `--skip-quality-gates` flag.

---

## Error Handling

### Error Categories (errors/categories.ts)

| Category | Recoverable | Max Retries | Description |
|---|---|---|---|
| `runtime_not_found` | false | 0 | CLI binary missing |
| `runtime_crash` | true | 3 | Non-zero exit from runtime |
| `runtime_timeout` | true | 2 | Exceeded timeout |
| `agent_no_changes` | true | 3 | Agent produced no file changes |
| `agent_invalid_output` | true | 2 | Unparseable output |
| `gate_format` | true | 3 | Format check failed |
| `gate_lint` | true | 3 | Lint check failed |
| `gate_types` | true | 2 | Type check failed |
| `gate_test` | true | 2 | Tests failed |
| `git_conflict` | false | 0 | Merge conflict |
| `task_blocked` | false | 0 | All retries exhausted |

### Recovery Strategies (errors/recovery.ts)

`getRecoveryStrategy(category, attemptsSoFar)` returns one of:
- `"retry"` — try again with error context
- `"retry_with_context"` — retry with detailed failure info
- `"escalate_to_em"` — dispatch engineering manager agent
- `"block_and_handoff"` — stop and write HANDOFF.md

---

## Monitoring

### HeartbeatMonitor (monitor/heartbeat.ts)

- Runs on a configurable interval (default: 30 seconds)
- Checks each running agent's start time against timeout
- Emits `process:warning` at 80% of timeout
- Emits `process:timeout` when timeout exceeded

### Watchdog (monitor/watchdog.ts)

- Subscribes to `process:timeout` events from heartbeat
- Sends SIGTERM for graceful shutdown
- Waits 5 seconds grace period
- Sends SIGKILL if still alive
- Updates agent state to `timeout`

---

## Decision Log

Append-only JSONL file at `.ralphx/<run-id>/decisions/decisions.jsonl`.

```typescript
interface Decision {
  ts: string;              // ISO timestamp
  action: DecisionAction;  // "dispatch_agent" | "qa_verdict" | "task_complete" | etc.
  agentId?: string;
  taskId?: string;
  phaseId?: string;
  rationale?: string;
  verdict?: VerifierStatus;
  notes?: string[];
  commit?: string;
  outcome?: string;
}
```

Written by the orchestrator after every significant decision. Used for:
- Resume (understanding where the run left off)
- Audit trail
- Post-run analysis

---

## Git Strategy

- **One branch per run**: `ralphx-<run-id>` (created from main)
- **One commit per task**: conventional commit format
- **No per-task branches**: avoids merge conflict complexity
- **Commit messages**: generated by AI (commit-generator agent) from diff
- **Branch created at start**: all task commits go to this branch

Git operations are in `git/operations.ts`:
- `ensureGitRepo`, `currentBranch`, `branchExists`
- `createBranch`, `checkoutBranch`, `createRunBranch`
- `ensureCleanWorkingTree`, `hasChanges`, `listChangedFiles`
- `stageAll`, `stagedDiff`, `stagedDiffStat`
- `commitStaged`, `headCommit`

---

## Run Artifacts

Everything lives in `.ralphx/<run-id>/`:

| File/Dir | Format | Purpose |
|---|---|---|
| `state.json` | JSON | Complete run state snapshot (overwritten each save) |
| `events.jsonl` | JSONL | All events chronologically (append-only) |
| `daemon.pid` | Text | Process ID for detached mode |
| `HANDOFF.md` | Markdown | Failure report with resume instructions |
| `sources/PLAN.md` | Markdown | Immutable copy of input plan |
| `sources/tasks.json` | JSON | Immutable copy of input tasks |
| `sources/team.json` | JSON | Immutable copy of team config (if provided) |
| `decisions/decisions.jsonl` | JSONL | Orchestrator decision log (append-only) |
| `progress/<task>.<agent>.md` | Markdown | Per-task agent progress summary |
| `logs/<phase>/<task>.attempt-N.step-XX.<agent>.log` | Text | Agent execution logs |
| `messages/<phase>/<task>.attempt-N.step-XX.<agent>.md` | Markdown | Agent output messages |

The `.ralphx/` directory has a `.gitignore` that ignores everything — no repo pollution.

---

## Testing

Tests use `bun:test` runner. Run with:

```bash
bun test
```

### Test Files

| File | Tests | What it covers |
|---|---|---|
| `state.test.ts` | 13 | Run state CRUD, paths, selectors, source copying |
| `event-bus.test.ts` | 4 | Event listeners, wildcard, JSONL persistence |
| `scheduler.test.ts` | 6 | Task scheduling, run completion detection |
| `decision-log.test.ts` | 3 | JSONL decision append/read |
| `agents.test.ts` | 7 | Registry, default agents, prompt building |
| `errors.test.ts` | 8 | Error categories, recovery strategies |
| `cli.test.ts` | 8 | CLI argument parsing |
| `config.test.ts` | 4 | Zod schema validation |
| `tui-store.test.ts` | 5 | TUI state management, event reducer |

### Testing Patterns

- **Dependency injection**: The orchestrator accepts a `deps` parameter with all external dependencies (git operations, file I/O, agent runner). Tests provide mocks.
- **State builders**: Tests construct minimal `RunState` objects with only the fields needed.
- **Temp directories**: File-based tests use OS temp directories for isolation.

---

## How to Contribute

### Adding a New Agent

1. Create the agent definition in `agents/built-in/` or `agents/mini/`:
   ```typescript
   import type { AgentDefinition } from "../base-agent";
   import { buildContextBlock } from "../prompts/context-builder";

   export const myAgent: AgentDefinition = {
     id: "my-agent",
     name: "My Agent",
     capabilities: ["read", "write"],
     defaultSandbox: "workspace-write",
     buildPrompt(input) {
       const context = buildContextBlock(input);
       return `You are My Agent.\n\n${context}\n\nDo the thing.`;
     },
   };
   ```

2. Register it in `agents/register-defaults.ts`:
   ```typescript
   import { myAgent } from "./built-in/my-agent";
   registerAgent(myAgent);
   ```

3. Add tests in `__tests__/agents.test.ts`.

### Adding a New Runtime Provider

1. Implement `RuntimeProvider` interface in `runtime/providers/`:
   ```typescript
   import type { RuntimeProvider } from "../provider";

   export class MyProvider implements RuntimeProvider {
     name = "my-provider";
     async execute(params) { ... }
     async isAvailable() { ... }
   }
   ```

2. Add it to `cli/commands/start.ts` runtime selection logic.

3. Add `"my-provider"` to the `RuntimeName` type in `state/types.ts`.

### Adding a New CLI Command

1. Create handler in `cli/commands/my-command.ts`.
2. Add command name to `parseCliOptions` in `cli/parse-options.ts`.
3. Add route in `cli/index.ts` switch statement.
4. Add test in `__tests__/cli.test.ts`.

### Adding a New Event Type

1. Add to `EventType` union in `monitor/types.ts`.
2. Add typed event interface.
3. Add to `RalphxEvent` discriminated union.
4. Add handler in `tui/store.ts` `applyEvent` function.

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| JSONL for events/decisions | Append-only, crash-safe, easy to tail, no corruption from partial writes |
| Source file copying | Resume works even if originals are deleted |
| One branch per run | Avoids merge conflicts between tasks |
| Dependency injection | Makes orchestrator testable without real git/runtime |
| Sequential execution | V1 simplicity; concurrency support designed in but set to 1 |
| Full-auto AI mode | V1 trusts agents via prompts; sandbox hardening deferred to V2 |
| Conventional commits | Machine-readable commit history, compatible with semantic versioning |
| QA loop with failed attempt tracking | Prevents agents from repeating the same broken approach |
| Heartbeat + watchdog | Detects and kills hung processes for unattended operation |
| Event bus decoupling | Orchestrator, TUI, and monitors don't directly depend on each other |
