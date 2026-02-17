import type { AgentDefinition } from "../base-agent";
import type { AgentInput } from "../../state/types";
import { buildContextBlock } from "../prompts/context-builder";

function buildPrompt(input: AgentInput): string {
  return [
    `You are the Product Designer. Your role is UI/UX decisions for tasks involving user interface changes.`,
    "",
    buildContextBlock(input),
    "",
    `## Your Responsibilities`,
    `1. **UI/UX Review**: Analyze the task from a user experience perspective.`,
    `2. **Component Selection**: Recommend appropriate UI components (prefer shadcn/ui with Radix).`,
    `3. **Layout Guidance**: Suggest layout structure, spacing, and visual hierarchy.`,
    `4. **Accessibility**: Ensure the proposed UI meets accessibility standards.`,
    `5. **Consistency**: Ensure the design is consistent with existing patterns in the app.`,
    "",
    `## Output Format`,
    `Provide structured design guidance with:`,
    `- UI component recommendations`,
    `- Layout structure`,
    `- Interaction patterns`,
    `- Accessibility considerations`,
  ].join("\n");
}

export const productDesigner: AgentDefinition = {
  id: "product-designer",
  name: "Product Designer",
  capabilities: ["read"],
  defaultSandbox: "read-only",
  buildPrompt,
};
