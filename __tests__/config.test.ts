import { describe, expect, it } from "bun:test";
import { tasksDocumentSchema, teamConfigSchema } from "../config/schema";
import { DEFAULT_TEAM } from "../config/defaults";

describe("tasksDocumentSchema", () => {
  it("validates a correct document", () => {
    const doc = {
      idea: "Test",
      generatedAt: "2026-01-01T00:00:00Z",
      repo: "test-repo",
      phases: [
        {
          id: "phase-1",
          name: "Phase 1",
          goal: "Ship",
          exitCriteria: ["Done"],
          tasks: [
            {
              id: "task-001",
              status: "todo",
              title: "Task 1",
              description: "Do it",
              notes: [],
            },
          ],
        },
      ],
    };

    const result = tasksDocumentSchema.parse(doc);
    expect(result.idea).toBe("Test");
    expect(result.phases).toHaveLength(1);
  });

  it("rejects empty phases", () => {
    expect(() =>
      tasksDocumentSchema.parse({
        idea: "Test",
        generatedAt: "2026",
        repo: "r",
        phases: [],
      }),
    ).toThrow();
  });

  it("rejects invalid task status", () => {
    expect(() =>
      tasksDocumentSchema.parse({
        idea: "Test",
        generatedAt: "2026",
        repo: "r",
        phases: [
          {
            id: "p",
            name: "P",
            goal: "G",
            exitCriteria: [],
            tasks: [
              {
                id: "t",
                status: "invalid",
                title: "T",
                description: "D",
                notes: [],
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});

describe("teamConfigSchema", () => {
  it("validates the default team", () => {
    const result = teamConfigSchema.parse(DEFAULT_TEAM);
    expect(result.name).toBe("default-engineering-team");
    expect(result.roles).toHaveLength(5);
  });

  it("validates a custom team", () => {
    const custom = {
      name: "my-team",
      defaultRuntime: "codex",
      roles: [
        {
          id: "dev",
          name: "Dev",
          sandbox: "workspace-write",
          permissions: { canWrite: true, canExecute: true, canCommit: false },
        },
      ],
    };
    const result = teamConfigSchema.parse(custom);
    expect(result.name).toBe("my-team");
    expect(result.defaultRuntime).toBe("codex");
  });
});
