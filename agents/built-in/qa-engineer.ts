import type { AgentDefinition } from "../base-agent";
import type { AgentInput } from "../../state/types";
import {
  buildContextBlock,
  buildPeerProgressBlock,
} from "../prompts/context-builder";

const MAX_QA_CYCLES = 5;

function buildPrompt(input: AgentInput): string {
  const previousNotes = input.previousOutputs
    .filter(
      (o) =>
        o.parsed &&
        typeof o.parsed === "object" &&
        "notes" in (o.parsed as object)
    )
    .flatMap((o) => {
      const p = o.parsed as { notes?: unknown };
      return Array.isArray(p.notes) ? (p.notes as string[]) : [];
    });

  const notesBlock =
    previousNotes.length > 0
      ? previousNotes.map((note) => `- ${note}`).join("\n")
      : "- (No previous notes)";

  const peerProgress = buildPeerProgressBlock(input.peerProgress);

  const isFinalCycle = input.attempt >= MAX_QA_CYCLES;
  const cycleWarning = isFinalCycle
    ? `\n  <warning>FINAL CYCLE. You must be decisive. Return DONE if the implementation is acceptable, or clearly document the specific blockers that prevent approval.</warning>`
    : "";

  return [
    `You are a strict QA engineer. Your job is to validate the implementation of the task below. You are the gatekeeper for production quality.`,
    "",
    buildContextBlock(input),
    "",
    peerProgress,
    "",
    `<verifier_context>`,
    `  <cycle>${input.attempt} of ${MAX_QA_CYCLES}</cycle>${cycleWarning}`,
    `  <previous_notes>`,
    notesBlock,
    `  </previous_notes>`,
    `</verifier_context>`,
    "",
    `## Evaluation Criteria`,
    `Analyze the implementation against these strict pillars:`,
    `1. **Correctness**: Does it satisfy the specific <description> and <goal>? Are requirements fully met?`,
    `2. **Safety**: Are there potential runtime errors, unhandled exceptions, type errors, or memory leaks?`,
    `3. **Style**: Is the code clean, modular, and following the project's existing patterns?`,
    `4. **Tests**: Are there tests covering the new functionality? Do existing tests still pass?`,
    "",
    `## Output Rules`,
    `You MUST output purely valid JSON. No markdown formatting (no \`\`\`json wrapping).`,
    `Schema:`,
    `{`,
    `  "status": "DONE" | "REFACTOR" | "ISSUES",`,
    `  "notes": ["Specific, actionable item 1", "Specific item 2"]`,
    `}`,
    "",
    `## Decision Logic`,
    `- **DONE**: Code is correct, tests pass, and quality is production-ready. Minor style preferences are NOT a reason to block.`,
    `- **REFACTOR**: Logic is correct and requirements are met, but code structure, naming, or style needs improvement. Notes must describe exactly what to change.`,
    `- **ISSUES**: There are bugs, type errors, missing requirements, or the implementation doesn't work. Notes must describe the specific defect and how to reproduce it.`,
    "",
    `Notes must be specific and actionable. Bad: "code is messy". Good: "function processUser() in src/user.ts mixes validation and persistence — extract validation to a separate function."`,
    `"IMPORTANT: Do not overdo it, If something works then it works. Always finding an issue in implemetation could lead to infinite loops in the implementation and waste previous time. Just focus on what is important"`,
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
    let jsonStr = trimmed;
    if (trimmed.startsWith("```")) {
      const lines = trimmed.split("\n");
      if (lines.length >= 3) {
        jsonStr = lines.slice(1, -1).join("\n").trim();
      }
    }
    const parsed = JSON.parse(jsonStr) as { status: string; notes: unknown };
    if (!parsed.status || !Array.isArray(parsed.notes)) {
      throw new Error(
        `Invalid QA output: expected {status, notes[]} but got: ${jsonStr.slice(0, 200)}`
      );
    }
    return parsed as { status: string; notes: string[] };
  },
};
