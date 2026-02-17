import type {
  AgentInput,
  FailedAttempt,
  PlanPhase,
  PlanTask,
} from "../../state/types";

export function buildContextBlock(input: AgentInput): string {
  const notes =
    input.task.notes.length > 0 ? input.task.notes.join(" | ") : "None";

  return [
    `<context>`,
    `  <phase_info>`,
    `    <id>${input.phase.id}</id>`,
    `    <name>${input.phase.name}</name>`,
    `    <goal>${input.phase.goal}</goal>`,
    `  </phase_info>`,
    `  <current_task>`,
    `    <id>${input.task.id}</id>`,
    `    <title>${input.task.title}</title>`,
    `    <description>${input.task.description}</description>`,
    `    <notes>${notes}</notes>`,
    `    <attempt_count>${input.attempt}/${input.maxAttempts}</attempt_count>`,
    `  </current_task>`,
    `  <files>`,
    `    <plan_path>${input.planPath}</plan_path>`,
    `    <tasks_path>${input.tasksPath}</tasks_path>`,
    `  </files>`,
    `</context>`,
  ].join("\n");
}

export function buildPeerProgressBlock(
  peerProgress: Map<string, string>,
): string {
  if (peerProgress.size === 0) return "";
  const entries: string[] = [];
  for (const [key, value] of peerProgress) {
    entries.push(`  <progress agent="${key}">\n${value}\n  </progress>`);
  }
  return [`<peer_progress>`, ...entries, `</peer_progress>`].join("\n");
}

export function buildPreviousOutputsBlock(input: AgentInput): string {
  if (input.previousOutputs.length === 0) return "";
  const entries = input.previousOutputs.map(
    (o) =>
      `  <output agent="${o.agentId}" exitCode="${o.exitCode}" duration="${o.durationMs}ms">\n${truncateText(o.raw, 4000)}\n  </output>`,
  );
  return [`<previous_outputs>`, ...entries, `</previous_outputs>`].join("\n");
}

export function buildFailedAttemptsBlock(
  failedAttempts: FailedAttempt[],
): string {
  if (failedAttempts.length === 0) return "";
  const entries = failedAttempts.map((fa) =>
    [
      `  <failed_attempt agent="${fa.agentId}" cycle="${fa.cycle}">`,
      `    <diff>${truncateText(fa.diff, 3000)}</diff>`,
      `    <qa_notes>${fa.qaNotes.join(" | ")}</qa_notes>`,
      `  </failed_attempt>`,
    ].join("\n"),
  );
  return [
    `<previous_failed_attempts>`,
    `  CRITICAL: You MUST NOT repeat any of these previous diffs.`,
    `  Review each failed attempt and produce a meaningfully different approach.`,
    ...entries,
    `</previous_failed_attempts>`,
  ].join("\n");
}

export function truncateText(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars)}\n\n[truncated]`;
}
