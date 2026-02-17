import type { AgentDefinition } from "../base-agent";
import type { AgentInput } from "../../state/types";
import {
  buildContextBlock,
  buildPeerProgressBlock,
} from "../prompts/context-builder";

function buildPrompt(input: AgentInput): string {
  const peerProgress = buildPeerProgressBlock(input.peerProgress);

  return [
    `You are a code reviewer. Perform a quick review of the implementation for the task below.`,
    "",
    buildContextBlock(input),
    "",
    peerProgress,
    "",
    `## Review Focus`,
    `1. **Correctness**: Does the code do what the task requires?`,
    `2. **Security**: Any injection, XSS, or other OWASP top 10 issues?`,
    `3. **Performance**: Any obvious N+1 queries, unnecessary re-renders, memory leaks?`,
    `4. **Best Practices**: TypeScript strictness, error handling, naming conventions.`,
    "",
    `## Output Format`,
    `Provide a brief review with:`,
    `- Overall assessment (approve/request-changes)`,
    `- List of specific issues (if any)`,
    `- Suggestions for improvement (if any)`,
  ].join("\n");
}

export const codeReviewer: AgentDefinition = {
  id: "code-reviewer",
  name: "Code Reviewer",
  capabilities: ["read"],
  defaultSandbox: "read-only",
  buildPrompt,
};
