import type {
  AgentInput,
  FailedAttempt,
  PlanPhase,
  PlanTask,
} from "../../state/types";

export function buildContextBlock(input: AgentInput): string {
  const notes =
    input.task.notes.length > 0
      ? input.task.notes.map((n, i) => `    ${i + 1}. ${n}`).join("\n")
      : "    None";

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
    `    <notes>`,
    notes,
    `    </notes>`,
    `    <attempt>${input.attempt}/${input.maxAttempts}</attempt>`,
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
  const entries = input.previousOutputs.map((o) => {
    const truncated = o.raw.length > 4000;
    const content = truncated
      ? `${o.raw.slice(0, 4000)}\n\n[... ${o.raw.length - 4000} characters truncated ...]`
      : o.raw;
    return `  <output agent="${o.agentId}" exitCode="${o.exitCode}" duration="${o.durationMs}ms">\n${content}\n  </output>`;
  });
  return [`<previous_outputs>`, ...entries, `</previous_outputs>`].join("\n");
}

export function buildFailedAttemptsBlock(
  failedAttempts: FailedAttempt[],
): string {
  if (failedAttempts.length === 0) return "";
  const entries = failedAttempts.map((fa) => {
    const truncated = fa.diff.length > 3000;
    const diffContent = truncated
      ? `${fa.diff.slice(0, 3000)}\n\n[... ${fa.diff.length - 3000} characters truncated ...]`
      : fa.diff;
    return [
      `  <failed_attempt agent="${fa.agentId}" cycle="${fa.cycle}">`,
      `    <diff>${diffContent}</diff>`,
      `    <qa_notes>`,
      fa.qaNotes.map((n) => `      - ${n}`).join("\n"),
      `    </qa_notes>`,
      `  </failed_attempt>`,
    ].join("\n");
  });
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
  return `${input.slice(0, maxChars)}\n\n[... ${input.length - maxChars} characters truncated ...]`;
}
