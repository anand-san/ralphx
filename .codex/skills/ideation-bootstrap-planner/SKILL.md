---
name: ideation-bootstrap-planner
description: Convert a product/app idea into a repo-specific implementation plan for this stack-template monorepo (Bun workspace with Vite React frontend, Hono backend, shared package, Firebase). Use when a user says they want to build something (for example, "build xyz"), needs bootstrapping guidance, or asks for phased execution planning. Ask clarifying questions only when required, perform focused research when the domain or integrations are unclear, and generate PLAN.md plus tasks.json mapped to this repository structure.
---

Turn a raw idea into a practical execution plan for this repository.

## Core Outcome

Produce two files at project root:

- `docs/ideation/PLAN.md`: phase-by-phase implementation plan.
- `docs/ideation/tasks.json`: machine-readable task list grouped by phase.

Use this repository's architecture and commands, not generic templates.

## Required Workflow

1. Confirm scope from user input

- Extract goal, target users, core workflow, and non-goals.
- Record assumptions if input is incomplete.

2. Ask only required clarifying questions

- Ask questions only when missing answers materially change architecture or phase order.
- Ask at most 5 concise questions in one round.
- Prefer closed choices when possible.
- If user does not answer, continue with explicit assumptions.

3. Load repository context

- Read `AGENTS.md`, `README.md`, root `package.json`, `frontend/package.json`, and `server/package.json`.
- Align planning to:
  - `frontend/` for UI, pages, state, API clients, and tests.
  - `server/` for Hono routes, middleware, services, and tests.
  - `shared/` for shared types and config.

4. Perform focused research when needed

- Do local repo research first.
- Do web research if the idea depends on unfamiliar libraries, third-party APIs, security/compliance requirements, or complex domain rules.
  - Use context7 MCP server to read docs of frameworks if needed
- Capture findings as short bullets with links inside `PLAN.md` under `Research Notes`.
- Distinguish confirmed facts from assumptions.

5. Design phased implementation

- Break work into ordered phases where each phase can be validated.
- Keep phases outcome-driven.
- Define dependencies and risk per phase.
- Ensure each phase maps to concrete folders/files in this repo.

6. Generate `PLAN.md`

- Use `references/plan-template.md`.
- Keep language specific and implementation-focused.
- Include architecture decisions for frontend, server, shared, and Firebase usage.
- Include testing, observability, and rollout strategy.
- Include testing tasks for both happy path and key error paths.

7. Generate `tasks.json`

- This is an array of tasks that a user or AI needs to perform step by step in order to complete a plan phase
- Use template from `tasks-template.json`
- Convert each phase into actionable task objects.
- Include acceptance criteria and dependencies per task.

8. Run quality gate before finalizing

- Verify `PLAN.md` and `tasks.json` are consistent and phase names match exactly.
- Ensure no phase is missing test tasks.
- Ensure commands use Bun and existing workspace scripts.
- Ensure unknowns are captured in `Open Questions` rather than hidden.

## Planning Rules

- Prefer simple vertical slices before broad platform work.
- Plan MVP-first; defer optional enhancements to later phases.
- Keep each phase independently reviewable.
- Do not include code unless user explicitly asks.
- Do not invent APIs, environment variables, or infra details without labeling assumptions.

## Output Contract

`PLAN.md` must include:

- Problem Statement
- Solution Overview
- Assumptions and Constraints
- Repo Impact Map
- Phase Plan
- Testing Strategy
- Risks and Mitigations
- Research Notes
- Open Questions

`tasks.json` must include:

- Top-level metadata: `idea`, `generatedAt`, `repo`, `phases`
- Phase entries matching `PLAN.md` names
- Task objects with required fields:
  - `id` (number)
  - `status` (pending, done)
  - `title` (task title)
  - `description` (detailed task context)
  - `notes` (any additional notes from previous tasks)

Task object example:

```json
{
  "id": "task-001",
  "status": "todo",
  "title": "Create todo route",
  "description": "Add Hono endpoints for todo CRUD with validation and error handling.",
  "notes": ["Endpoints should be under /api/"]
}
```

Load these references when needed:

- `plan-template.md`
- `tasks-template.json`
