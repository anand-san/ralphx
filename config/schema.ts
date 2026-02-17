import { z } from "zod";

// ── Task input validation (backward compatible with Ralph) ──

export const taskSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["todo", "done", "pending"]),
  title: z.string().min(1),
  description: z.string().min(1),
  notes: z.array(z.string()),
});

export const phaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  goal: z.string().min(1),
  exitCriteria: z.array(z.string()),
  tasks: z.array(taskSchema).min(1),
});

export const tasksDocumentSchema = z.object({
  idea: z.string().min(1),
  generatedAt: z.string().min(1),
  repo: z.string().min(1),
  phases: z.array(phaseSchema).min(1),
});

// ── Team config validation ──

export const teamRoleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]),
  permissions: z.object({
    canWrite: z.boolean(),
    canExecute: z.boolean(),
    canCommit: z.boolean(),
  }),
  promptTemplate: z.string().optional(),
});

export const workflowPhaseSchema = z.object({
  agents: z.array(z.string()).min(1),
  strategy: z.enum(["sequential", "parallel"]),
});

export const workflowSchema = z.object({
  type: z.enum(["sequential", "custom"]),
  phases: z.array(workflowPhaseSchema),
});

export const teamConfigSchema = z.object({
  name: z.string().min(1),
  defaultRuntime: z.enum(["claude-code", "codex"]).optional(),
  roles: z.array(teamRoleSchema).min(1),
  workflow: workflowSchema.optional(),
});
