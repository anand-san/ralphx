import type { AgentDefinition } from "../base-agent";
import type { AgentInput, PlannerRecommendation } from "../../state/types";

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
    "",
    `## Output Format`,
    `You must output valid JSON matching this schema:`,
    `{`,
    `  "contextBriefing": "Compact summary of run progress so far...",`,
    `  "recommendation": {`,
    `    "action": "dispatch_agent" | "skip_task" | "block_task" | "retry_task",`,
    `    "agentId": "software-developer" | "qa-engineer" | "engineering-manager" | "product-manager" | "product-designer",`,
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
