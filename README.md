# RalphX

Multi-agent AI orchestration system for autonomous code generation runs.

RalphX coordinates multiple AI agents (developer, QA, refactorer, bug-fixer, commit-generator) to implement tasks from a structured plan, with quality gates, retry logic, and recovery strategies.

## Prerequisites

- [Bun](https://bun.sh) runtime
- A git repository with a clean working tree
- One of the supported runtime CLIs installed and in PATH:
  - `codex` (default)
  - `claude` (Claude Code CLI)

## Quick Start

```bash
cd /path/to/your/project   # must be a git repo

# Dry run — validates plan/tasks/team inputs, prints phases/tasks, no execution
bun /path/to/ralphx/cli/index.ts start --dry-run

# Run
bun /path/to/ralphx/cli/index.ts start
```

## Usage

```
bun cli/index.ts <command> [options]
```

### Commands

| Command             | Description                      |
| ------------------- | -------------------------------- |
| `start`             | Start a new run                  |
| `resume --run <id>` | Resume a blocked/interrupted run |
| `attach --run <id>` | Attach to a running session      |
| `stop --run <id>`   | Stop a running session           |
| `status --run <id>` | Show run status                  |
| `list`              | List all runs                    |

### Options

| Flag                        | Default             | Description                                                                                     |
| --------------------------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| `--plan <path>`             | `PLAN.md`           | Path to the plan markdown file                                                                  |
| `--tasks <path>`            | `tasks.json`        | Path to the tasks JSON file                                                                     |
| `--runtime <name>`          | `codex`             | Runtime CLI to use (`codex` or `claude-code`)                                                   |
| `--team <path>`             | _(none)_            | Path to team config JSON. When it sets `defaultRuntime`, that runtime is used unless `--runtime` is passed |
| `--model <name>`            | _(runtime default)_ | Model to pass to the runtime CLI. When omitted, the runtime CLI uses its own configured default |
| `--retry <n>`               | `3`                 | Number of retries per task (total attempts = retry + 1)                                         |
| `--timeout <ms>`            | `600000`            | Timeout per agent invocation (10 minutes)                                                       |
| `--heartbeat-interval <ms>` | `30000`             | Heartbeat check interval (30 seconds)                                                           |
| `--no-tui`                  | `false`             | Disable the TUI, use plain stdout                                                               |
| `--detached`                | `false`             | Run as a background daemon                                                                      |
| `--skip-quality-gates`      | `false`             | Skip format/lint/types/test checks                                                              |
| `--allow-dirty`             | `false`             | Allow starting with uncommitted changes                                                         |
| `--dry-run`                 | `false`             | Validate inputs and print plan without executing                                                |

## Input Files

### tasks.json

```json
{
  "idea": "What you're building",
  "generatedAt": "2026-02-17T00:00:00Z",
  "repo": "your-repo-name",
  "phases": [
    {
      "id": "phase-1",
      "name": "Phase name",
      "goal": "What this phase achieves",
      "exitCriteria": ["All tests pass", "Types check clean"],
      "tasks": [
        {
          "id": "task-001",
          "status": "todo",
          "title": "Task title",
          "description": "Detailed description of what to implement",
          "notes": ["Hint or constraint 1", "Hint 2"]
        }
      ]
    }
  ]
}
```

- Phase IDs must be unique across the document
- Task IDs must be unique across all phases
- Task status must be `"todo"`, `"done"`, or `"pending"`
- Each phase must have at least one task

### PLAN.md

Free-form markdown describing the overall implementation plan. All agents receive this as context.

### team.json (optional)

```json
{
  "name": "my-team",
  "defaultRuntime": "codex",
  "roles": [
    {
      "id": "software-developer",
      "name": "Software Developer",
      "sandbox": "workspace-write",
      "permissions": {
        "canWrite": true,
        "canExecute": true,
        "canCommit": false
      }
    },
    {
      "id": "qa-engineer",
      "name": "QA Engineer",
      "sandbox": "read-only",
      "permissions": {
        "canWrite": false,
        "canExecute": false,
        "canCommit": false
      }
    }
  ]
}
```

The implementer is the first role with `canWrite: true`. The reviewer is the first role with `qa` or `review` in its ID.

## How It Works

1. **Branch creation** — creates `ralphx/<run-id>` branch
2. **For each task:**
   - Dispatches the implementer agent (default: `software-developer`)
   - Runs quality gates (format, lint, types, test)
   - Dispatches the reviewer agent (default: `qa-engineer`)
   - On QA issues: dispatches `refactorer` or `bug-fixer` agent
   - On QA approval: dispatches `commit-generator` agent, commits changes
3. **On failure** — categorizes the error and applies recovery strategy (retry, auto-fix, escalate to EM, or block and hand off)
4. **State** is saved to `.ralphx/<run-id>/state.json` after every step

### Recovery Strategies

| Category                   | Strategy                                       |
| -------------------------- | ---------------------------------------------- |
| Runtime crash / timeout    | Retry with context, escalate after max retries |
| No changes produced        | Retry with context                             |
| Format / lint gate failure | Auto-fix via refactorer agent                  |
| Type / test gate failure   | Escalate to engineering-manager agent          |
| Git conflict               | Block and hand off                             |

### Signal Handling

- `SIGINT` (Ctrl+C) / `SIGTERM` — saves state as `"blocked"`, writes HANDOFF.md, exits cleanly
- Resume with `bun cli/index.ts resume --run <id>`

### Detached Mode

```bash
bun cli/index.ts start --detached --tasks tasks.json --plan PLAN.md
```

Parent prints the run ID and daemon log path immediately. The child PID is written to `.ralphx/<run-id>/daemon.pid`, and daemon output is appended to `.ralphx/<run-id>/daemon.log`.

## Run Directory Structure

```
.ralphx/<run-id>/
  state.json          # Full run state
  events.jsonl        # Event log
  HANDOFF.md          # Written on block/failure
  daemon.pid          # PID file (detached mode)
  daemon.log          # Log file (detached mode)
  sources/            # Copies of plan, tasks, team config
  decisions/          # Decision log (JSONL)
  progress/           # Per-task agent progress files
  logs/               # Per-step execution logs
  messages/           # Per-step agent output
```

## Development

```bash
bun install
bun test                # Run tests
bun run check-types     # TypeScript type checking
bun run format          # Prettier formatting
```
