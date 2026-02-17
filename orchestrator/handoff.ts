import { writeFile } from "node:fs/promises";
import type {
  FailureCategory,
  PlanPhase,
  PlanTask,
  RunState,
} from "../state/types";

export async function writeHandoff(params: {
  state: RunState;
  phase: PlanPhase;
  task: PlanTask;
  failureCategory: FailureCategory | string;
  failureDetails: string;
}): Promise<void> {
  const safeTitle = params.task.title.replace(/\s+/g, " ").trim();
  const suggestedTaskId = `${params.task.id}-fix-1`;
  const lines = [
    "# RalphX Handoff",
    "",
    `Run ID: ${params.state.runId}`,
    `Branch: ${params.state.branch}`,
    `Phase: ${params.phase.id} - ${params.phase.name}`,
    `Blocked Task: ${params.task.id} - ${safeTitle}`,
    `Failure Category: ${params.failureCategory}`,
    `Failure Details: ${params.failureDetails}`,
    "",
    "## Suggested Follow-up Task",
    "",
    `- id: ${suggestedTaskId}`,
    `- title: Fix ${params.task.id} and complete acceptance criteria`,
    `- description: Investigate failure logs, patch implementation for ${params.task.id}, rerun gates, then resume RalphX.`,
    "",
    "## Runtime Artifacts",
    "",
    `- State: ${params.state.runDir}/state.json`,
    `- Logs root: ${params.state.logDir}`,
    `- Messages root: ${params.state.messageDir}`,
    `- Decisions: ${params.state.decisionsDir}/decisions.jsonl`,
    `- Progress: ${params.state.progressDir}`,
    "",
    "## Resume Command",
    "",
    `ralphx resume --run ${params.state.runId} --allow-dirty`,
    "",
  ];
  await writeFile(params.state.handoffPath, lines.join("\n"), "utf8");
}
