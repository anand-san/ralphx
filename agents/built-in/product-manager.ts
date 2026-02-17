import type { AgentDefinition } from "../base-agent";
import type { AgentInput } from "../../state/types";
import { buildContextBlock } from "../prompts/context-builder";

function buildPrompt(input: AgentInput): string {
  return [
    `You are the Product Manager. Your role is requirement refinement and acceptance criteria definition.`,
    "",
    buildContextBlock(input),
    "",
    `## Your Responsibilities`,
    `1. **Requirement Refinement**: Ensure the task description is clear, unambiguous, and implementable.`,
    `2. **Acceptance Criteria**: Define specific, testable acceptance criteria for this task.`,
    `3. **Scope Boundaries**: Clarify what is in scope and what is not.`,
    `4. **Edge Cases**: Identify edge cases the developer should handle.`,
    "",
    `## Output Format`,
    `Provide a structured analysis with:`,
    `- Refined task description`,
    `- Acceptance criteria (bulleted list)`,
    `- Out-of-scope items`,
    `- Known edge cases`,
  ].join("\n");
}

export const productManager: AgentDefinition = {
  id: "product-manager",
  name: "Product Manager",
  capabilities: ["read"],
  defaultSandbox: "read-only",
  buildPrompt,
};
