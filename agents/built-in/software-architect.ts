import type { AgentDefinition } from "../base-agent";
import type { AgentInput } from "../../state/types";
import {
  buildContextBlock,
  buildFailedAttemptsBlock,
  buildPeerProgressBlock,
  buildPreviousOutputsBlock,
} from "../prompts/context-builder";

function buildPrompt(input: AgentInput): string {
  const retryContext = input.failureContext
    ? [
        `<previous_failure_analysis>`,
        `  CRITICAL: The previous attempt failed.`,
        `  Failure details:`,
        `  ${input.failureContext}`,
        ``,
        `  You MUST address these failures directly. Do NOT repeat the same mistakes.`,
        `  Analyze what went wrong and take a different approach.`,
        `</previous_failure_analysis>`,
      ].join("\n")
    : "";

  const peerProgress = buildPeerProgressBlock(input.peerProgress);
  const previousOutputs = buildPreviousOutputsBlock(input);
  const failedAttempts = buildFailedAttemptsBlock(input.previousFailedAttempts);

  // Determine mode from plannerContext in peerProgress
  const plannerContext = input.peerProgress.get("plannerContext") ?? "";
  const isSetupMode = plannerContext.toLowerCase().startsWith("setup");

  return [
    `You are a software architect specializing in repository infrastructure and developer tooling. Your goal is to ${isSetupMode ? "set up specific infrastructure" : "audit the repository infrastructure"} as described in the context below.`,
    "",
    retryContext,
    "",
    buildContextBlock(input),
    "",
    peerProgress,
    previousOutputs,
    failedAttempts,
    "",
    `## Mode: ${isSetupMode ? "SETUP" : "AUDIT"}`,
    "",
    ...(isSetupMode
      ? [
          `You are in SETUP mode. Fix the specific infrastructure gaps described in the planner context.`,
          "",
          `### Setup Instructions`,
          `1. **Read the planner context** for specific setup instructions.`,
          `2. **Use the project's existing package manager** (detected from lock file: package-lock.json → npm, yarn.lock → yarn, pnpm-lock.yaml → pnpm, bun.lockb/bun.lock → bun).`,
          `3. **Add .gitignore entries**: Ensure \`.ralphx\` is in .gitignore along with standard ignores (node_modules, dist, .env, coverage).`,
          `4. **Install and configure tools** as instructed (linter, formatter, test framework).`,
          `5. **Add missing npm scripts** to package.json (format, lint, check-types, test) following project conventions.`,
          `6. **Verify changes work**: Run the newly added scripts to confirm they execute without errors.`,
          `7. **Do not modify application code** — only infrastructure and config files.`,
        ]
      : [
          `You are in AUDIT mode. Scan the repository and produce a structured report on infrastructure readiness.`,
          "",
          `### Audit Checklist`,
          `Evaluate each item and report: status (present / missing / partial), file path (if present), and recommended action.`,
          "",
          `1. **.gitignore**: Does it contain \`.ralphx\`? Does it include standard entries (node_modules, dist, .env, coverage)?`,
          `2. **Project structure**: Is this a monorepo or single project? Frontend, backend, or full-stack?`,
          `3. **Linter config**: Look for eslint.config.*, .eslintrc.*, or equivalent. Check if lint script exists in package.json.`,
          `4. **Formatter config**: Look for .prettierrc*, prettier.config.*, or equivalent. Check if format script exists.`,
          `5. **Test framework**: Look for vitest/jest config, test directories, test scripts in package.json.`,
          `6. **NPM scripts**: Flag missing scripts: \`format\`, \`lint\`, \`check-types\`, \`test\`.`,
          `7. **Build/dev tooling**: Check for tsconfig.json, bundler config (vite, webpack, esbuild, etc.).`,
          `8. **Package manager**: Detect from lock file (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb/bun.lock).`,
        ]),
    "",
    `## Output`,
    ...(isSetupMode
      ? [
          `Provide a summary of what you configured, which files were created or modified, and confirm you verified the changes work.`,
        ]
      : [
          `Produce a structured report with one section per audit item. Use this format for each:`,
          "",
          `### <Item Name>`,
          `- **Status**: present | missing | partial`,
          `- **Path**: <file path or N/A>`,
          `- **Action**: <recommended action or "none needed">`,
          "",
          `End with a summary section listing the most critical gaps that should be addressed before development begins.`,
        ]),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export const softwareArchitect: AgentDefinition = {
  id: "software-architect",
  name: "Software Architect",
  capabilities: ["read", "write", "execute"],
  defaultSandbox: "workspace-write",
  buildPrompt,
};
