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
      : "- (No defects listed)";

  const agentContextBlock = input.agentContext
    ? [`## Orchestrator Instructions`, input.agentContext, ""].join("\n")
    : "";

  return [
    `You are a bug fixer. Your goal is to fix the specific defects identified by the QA team.`,
    "",
    agentContextBlock,
    buildContextBlock(input),
    "",
    peerProgress,
    failedAttempts,
    "",
    `<defects_log>`,
    `  The QA team found the following issues that MUST be fixed:`,
    notesBlock,
    `</defects_log>`,
    "",
    `## Instructions`,
    `- Fix each specific issue listed in the <defects_log>. Address every item.`,
    `- Focus purely on correctness and functionality — do not refactor for style.`,
    `- Double-check edge cases that might have caused these bugs.`,
    `- Ensure your fix does not introduce regressions (breaking existing features).`,
    `- Add or update tests to cover the bug scenario. The test should fail without your fix and pass with it.`,
    `- Verify all tests pass after your changes.`,
    "",
    `End your response with a <summary> section of no more than 5000 characters that captures your key findings, decisions, and changes made.`,
  ].join("\n");
}

export const bugFixer: AgentDefinition = {
  id: "bug-fixer",
  name: "Bug Fixer",
  capabilities: ["read", "write", "execute"],
  defaultSandbox: "workspace-write",
  buildPrompt,
};
