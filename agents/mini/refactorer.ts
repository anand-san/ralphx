import type { AgentDefinition } from "../base-agent";
import type { AgentInput } from "../../state/types";
import {
  buildContextBlock,
  buildFailedAttemptsBlock,
  buildPeerProgressBlock,
} from "../prompts/context-builder";

function buildPrompt(input: AgentInput): string {
  const peerProgress = buildPeerProgressBlock(input.peerProgress);
  const failedAttempts = buildFailedAttemptsBlock(input.previousFailedAttempts);

  const notes = input.previousOutputs
    .filter((o) => o.parsed && typeof o.parsed === "object")
    .flatMap((o) => {
      const p = o.parsed as { notes?: string[] };
      return p.notes ?? [];
    });

  const notesBlock =
    notes.length > 0
      ? notes.map((note) => `- ${note}`).join("\n")
      : "- (No refactor instructions)";

  return [
    `Your goal is to improve code structure and quality WITHOUT changing functional behavior.`,
    "",
    buildContextBlock(input),
    "",
    peerProgress,
    failedAttempts,
    "",
    `<refactor_instructions>`,
    `  The team has verified existing implementation and has requested changes. Focus ONLY on these items:`,
    notesBlock,
    `</refactor_instructions>`,
    "",
    `## Constraints`,
    `- Strictly follow the verifier's notes.`,
    `- Do NOT alter the business logic or external behavior of the code.`,
    `- Maintain all existing types and interfaces unless explicitly asked to change them.`,
    `- Ensure the code remains compilable after refactoring.`,
  ].join("\n");
}

export const refactorer: AgentDefinition = {
  id: "refactorer",
  name: "Refactorer",
  capabilities: ["read", "write", "execute"],
  defaultSandbox: "workspace-write",
  buildPrompt,
};
