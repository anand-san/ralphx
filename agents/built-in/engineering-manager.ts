import type { AgentDefinition } from "../base-agent";
import type { AgentInput } from "../../state/types";
import {
  buildContextBlock,
  buildPeerProgressBlock,
  buildPreviousOutputsBlock,
} from "../prompts/context-builder";

function buildPrompt(input: AgentInput): string {
  const peerProgress = buildPeerProgressBlock(input.peerProgress);
  const previousOutputs = buildPreviousOutputsBlock(input);

  const agentContextBlock = input.agentContext
    ? [`## Orchestrator Instructions`, input.agentContext, ""].join("\n")
    : "";

  return [
    `You are the Engineering Manager. Your role is coordination, blocker resolution, and triage.`,
    "",
    agentContextBlock,
    buildContextBlock(input),
    "",
    peerProgress,
    previousOutputs,
    "",
    `## Your Responsibilities`,
    `1. **Triage**: Analyze the current situation — what's working, what's blocked, what needs attention.`,
    `2. **Blocker Resolution**: If a task is stuck, identify the root cause and suggest a concrete path forward.`,
    `3. **Coordination**: Ensure agents are working on the right things in the right order.`,
    `4. **Escalation**: If something needs human intervention, clearly document what and why.`,
    "",
    `## Output Format`,
    `Respond in JSON format (under 1000 words):`,
    `{`,
    `  "assessment": "brief situation assessment",`,
    `  "rootCause": "identified root cause",`,
    `  "recommendedAction": "dispatch_agent" | "retry_task" | "block_task",`,
    `  "recommendedAgent": "agent-id if dispatch_agent, otherwise omit",`,
    `  "reasoning": "why this action",`,
    `  "risks": ["risk1", "risk2"]`,
    `}`,
    "",
    `End your response with a <summary> section of no more than 5000 characters that captures your key findings, decisions, and recommendations.`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export const engineeringManager: AgentDefinition = {
  id: "engineering-manager",
  name: "Engineering Manager",
  capabilities: ["read"],
  defaultSandbox: "read-only",
  buildPrompt,
  parseOutput(raw: string): {
    assessment: string;
    rootCause: string;
    recommendedAction: string;
    recommendedAgent?: string;
    reasoning: string;
    risks: string[];
  } {
    const trimmed = raw.trim();
    let jsonStr = trimmed;
    // Strip markdown code fences if present
    if (trimmed.startsWith("```")) {
      const lines = trimmed.split("\n");
      if (lines.length >= 3) {
        jsonStr = lines.slice(1, -1).join("\n").trim();
      }
    }
    // Try to extract JSON from the response
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    const parsed = JSON.parse(jsonStr) as {
      assessment: string;
      rootCause: string;
      recommendedAction: string;
      recommendedAgent?: string;
      reasoning: string;
      risks: string[];
    };
    return parsed;
  },
};
