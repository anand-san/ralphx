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

  return [
    `You are the Engineering Manager. Your role is coordination, blocker resolution, and triage.`,
    "",
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
    `Provide a structured analysis with:`,
    `- Current status assessment`,
    `- Identified blockers (if any)`,
    `- Recommended next actions`,
    `- Risk areas to watch`,
  ].join("\n");
}

export const engineeringManager: AgentDefinition = {
  id: "engineering-manager",
  name: "Engineering Manager",
  capabilities: ["read"],
  defaultSandbox: "read-only",
  buildPrompt,
};
