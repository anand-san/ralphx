import { join } from "node:path";
import type { RunState } from "./types";

export function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export interface StepArtifactPaths {
  logPath: string;
  messagePath: string;
  commitMessagePath: string;
}

export function buildStepArtifacts(params: {
  state: RunState;
  phaseId: string;
  taskId: string;
  attempt: number;
  stepSequence: number;
  agent: string;
}): StepArtifactPaths {
  const safePhase = sanitizeForFilename(params.phaseId);
  const safeTask = sanitizeForFilename(params.taskId);
  const safeAgent = sanitizeForFilename(params.agent);
  const safeStep = params.stepSequence.toString().padStart(2, "0");
  const base = `${safeTask}.attempt-${params.attempt}.step-${safeStep}.${safeAgent}`;

  return {
    logPath: join(params.state.logDir, safePhase, `${base}.log`),
    messagePath: join(params.state.messageDir, safePhase, `${base}.md`),
    commitMessagePath: join(
      params.state.messageDir,
      safePhase,
      `${base}.commit.json`,
    ),
  };
}

export function buildProgressPath(
  progressDir: string,
  taskId: string,
  agentId: string,
): string {
  return join(
    progressDir,
    `${sanitizeForFilename(taskId)}.${sanitizeForFilename(agentId)}.md`,
  );
}
