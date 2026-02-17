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
    "",
    `## Instructions`,
    `Analyze all available context and produce a JSON response with your recommendation.`,
    `You must output valid JSON matching this schema:`,
    `{`,
    `  "contextBriefing": "Compact summary of run progress so far...",`,
    `  "recommendation": {`,
    `    "action": "dispatch_agent" | "skip_task" | "block_task" | "retry_task",`,
    `    "agentId": "software-developer" | "qa-engineer" | "engineering-manager" | ...,`,
    `    "taskId": "task-xxx",`,
    `    "rationale": "Why this action",`,
    `    "agentContext": "Specific instructions for the agent",`,
    `    "scope": ["file/path/hints"]`,
    `  },`,
    `  "warnings": ["any concerns"]`,
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
  return JSON.parse(jsonStr) as PlannerRecommendation;
}

export const orchestratorPlanner: AgentDefinition = {
  id: "orchestrator-planner",
  name: "Orchestrator Planner",
  capabilities: ["read"],
  defaultSandbox: "read-only",
  buildPrompt,
  parseOutput,
};
