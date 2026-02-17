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
      : "- (No defects listed)";

  return [
    `Your goal is to fix defects identified by the QA team.`,
    "",
    buildContextBlock(input),
    "",
    peerProgress,
    failedAttempts,
    "",
    `<defects_log>`,
    `  The QA Team found the following critical issues:`,
    notesBlock,
    `</defects_log>`,
    "",
    `## Instructions`,
    `- Fix the specific issues listed in the <defects_log>.`,
    `- Do not "refactor" for style; focus purely on correctness and functionality.`,
    `- Double-check edge cases that might have caused these bugs.`,
    `- Ensure your fix does not introduce regressions (breaking existing features).`,
  ].join("\n");
}

export const bugFixer: AgentDefinition = {
  id: "bug-fixer",
  name: "Bug Fixer",
  capabilities: ["read", "write", "execute"],
  defaultSandbox: "workspace-write",
  buildPrompt,
};
