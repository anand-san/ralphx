import { z } from "zod";

// ── Task input validation (backward compatible with Ralph) ──

export const taskSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["todo", "done", "pending"]),
  title: z.string().min(1),
  description: z.string().min(1),
  notes: z.array(z.string()),
});

export const phaseSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    goal: z.string().min(1),
    exitCriteria: z.array(z.string()),
    tasks: z.array(taskSchema).min(1),
  })
  .superRefine((phase, ctx) => {
    const seen = new Set<string>();
    for (const task of phase.tasks) {
      if (seen.has(task.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate task ID "${task.id}" within phase "${phase.id}"`,
        });
      }
      seen.add(task.id);
    }
  });

export const tasksDocumentSchema = z
  .object({
    idea: z.string().min(1),
    generatedAt: z.string().min(1),
    repo: z.string().min(1),
    phases: z.array(phaseSchema).min(1),
  })
  .superRefine((doc, ctx) => {
    const phaseIds = new Set<string>();
    const taskIds = new Set<string>();
    for (const phase of doc.phases) {
      if (phaseIds.has(phase.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate phase ID "${phase.id}"`,
        });
      }
      phaseIds.add(phase.id);
      for (const task of phase.tasks) {
        if (taskIds.has(task.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate task ID "${task.id}" across phases`,
          });
        }
        taskIds.add(task.id);
      }
    }
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
