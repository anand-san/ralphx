import type { AgentDefinition } from "../base-agent";
import type { AgentInput } from "../../state/types";
import { buildCommitMessagePrompt } from "../prompts/templates";

function buildPrompt(input: AgentInput): string {
  const diffStat = input.peerProgress.get("diffStat");
  const diffPatch = input.peerProgress.get("diffPatch");
  const changedFilesRaw = input.peerProgress.get("changedFiles");

  if (!diffStat || !diffPatch) {
    throw new Error(
      "commit-generator requires diffStat and diffPatch in peerProgress",
    );
  }

  const changedFiles = changedFilesRaw?.split("\n").filter(Boolean) ?? [];

  return [
    buildCommitMessagePrompt({
      task: { title: input.task.title },
      changedFiles,
      diffStat,
      diffPatch,
    }),
    "",
    `End your response with a <summary> section of no more than 5000 characters that captures the commit message you generated.`,
  ].join("\n");
}

export const commitGenerator: AgentDefinition = {
  id: "commit-generator",
  name: "Commit Generator",
  capabilities: ["read"],
  defaultSandbox: "read-only",
  buildPrompt,
};
