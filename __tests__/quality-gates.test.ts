import { describe, expect, it, mock } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { qualityGateDiscoverer } from "../agents/mini/quality-gate-discoverer";
import type { DiscoveredSteps } from "../agents/mini/quality-gate-discoverer";
import { runQualityGates } from "../runtime/quality-gates";

// ── parseOutput ──

describe("qualityGateDiscoverer.parseOutput", () => {
  const parse = qualityGateDiscoverer.parseOutput! as (
    raw: string,
  ) => DiscoveredSteps;

  it("parses valid JSON with all 4 gates", () => {
    const raw = JSON.stringify({
      steps: [
        { name: "format", cmd: ["bun", "run", "format"] },
        { name: "lint", cmd: ["bun", "run", "lint"] },
        { name: "check-types", cmd: ["bun", "run", "check-types"] },
        { name: "test", cmd: ["bun", "run", "test"] },
      ],
    });
    const result = parse(raw);
    expect(result.steps).toHaveLength(4);
    expect(result.steps.map((s) => s.name)).toEqual([
      "format",
      "lint",
      "check-types",
      "test",
    ]);
  });

  it("parses partial gates", () => {
    const raw = JSON.stringify({
      steps: [{ name: "test", cmd: ["pytest"] }],
    });
    const result = parse(raw);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].name).toBe("test");
    expect(result.steps[0].cmd).toEqual(["pytest"]);
  });

  it("returns empty steps for empty array", () => {
    const raw = JSON.stringify({ steps: [] });
    const result = parse(raw);
    expect(result.steps).toEqual([]);
  });

  it("extracts JSON from surrounding prose", () => {
    const raw = `Here is the analysis:
{
  "steps": [
    { "name": "lint", "cmd": ["npm", "run", "lint"] }
  ]
}
That's all I found.`;
    const result = parse(raw);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].name).toBe("lint");
  });

  it("deduplicates by gate name", () => {
    const raw = JSON.stringify({
      steps: [
        { name: "test", cmd: ["bun", "run", "test"] },
        { name: "test", cmd: ["bun", "run", "test:unit"] },
      ],
    });
    const result = parse(raw);
    expect(result.steps).toHaveLength(1);
  });

  it("filters out invalid gate names", () => {
    const raw = JSON.stringify({
      steps: [
        { name: "build", cmd: ["npm", "run", "build"] },
        { name: "lint", cmd: ["npm", "run", "lint"] },
      ],
    });
    const result = parse(raw);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].name).toBe("lint");
  });

  it("filters out steps with invalid cmd", () => {
    const raw = JSON.stringify({
      steps: [
        { name: "lint", cmd: "eslint" },
        { name: "test", cmd: ["jest"] },
      ],
    });
    const result = parse(raw);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].name).toBe("test");
  });

  it("returns empty on invalid JSON", () => {
    const result = parse("not json at all");
    expect(result.steps).toEqual([]);
  });

  it("returns empty when steps is not an array", () => {
    const raw = JSON.stringify({ steps: "not an array" });
    const result = parse(raw);
    expect(result.steps).toEqual([]);
  });

  it("returns empty on completely empty output", () => {
    const result = parse("");
    expect(result.steps).toEqual([]);
  });
});

// ── runQualityGates ──

describe("runQualityGates", () => {
  it("returns passed: true when no steps provided", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "qg-test-"));
    await mkdir(join(tempDir, "logs"), { recursive: true });
    const logPath = join(tempDir, "logs", "qg.log");

    try {
      const result = await runQualityGates({
        rootDir: tempDir,
        logPath,
        streamOutput: false,
      });

      expect(result.passed).toBe(true);
      expect(result.details).toBe("all checks passed");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns passed: true when steps is empty array", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "qg-test-"));
    await mkdir(join(tempDir, "logs"), { recursive: true });
    const logPath = join(tempDir, "logs", "qg.log");

    try {
      const result = await runQualityGates({
        rootDir: tempDir,
        logPath,
        streamOutput: false,
        steps: [],
      });

      expect(result.passed).toBe(true);
      expect(result.details).toBe("all checks passed");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

// ── buildPrompt ──

describe("qualityGateDiscoverer.buildPrompt", () => {
  it("returns a prompt string", () => {
    const dummyInput = {
      task: {
        id: "_discovery",
        status: "todo" as const,
        title: "QG Discovery",
        description: "",
        notes: [],
      },
      phase: {
        id: "_discovery",
        name: "Setup",
        goal: "",
        exitCriteria: [],
        tasks: [],
      },
      planPath: "",
      tasksPath: "",
      previousOutputs: [],
      peerProgress: new Map<string, string>(),
      previousFailedAttempts: [],
      attempt: 1,
      maxAttempts: 1,
    };

    const prompt = qualityGateDiscoverer.buildPrompt(dummyInput);
    expect(typeof prompt).toBe("string");
    expect(prompt).toContain("quality gate");
    expect(prompt).toContain("format");
    expect(prompt).toContain("lint");
    expect(prompt).toContain("test");
  });
});
