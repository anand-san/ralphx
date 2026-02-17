import type { AgentDefinition } from "../base-agent";
import type { AgentInput } from "../../state/types";
import {
  buildContextBlock,
  buildPeerProgressBlock,
} from "../prompts/context-builder";

const MAX_QA_CYCLES = 5;

function buildPrompt(input: AgentInput): string {
  const previousNotes = input.previousOutputs
    .filter((o) => o.parsed && typeof o.parsed === "object")
    .flatMap((o) => {
      const p = o.parsed as { notes?: string[] };
      return p.notes ?? [];
    });

  const notesBlock =
    previousNotes.length > 0
      ? previousNotes.map((note) => `- ${note}`).join("\n")
      : "- (No previous notes)";

  const peerProgress = buildPeerProgressBlock(input.peerProgress);

  return [
    `Your job is to strictly validate the implementation of the task below. You are the gatekeeper for production.`,
    "",
    buildContextBlock(input),
    "",
    peerProgress,
    "",
    `<verifier_context>`,
    `  <cycle>${input.attempt} of ${MAX_QA_CYCLES}</cycle>`,
    `  <previous_notes>`,
    notesBlock,
    `  </previous_notes>`,
    `</verifier_context>`,
    "",
    `## Evaluation Criteria`,
    `Analyze the implementation against these strict pillars:`,
    `1. **Correctness**: Does it satisfy the specific <description> and <goal>?`,
    `2. **Safety**: Are there potential runtime errors, type errors, or memory leaks?`,
    `3. **Style**: Is the code clean, modular, and following best practices?`,
    `4. **Scope**: Did the implementer change files they shouldn't have?`,
    "",
    `## Output Rules`,
    `You must output purely valid JSON. No markdown formatting (like \`\`\`json).`,
    `Schema:`,
    `{`,
    `  "status": "DONE" | "REFACTOR" | "ISSUES",`,
    `  "notes": ["Specific, actionable item 1", "Specific item 2"]`,
    `}`,
    "",
    `## Decision Logic`,
    `- Return **DONE** only if the code is perfect and ready for production.`,
    `- Return **REFACTOR** if logic is correct but code style, variable naming, or structure is poor.`,
    `- Return **ISSUES** if there are bugs, type errors, or the requirement is not met.`,
  ].join("\n");
}

export const qaEngineer: AgentDefinition = {
  id: "qa-engineer",
  name: "QA Engineer",
  capabilities: ["read"],
  defaultSandbox: "read-only",
  buildPrompt,
  parseOutput(raw: string): { status: string; notes: string[] } {
    const trimmed = raw.trim();
    // Try to extract JSON from potential markdown code block
    let jsonStr = trimmed;
    if (trimmed.startsWith("```")) {
      const lines = trimmed.split("\n");
      if (lines.length >= 3) {
        jsonStr = lines.slice(1, -1).join("\n").trim();
      }
    }
    return JSON.parse(jsonStr) as { status: string; notes: string[] };
  },
};
