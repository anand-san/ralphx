import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentInput,
  AgentOutput,
  FailedAttempt,
  PlanPhase,
  PlanTask,
  PlannerRecommendation,
  RunState,
  TasksDocument,
} from "../state/types";
import type { RuntimeProvider } from "../runtime/provider";
import type { EventBus } from "../monitor/event-bus";
import { tasksDocumentSchema } from "../config/schema";
import { getAgent } from "../agents/registry";
import { runAgent } from "../agents/agent-runner";

/**
 * Load the tasks document from the sources directory (copied at start).
 */
export async function loadTasksFromSources(
  sourcesDir: string,
): Promise<TasksDocument> {
  const raw = await readFile(join(sourcesDir, "tasks.json"), "utf8");
  return tasksDocumentSchema.parse(JSON.parse(raw) as unknown);
}

/**
 * Load the plan from the sources directory.
 */
export async function loadPlanFromSources(sourcesDir: string): Promise<string> {
  return readFile(join(sourcesDir, "PLAN.md"), "utf8");
}

/**
 * Get the plan path pointing to the sources copy (for agent prompts).
 */
export function getSourcesPlanPath(sourcesDir: string): string {
  return join(sourcesDir, "PLAN.md");
}

/**
 * Get the tasks path pointing to the sources copy (for agent prompts).
 */
export function getSourcesTasksPath(sourcesDir: string): string {
  return join(sourcesDir, "tasks.json");
}

/**
 * Mark a task as "done" in the sources/tasks.json file.
 * This persists completion status so that a fresh `start` with the same
 * file skips already-completed tasks.
 */
export async function markTaskDoneInSources(
  sourcesDir: string,
  taskId: string,
): Promise<void> {
  const tasksPath = join(sourcesDir, "tasks.json");
  const raw = await readFile(tasksPath, "utf8");
  const doc = JSON.parse(raw) as TasksDocument;

  for (const phase of doc.phases) {
    for (const task of phase.tasks) {
      if (task.id === taskId) {
        task.status = "done";
      }
    }
  }

  await writeFile(tasksPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

// ── Planner consultation ──

export interface PlannerConsultParams {
  state: RunState;
  phase: PlanPhase;
  task: PlanTask;
  runtime: RuntimeProvider;
  eventBus: EventBus;
  previousOutputs: AgentOutput[];
  peerProgress: Map<string, string>;
  failedAttempts: FailedAttempt[];
  failureContext?: string;
  attempt: number;
  maxAttempts: number;
  stepSequence: number;
  model?: string;
  streamOutput: boolean;
  timeout?: number;
}

export async function consultPlanner(
  params: PlannerConsultParams,
): Promise<{ recommendation: PlannerRecommendation; output: AgentOutput }> {
  const plannerAgent = getAgent("orchestrator-planner");

  const input: AgentInput = {
    task: params.task,
    phase: params.phase,
    planPath: getSourcesPlanPath(params.state.sourcesDir),
    tasksPath: getSourcesTasksPath(params.state.sourcesDir),
    previousOutputs: params.previousOutputs,
    peerProgress: params.peerProgress,
    previousFailedAttempts: params.failedAttempts,
    failureContext: params.failureContext,
    attempt: params.attempt,
    maxAttempts: params.maxAttempts,
  };

  const output = await runAgent({
    agent: plannerAgent,
    input,
    runtime: params.runtime,
    state: params.state,
    stepSequence: params.stepSequence,
    eventBus: params.eventBus,
    model: params.model,
    streamOutput: params.streamOutput,
    timeout: params.timeout,
  });

  if (!output.parsed) {
    throw new Error(
      `Planner output not parseable: ${output.raw.slice(0, 300)}`,
    );
  }

  return {
    recommendation: output.parsed as PlannerRecommendation,
    output,
  };
}
