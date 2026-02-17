import { describe, expect, it, beforeEach } from "bun:test";
import {
  registerAgent,
  getAgent,
  listAgents,
  hasAgent,
  clearRegistry,
} from "../agents/registry";
import { registerDefaultAgents } from "../agents/register-defaults";
import type { AgentDefinition } from "../agents/base-agent";
import type { AgentInput } from "../state/types";

beforeEach(() => {
  clearRegistry();
});

describe("agent registry", () => {
  it("registers and retrieves an agent", () => {
    const agent: AgentDefinition = {
      id: "test-agent",
      name: "Test Agent",
      capabilities: ["read"],
      defaultSandbox: "read-only",
      buildPrompt: () => "test prompt",
    };
    registerAgent(agent);
    expect(getAgent("test-agent").name).toBe("Test Agent");
  });

  it("throws on duplicate registration", () => {
    const agent: AgentDefinition = {
      id: "test-agent",
      name: "Test Agent",
      capabilities: ["read"],
      defaultSandbox: "read-only",
      buildPrompt: () => "test",
    };
    registerAgent(agent);
    expect(() => registerAgent(agent)).toThrow("already registered");
  });

  it("throws on unknown agent", () => {
    expect(() => getAgent("nonexistent")).toThrow("not found");
  });

  it("hasAgent returns true/false", () => {
    expect(hasAgent("test")).toBe(false);
    registerAgent({
      id: "test",
      name: "Test",
      capabilities: [],
      defaultSandbox: "read-only",
      buildPrompt: () => "",
    });
    expect(hasAgent("test")).toBe(true);
  });
});

describe("registerDefaultAgents", () => {
  it("registers all built-in and mini agents", () => {
    registerDefaultAgents();
    const agents = listAgents();
    const ids = agents.map((a) => a.id);

    expect(ids).toContain("software-developer");
    expect(ids).toContain("qa-engineer");
    expect(ids).toContain("engineering-manager");
    expect(ids).toContain("product-manager");
    expect(ids).toContain("product-designer");
    expect(ids).toContain("orchestrator-planner");
    expect(ids).toContain("commit-generator");
    expect(ids).toContain("code-reviewer");
    expect(ids).toContain("refactorer");
    expect(ids).toContain("bug-fixer");
    expect(ids).toContain("doc-updater");
    expect(agents.length).toBe(11);
  });

  it("is idempotent", () => {
    registerDefaultAgents();
    registerDefaultAgents(); // Should not throw
    expect(listAgents().length).toBe(11);
  });
});

describe("agent prompt building", () => {
  it("software-developer builds a prompt with context block", () => {
    registerDefaultAgents();
    const agent = getAgent("software-developer");
    const input: AgentInput = {
      task: {
        id: "task-001",
        status: "todo",
        title: "Implement feature",
        description: "Do the thing",
        notes: ["note1"],
      },
      phase: {
        id: "phase-1",
        name: "Phase 1",
        goal: "Ship",
        exitCriteria: ["Done"],
        tasks: [],
      },
      planPath: "/tmp/PLAN.md",
      tasksPath: "/tmp/tasks.json",
      previousOutputs: [],
      peerProgress: new Map(),
      previousFailedAttempts: [],
      attempt: 1,
      maxAttempts: 3,
    };

    const prompt = agent.buildPrompt(input);
    expect(prompt).toContain("task-001");
    expect(prompt).toContain("Implement feature");
    expect(prompt).toContain("Phase 1");
    expect(prompt).toContain("1/3"); // attempt count
  });

  it("qa-engineer builds a prompt with verifier context", () => {
    registerDefaultAgents();
    const agent = getAgent("qa-engineer");
    const input: AgentInput = {
      task: {
        id: "task-001",
        status: "todo",
        title: "Verify feature",
        description: "Check it",
        notes: [],
      },
      phase: {
        id: "phase-1",
        name: "Phase 1",
        goal: "Ship",
        exitCriteria: [],
        tasks: [],
      },
      planPath: "/tmp/PLAN.md",
      tasksPath: "/tmp/tasks.json",
      previousOutputs: [],
      peerProgress: new Map(),
      previousFailedAttempts: [],
      attempt: 2,
      maxAttempts: 5,
    };

    const prompt = agent.buildPrompt(input);
    expect(prompt).toContain("gatekeeper");
    expect(prompt).toContain("DONE");
    expect(prompt).toContain("REFACTOR");
    expect(prompt).toContain("ISSUES");
  });
});
