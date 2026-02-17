import type { AgentDefinition } from "../base-agent";
import type { AgentInput } from "../../state/types";
import { buildCommitMessagePrompt } from "../prompts/templates";

function buildPrompt(input: AgentInput): string {
  // The commit generator receives diff info via peerProgress
  const diffStat = input.peerProgress.get("diffStat") ?? "(empty)";
  const diffPatch = input.peerProgress.get("diffPatch") ?? "(empty)";
  const changedFiles =
    input.peerProgress.get("changedFiles")?.split("\n") ?? [];

  return buildCommitMessagePrompt({
    task: { title: input.task.title },
    changedFiles,
    diffStat,
    diffPatch,
  });
}

export const commitGenerator: AgentDefinition = {
  id: "commit-generator",
  name: "Commit Generator",
  capabilities: ["read"],
  defaultSandbox: "read-only",
  buildPrompt,
};
