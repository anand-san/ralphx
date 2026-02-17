import type { AgentDefinition } from "../base-agent";
import type { AgentInput } from "../../state/types";

function buildPrompt(_input: AgentInput): string {
  return `You are a build-system analyst. Your job is to examine this repository and determine what quality-gate commands are available.

## Instructions

1. Look at the project root for build configuration files:
   - package.json (Node.js / JavaScript / TypeScript)
   - Makefile / Justfile
   - Cargo.toml (Rust)
   - pyproject.toml / setup.cfg / tox.ini (Python)
   - go.mod (Go)
   - build.gradle / build.gradle.kts (JVM)
   - Any other build system files

2. For each file you find, identify commands that correspond to these quality gate categories:
   - **format** — code formatting (prettier, black, rustfmt, gofmt, etc.)
   - **lint** — static analysis (eslint, flake8, clippy, golangci-lint, etc.)
   - **check-types** — type checking (tsc, mypy, pyright, etc.)
   - **test** — test suite (jest, vitest, pytest, cargo test, go test, etc.)

3. Return the exact shell commands needed to run each discovered gate.

## Output format

You MUST output ONLY a single JSON object (no markdown fences, no explanation). Use this exact schema:

{
  "steps": [
    { "name": "format", "cmd": ["npm", "run", "format"] },
    { "name": "lint", "cmd": ["npm", "run", "lint"] },
    { "name": "check-types", "cmd": ["npm", "run", "check-types"] },
    { "name": "test", "cmd": ["npm", "run", "test"] }
  ]
}

Rules:
- Only include gates that actually exist in this repo. Do not guess or hallucinate commands.
- Use the correct package manager (bun/pnpm/yarn/npm) based on the lock file present.
- The "name" field must be one of: "format", "lint", "check-types", "test".
- The "cmd" field must be an array of strings (the command and its arguments).
- Order steps as: format → lint → check-types → test (omit any that don't exist).
- If no quality gates are found at all, return: { "steps": [] }
- At most one entry per gate name.
`;
}

export interface DiscoveredSteps {
  steps: Array<{ name: string; cmd: string[] }>;
}

function parseOutput(raw: string): DiscoveredSteps {
  // Try to extract JSON from the response (agent may include prose around it)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { steps: [] };

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.steps)) return { steps: [] };

    const validNames = new Set(["format", "lint", "check-types", "test"]);
    const seen = new Set<string>();
    const steps: DiscoveredSteps["steps"] = [];

    for (const step of parsed.steps) {
      if (
        typeof step.name === "string" &&
        validNames.has(step.name) &&
        !seen.has(step.name) &&
        Array.isArray(step.cmd) &&
        step.cmd.length > 0 &&
        step.cmd.every((c: unknown) => typeof c === "string")
      ) {
        seen.add(step.name);
        steps.push({ name: step.name, cmd: step.cmd });
      }
    }

    return { steps };
  } catch {
    return { steps: [] };
  }
}

export const qualityGateDiscoverer: AgentDefinition = {
  id: "quality-gate-discoverer",
  name: "Quality Gate Discoverer",
  capabilities: ["read"],
  defaultSandbox: "read-only",
  buildPrompt,
  parseOutput,
};
