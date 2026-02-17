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
    .filter(
      (o) =>
        o.parsed &&
        typeof o.parsed === "object" &&
        "notes" in (o.parsed as object),
    )
    .flatMap((o) => {
      const p = o.parsed as { notes?: unknown };
      return Array.isArray(p.notes) ? (p.notes as string[]) : [];
    });

  const notesBlock =
    notes.length > 0
      ? notes.map((note) => `- ${note}`).join("\n")
      : "- (No refactor instructions)";

  return [
    `You are a code refactorer. Your goal is to improve code structure and quality WITHOUT changing functional behavior.`,
    "",
    buildContextBlock(input),
    "",
    peerProgress,
    failedAttempts,
    "",
    `<refactor_instructions>`,
    `  The QA team has reviewed the implementation and requested these specific changes:`,
    notesBlock,
    `</refactor_instructions>`,
    "",
    `## Constraints`,
    `- Strictly follow the QA notes above. Address each item.`,
    `- Do NOT alter the business logic (core functionality, calculations, data transformations) or external behavior.`,
    `- Maintain all existing types and interfaces unless explicitly asked to change them.`,
    `- After refactoring, verify that existing tests still pass. Do not break working functionality.`,
    `- Keep changes minimal and focused on the requested improvements.`,
  ].join("\n");
}

export const refactorer: AgentDefinition = {
  id: "refactorer",
  name: "Refactorer",
  capabilities: ["read", "write", "execute"],
  defaultSandbox: "workspace-write",
  buildPrompt,
};
