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
        `  CRITICAL: The previous implementation attempt failed.`,
        `  Failure details:`,
        `  ${input.failureContext}`,
        ``,
        `  You MUST address these failures directly. Do NOT repeat the same mistakes.`,
        `  Analyze what went wrong and take a different approach.`,
        `</previous_failure_analysis>`,
      ].join("\n")
    : "";

  const peerProgress = buildPeerProgressBlock(input.peerProgress);
  const previousOutputs = buildPreviousOutputsBlock(input);
  const failedAttempts = buildFailedAttemptsBlock(input.previousFailedAttempts);

  const agentContextBlock = input.agentContext
    ? [`## Orchestrator Instructions`, input.agentContext, ""].join("\n")
    : "";

  return [
    `You are a senior software developer. Your goal is to implement the task defined in the context below.`,
    "",
    agentContextBlock,
    retryContext,
    "",
    buildContextBlock(input),
    "",
    peerProgress,
    previousOutputs,
    failedAttempts,
    "",
    `## Instructions`,
    `1. **Analyze Context**: Read the plan at ${input.planPath} to understand the project architecture. Read ${input.tasksPath} for task dependencies and what other tasks expect.`,
    `2. **Scope Enforcement**: Implement ONLY the task described in <current_task>. Do not refactor unrelated code or make changes outside the task scope.`,
    `3. **Implementation Standards**:`,
    `   - Write strict TypeScript: no \`any\` types, explicit return types on exported functions.`,
    `   - Handle edge cases and errors gracefully.`,
    `   - Follow existing patterns and conventions in the codebase.`,
    `   - NO placeholders (e.g., "TODO", "implementation goes here"). Write full, working code.`,
    `4. **Testing**: Write tests (only necessary ones) for new functionality. Follow existing test patterns in the project (check __tests__ directories for conventions).`,
    `5. **Validation**: After implementing, verify:`,
    `   - Code compiles without type errors.`,
    `   - Linting passes.`,
    `   - All tests pass (both new and existing).`,
    "",
    `## Output`,
    `Provide a summary of what you changed, which files were modified, and confirm you verified the requirements.`,
    `End your response with a <summary> section of no more than 5000 characters that captures your key findings, decisions, and changes made.`,
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
