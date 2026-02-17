import type { AgentDefinition } from "../base-agent";
import type { AgentInput } from "../../state/types";
import {
  buildContextBlock,
  buildPeerProgressBlock,
} from "../prompts/context-builder";

function buildPrompt(input: AgentInput): string {
  const peerProgress = buildPeerProgressBlock(input.peerProgress);

  return [
    `Your goal is to update documentation to reflect the changes made for the task below.`,
    "",
    buildContextBlock(input),
    "",
    peerProgress,
    "",
    `## Instructions`,
    `1. Review what was implemented for this task.`,
    `2. Update any relevant documentation files (README, inline docs, API docs).`,
    `3. Do NOT create new documentation files unless absolutely necessary.`,
    `4. Keep documentation concise and accurate.`,
    `5. Only update docs that are directly affected by the changes.`,
    "",
    `End your response with a <summary> section of no more than 5000 characters that captures your key findings, decisions, and changes made.`,
  ].join("\n");
}

export const docUpdater: AgentDefinition = {
  id: "doc-updater",
  name: "Doc Updater",
  capabilities: ["read", "write"],
  defaultSandbox: "workspace-write",
  buildPrompt,
};
