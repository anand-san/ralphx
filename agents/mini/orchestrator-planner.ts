import type { AgentDefinition } from "../base-agent";
import type { AgentInput, PlannerRecommendation } from "../../state/types";

function buildWorkflowStage(input: AgentInput): string {
  const agentsDone = new Set<string>();
  let qaCount = 0;

  for (const o of input.previousOutputs) {
    agentsDone.add(o.agentId);
    if (o.agentId === "qa-engineer") qaCount++;
  }

  const lines: string[] = ["## Workflow Stage"];
  lines.push(
    `- PM consulted: ${agentsDone.has("product-manager") ? "yes" : "no"}`,
  );
  lines.push(
    `- PD consulted: ${agentsDone.has("product-designer") ? "yes" : "no"}`,
  );
  lines.push(
    `- DEV completed: ${agentsDone.has("software-developer") || agentsDone.has("refactorer") || agentsDone.has("bug-fixer") ? "yes" : "no"}`,
  );
  lines.push(`- QA cycles: ${qaCount}`);
  lines.push(
    `- Agents dispatched so far: ${agentsDone.size > 0 ? [...agentsDone].join(", ") : "none"}`,
  );

  // Show implementer/reviewer from peerProgress if available
  const implementer = input.peerProgress.get("implementer");
  const reviewer = input.peerProgress.get("reviewer");
  if (implementer) lines.push(`- Configured implementer: ${implementer}`);
  if (reviewer) lines.push(`- Configured reviewer: ${reviewer}`);

  return lines.join("\n");
}

function buildPrompt(input: AgentInput): string {
  const peerProgressEntries: string[] = [];
  for (const [key, value] of input.peerProgress) {
    peerProgressEntries.push(`### ${key}\n${value}`);
  }
  const peerProgressBlock =
    peerProgressEntries.length > 0
      ? `## Progress Files\n${peerProgressEntries.join("\n\n")}`
      : "## Progress Files\n(none yet)";

  const previousOutputsBlock =
    input.previousOutputs.length > 0
      ? `## Previous Agent Outputs\n${input.previousOutputs.map((o) => `### ${o.agentId} (exit: ${o.exitCode})\n${o.raw.slice(0, 2000)}`).join("\n\n")}`
      : "";

  const failureBlock = input.failureContext
    ? `## Previous Failure\nThe last attempt failed:\n${input.failureContext}\n\nYou MUST account for this failure in your recommendation.`
    : "";

  const workflowStage = buildWorkflowStage(input);

  return [
    `You are the orchestrator planner. Your job is to analyze the current run state and recommend the next action.`,
    "",
    `## Current Task`,
    `- ID: ${input.task.id}`,
    `- Title: ${input.task.title}`,
    `- Description: ${input.task.description}`,
    `- Attempt: ${input.attempt}/${input.maxAttempts}`,
    "",
    `## Phase`,
    `- ID: ${input.phase.id}`,
    `- Name: ${input.phase.name}`,
    `- Goal: ${input.phase.goal}`,
    "",
    workflowStage,
    "",
    `## Typical Workflow`,
    `The standard workflow is: product-manager (refine requirements, optional) → product-designer (UI guidance, optional) → software-developer (implement) → quality gates (auto) → qa-engineer (review) → fix agent if needed → commit.`,
    `PM and PD are optional advisory steps before implementation. DEV must run before QA.`,
    "",
    `## Constraints`,
    `- A write agent (software-developer, refactorer, bug-fixer) MUST run before qa-engineer can review.`,
    `- product-manager and product-designer are optional pre-dev advisory agents — skip them for straightforward tasks.`,
    `- Maximum QA cycles is enforced externally — focus on choosing the right fix agent when QA reports issues.`,
    `- When QA returns DONE, use "task_complete" action.`,
    "",
    `## Plan File: ${input.planPath}`,
    `## Tasks File: ${input.tasksPath}`,
    "",
    peerProgressBlock,
    previousOutputsBlock,
    failureBlock,
    "",
    `## Decision Logic`,
    `- **dispatch_agent**: Task is ready to proceed. Set agentId to the agent that should handle it and provide specific agentContext instructions.`,
    `- **retry_task**: Previous attempt failed but the approach is still valid. Provide rationale explaining what to do differently.`,
    `- **skip_task**: Task is no longer needed (e.g., superseded by another task's changes). Explain why.`,
    `- **block_task**: Task cannot proceed due to unresolved dependencies or unclear requirements. Explain what's blocking.`,
    `- **task_complete**: QA has approved the implementation (DONE verdict). Signal that the task is ready to commit.`,
    "",
    `## Output Format`,
    `You must output valid JSON matching this schema:`,
    `{`,
    `  "contextBriefing": "Compact summary of run progress so far...",`,
    `  "recommendation": {`,
    `    "action": "dispatch_agent" | "skip_task" | "block_task" | "retry_task" | "task_complete",`,
    `    "agentId": "software-developer" | "refactorer" | "bug-fixer" | "qa-engineer" | "engineering-manager" | "product-manager" | "product-designer",`,
    `    "taskId": "task-xxx",`,
    `    "rationale": "Why this action — be specific",`,
    `    "agentContext": "Specific instructions or focus areas for the dispatched agent",`,
    `    "scope": ["file/path/hints for the agent to focus on"]`,
    `  },`,
    `  "warnings": ["any concerns or risks to flag"]`,
    `}`,
    "",
    `Output JSON only. No markdown, no explanation outside the JSON.`,
  ].join("\n");
}

function parseOutput(raw: string): PlannerRecommendation {
  const trimmed = raw.trim();
  let jsonStr = trimmed;
  if (trimmed.startsWith("```")) {
    const lines = trimmed.split("\n");
    if (lines.length >= 3) {
      jsonStr = lines.slice(1, -1).join("\n").trim();
    }
  }
  const parsed = JSON.parse(jsonStr);
  if (!parsed.contextBriefing || !parsed.recommendation) {
    throw new Error(
      `Invalid planner output: missing contextBriefing or recommendation. Got: ${jsonStr.slice(0, 300)}`,
    );
  }
  return parsed as PlannerRecommendation;
}

export const orchestratorPlanner: AgentDefinition = {
  id: "orchestrator-planner",
  name: "Orchestrator Planner",
  capabilities: ["read"],
  defaultSandbox: "read-only",
  buildPrompt,
  parseOutput,
};
