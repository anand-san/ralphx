import type { AgentInput, PlanTask } from "../../state/types";
import {
  buildContextBlock,
  buildFailedAttemptsBlock,
  buildPeerProgressBlock,
  buildPreviousOutputsBlock,
  truncateText,
} from "./context-builder";

// ── Commit message prompt ──

export function buildCommitMessagePrompt(params: {
  task: { title: string };
  changedFiles: string[];
  diffStat: string;
  diffPatch: string;
}): string {
  const files =
    params.changedFiles.length > 0
      ? params.changedFiles.map((file) => `- ${file}`).join("\n")
      : "- (none)";
  const diffStat =
    params.diffStat.trim().length > 0 ? params.diffStat : "(empty)";
  const diffPatch =
    params.diffPatch.trim().length > 0 ? params.diffPatch : "(empty)";

  return [
    "Generate a conventional commit message as strict JSON.",
    "Output JSON only. No markdown, no explanation.",
    "",
    "Required JSON shape:",
    '{"subject":"type(scope): summary","body":"optional body"}',
    "",
    "Rules:",
    "- subject must follow Conventional Commits format",
    "- subject must not include task IDs, phase IDs, or the word ralph/ralphx",
    "- body should concisely describe what changed and why",
    "- body can be empty string when unnecessary",
    "",
    `Task title: ${params.task.title}`,
    "",
    "Changed files:",
    files,
    "",
    "Diff stat:",
    diffStat,
    "",
    "Patch excerpt:",
    diffPatch,
  ].join("\n");
}

// ── JSON extraction helpers ──

export function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    const lines = trimmed.split("\n");
    if (lines.length >= 3) {
      return lines.slice(1, -1).join("\n").trim();
    }
  }
  return trimmed;
}

// ── Conventional commit parser ──

const conventionalSubjectPattern =
  /^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)\([a-z0-9._-]+\)!?: .+/i;

export function parseConventionalCommit(raw: string): {
  subject: string;
  body: string;
} {
  const candidate = extractJsonPayload(raw);
  const parsed = JSON.parse(candidate) as {
    subject?: unknown;
    body?: unknown;
  };
  const subject =
    typeof parsed.subject === "string" ? parsed.subject.trim() : "";
  const body = typeof parsed.body === "string" ? parsed.body.trim() : "";

  if (!conventionalSubjectPattern.test(subject)) {
    throw new Error(`Invalid conventional commit subject: ${subject}`);
  }
  if (
    /task-\d+/i.test(subject) ||
    /phase-\d+/i.test(subject) ||
    /ralph/i.test(subject)
  ) {
    throw new Error(`Commit subject contains forbidden token: ${subject}`);
  }

  return { subject, body };
}

// ── Verifier decision parser ──

export function parseVerifierDecision(raw: string): {
  status: "DONE" | "REFACTOR" | "ISSUES";
  notes: string[];
} {
  const candidate = extractJsonPayload(raw);
  const parsed = JSON.parse(candidate) as {
    status?: unknown;
    notes?: unknown;
  };

  const rawStatus =
    typeof parsed.status === "string" ? parsed.status.trim().toUpperCase() : "";

  if (
    rawStatus !== "DONE" &&
    rawStatus !== "REFACTOR" &&
    rawStatus !== "ISSUES"
  ) {
    throw new Error(`Invalid verifier status: ${rawStatus}`);
  }

  let notes: string[] = [];
  if (Array.isArray(parsed.notes)) {
    notes = parsed.notes
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  } else if (
    typeof parsed.notes === "string" &&
    parsed.notes.trim().length > 0
  ) {
    notes = [parsed.notes.trim()];
  }

  if (
    (rawStatus === "REFACTOR" || rawStatus === "ISSUES") &&
    notes.length === 0
  ) {
    throw new Error(`Verifier ${rawStatus} requires notes.`);
  }

  return { status: rawStatus, notes };
}
