# Skill: RalphX CLI Agent

You are an AI agent that operates the RalphX multi-agent orchestration system via its CLI. Use this skill to start, monitor, resume, and manage long-running autonomous development runs.

## Prerequisites

- Working directory must be the repository root (where `package.json` with ralphx scripts lives)
- `bun` must be installed and in PATH
- The chosen runtime CLI must be available:
  - Claude Code: `claude` binary in PATH
  - Codex: `codex` binary in PATH
- Input files must exist: a PLAN.md and a tasks.json (defaults: `PLAN.md` and `tasks.json`)

## Commands Reference

### Start a New Run

Starts a fresh orchestration run. Creates a git branch `ralphx-<run-id>`, copies input files to `.ralphx/<run-id>/sources/`, and begins executing tasks.

```bash
ralphx start \
  --plan <path-to-plan.md> \
  --tasks <path-to-tasks.json> \
  [options]
```

**Required inputs:**
- `--plan <path>` — Path to the PLAN.md file (default: `PLAN.md`)
- `--tasks <path>` — Path to the tasks.json file (default: `tasks.json`)

**Options:**
| Flag | Default | Description |
|---|---|---|
| `--runtime <name>` | `claude-code` | AI runtime: `claude-code` or `codex` |
| `--team <path>` | none | Custom team configuration JSON file |
| `--retry <n>` | `3` | Max retry attempts per task |
| `--timeout <ms>` | `600000` | Per-agent timeout in milliseconds |
| `--heartbeat-interval <ms>` | `30000` | Health check interval in milliseconds |
| `--concurrency <n>` | `1` | Max parallel agents |
| `--model <name>` | runtime default | Override AI model |
| `--no-tui` | false | Disable TUI, plain log output |
| `--detached` | false | Run as background daemon (implies --no-tui) |
| `--skip-quality-gates` | false | Skip format/lint/type-check/test validation |
| `--allow-dirty` | false | Allow uncommitted changes in working tree |
| `--dry-run` | false | Print task plan without executing |

**Constraints:**
- Must be on `main` branch when starting (creates a new branch automatically)
- Working tree must be clean unless `--allow-dirty` is set
- The `--plan` file is free-form Markdown; `--tasks` must be valid JSON matching the TasksDocument schema

**Example — foreground run:**
```bash
ralphx start \
  --plan PLAN.md \
  --tasks tasks.json \
  --runtime claude-code \
  --retry 5
```

**Example — background daemon:**
```bash
ralphx start \
  --plan PLAN.md \
  --tasks tasks.json \
  --detached
```

**Output:** Prints the run ID (format: `YYYYMMDD-HHMMSS`). Save this — you need it for all other commands.

---

### Resume a Blocked/Stopped Run

Picks up where a previous run left off. Reads from `.ralphx/<run-id>/sources/` (not original file paths). Resets blocked tasks to pending.

```bash
ralphx resume --run <run-id> [options]
```

**Required:** `--run <run-id>`

Accepts same options as `start` except `--plan` and `--tasks` (already in sources/).

**When to use:**
- Run was blocked on a task and you want to retry after manual fixes
- Run was stopped via `stop` command
- Process crashed and you want to continue

**Example:**
```bash
ralphx resume --run 20260217-103000 --allow-dirty
```

---

### Attach to a Running Daemon

Shows live status and tails events from a detached run.

```bash
ralphx attach --run <run-id>
```

**Output:** Displays run metadata, phase/task status, and last 10 events from `events.jsonl`. Shows whether the daemon process is still alive.

---

### Stop a Daemon

Gracefully stops a background orchestrator process.

```bash
ralphx stop --run <run-id>
```

Sends SIGTERM, waits 10 seconds, then SIGKILL if still alive.

---

### Check Run Status

Displays detailed status of a specific run.

```bash
ralphx status --run <run-id>
```

**Output:** Run metadata, task progress summary (passed/running/pending/failed/blocked), all phases and tasks with their current state.

---

### List All Runs

Scans `.ralphx/` directory for all past and current runs.

```bash
ralphx list
```

**Output:** Table of runs sorted by creation date (newest first) showing: run ID, status, progress, runtime, branch, timestamps.

---

## tasks.json Schema

The `--tasks` input must follow this exact structure:

```json
{
  "idea": "Brief description of what's being built",
  "generatedAt": "ISO timestamp",
  "repo": "repository-name",
  "phases": [
    {
      "id": "phase-1",
      "name": "Phase Name",
      "goal": "What this phase accomplishes",
      "exitCriteria": ["Criterion 1", "Criterion 2"],
      "tasks": [
        {
          "id": "task-1-1",
          "status": "todo",
          "title": "Task title",
          "description": "Detailed description of what to implement",
          "notes": ["Implementation hint 1", "Implementation hint 2"]
        }
      ]
    }
  ]
}
```

**Task status values:** `"todo"` (not started), `"done"` (already completed, will be skipped), `"pending"` (waiting)

---

## Run Lifecycle for Agent Automation

### Starting a Long-Running Process

To spawn RalphX as a long-running background process from another agent:

1. **Verify prerequisites:**
   ```bash
   # Check runtime is available
   claude --version  # or: codex --version

   # Check working tree is clean
   git status --porcelain

   # Check we're on main
   git branch --show-current
   ```

2. **Start in detached mode:**
   ```bash
   ralphx start \
     --plan PLAN.md \
     --tasks tasks.json \
     --detached \
     --retry 5
   ```

3. **Capture the run ID** from stdout (format: `YYYYMMDD-HHMMSS`)

4. **Monitor periodically:**
   ```bash
   ralphx status --run <run-id>
   ```

5. **Check if complete:**
   - Read `.ralphx/<run-id>/state.json` and check `"status"` field
   - `"completed"` = all tasks done
   - `"blocked"` = intervention needed (check `.ralphx/<run-id>/HANDOFF.md`)
   - `"running"` = still in progress

6. **If blocked, review and resume:**
   ```bash
   # Read the handoff
   cat .ralphx/<run-id>/HANDOFF.md

   # Make manual fixes if needed, then:
   ralphx resume --run <run-id> --allow-dirty
   ```

### Monitoring a Running Process

```bash
# Quick status check
ralphx status --run <run-id>

# Tail live events
tail -f .ralphx/<run-id>/events.jsonl

# Check if daemon is alive
cat .ralphx/<run-id>/daemon.pid | xargs ps -p

# Read recent decisions
tail -20 .ralphx/<run-id>/decisions/decisions.jsonl

# Read agent logs for a specific task
ls .ralphx/<run-id>/logs/<phase-id>/
cat .ralphx/<run-id>/logs/<phase-id>/<task-id>.attempt-1.step-01.software-developer.log
```

### Polling Pattern for Automation

When spawning from another agent, use this polling pattern:

```bash
# Start the run
RUN_ID=$(ralphx start --detached --plan ... --tasks ... 2>&1 | grep "Run ID:" | awk '{print $3}')

# Poll until complete (check every 60 seconds)
while true; do
  STATUS=$(cat .ralphx/$RUN_ID/state.json | bun -e "const s=JSON.parse(await Bun.stdin.text()); console.log(s.status)")
  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "blocked" ]; then
    echo "Run finished with status: $STATUS"
    break
  fi
  sleep 60
done
```

---

## Error Recovery

| Situation | Action |
|---|---|
| Run blocked on a task | Read `HANDOFF.md`, fix the issue, then `resume --run <id> --allow-dirty` |
| Runtime not found | Install the CLI (`claude` or `codex`) and ensure it's in PATH |
| Dirty working tree | Either commit/stash changes, or use `--allow-dirty` |
| Not on main branch | Switch to main before starting: `git checkout main` |
| All retries exhausted | Increase `--retry` and resume, or fix manually and resume |
| Daemon won't stop | `kill -9 $(cat .ralphx/<run-id>/daemon.pid)` |
| Quality gate failures | Fix the code issue, or use `--skip-quality-gates` for the resume |

---

## Key Paths

| Path | Purpose |
|---|---|
| `.ralphx/<run-id>/state.json` | Complete run state (read for status) |
| `.ralphx/<run-id>/events.jsonl` | Event stream (tail for live monitoring) |
| `.ralphx/<run-id>/HANDOFF.md` | Failure report with resume instructions |
| `.ralphx/<run-id>/daemon.pid` | PID file for detached mode |
| `.ralphx/<run-id>/sources/` | Immutable copies of input files |
| `.ralphx/<run-id>/decisions/decisions.jsonl` | Orchestrator decision log |
| `.ralphx/<run-id>/progress/` | Per-task agent progress reports |
| `.ralphx/<run-id>/logs/` | Agent execution logs |
| `.ralphx/<run-id>/messages/` | Agent output messages |
