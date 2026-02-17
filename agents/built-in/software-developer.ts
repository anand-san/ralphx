import type { AgentDefinition } from "../base-agent";
import type { AgentInput } from "../../state/types";
import {
  buildContextBlock,
  buildFailedAttemptsBlock,
  buildPeerProgressBlock,
  buildPreviousOutputsBlock,
} from "../prompts/context-builder";

function buildPrompt(input: AgentInput): string {
  const retryContext = input.failureContext
    ? [
        `<previous_failure_analysis>`,
        `  CRITICAL: The previous implementation failed.`,
        `  Reasons:`,
        `  ${input.failureContext}`,
        `  INSTRUCTION: You must address these failures specifically. Do not repeat the same mistakes.`,
        `</previous_failure_analysis>`,
      ].join("\n")
    : "";

  const peerProgress = buildPeerProgressBlock(input.peerProgress);
  const previousOutputs = buildPreviousOutputsBlock(input);
  const failedAttempts = buildFailedAttemptsBlock(input.previousFailedAttempts);

  return [
    `Your goal is to implement the task defined in the context below.`,
    "",
    buildContextBlock(input),
    "",
    retryContext,
    peerProgress,
    previousOutputs,
    failedAttempts,
    "",
    `## Instructions`,
    `1. **Analyze Context**: Read ${input.planPath} to align with the global architecture and ${input.tasksPath} for dependency context.`,
    `2. **Scope Enforcement**: Implement ONLY the task described in <current_task>. Do not refactor unrelated code.`,
    `3. **Implementation Standards**:`,
    `   - Write strict, typed code (TypeScript preferences).`,
    `   - Ensure code compiles and lints correctly.`,
    `   - Handle edge cases and errors gracefully.`,
    `   - NO placeholders (e.g., "TODO", "implementation goes here"). Write full, working code.`,
    `4. **Validation**: Run necessary tests or validation scripts before submitting.`,
    "",
    `## Output Format`,
    `Provide your response with a summary of changes, the file content, and a verification that you met the requirements.`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export const softwareDeveloper: AgentDefinition = {
  id: "software-developer",
  name: "Software Developer",
  capabilities: ["read", "write", "execute", "commit"],
  defaultSandbox: "workspace-write",
  buildPrompt,
};
