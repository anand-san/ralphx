import { describe, expect, it, beforeEach, mock } from "bun:test";
import {
  executeOrchestrator,
  resolveAgentIds,
  runQualityGateCheck,
  commitChanges,
  detectAgentCycle,
  buildFallbackRecommendation,
  type OrchestratorDependencies,
  type OrchestratorParams,
} from "../orchestrator/orchestrator";
import type { PlannerConsultParams } from "../orchestrator/planner";
import { EventBus } from "../monitor/event-bus";
import type {
  AgentOutput,
  PlanPhase,
  PlanTask,
  PlannerRecommendation,
  RunState,
  TasksDocument,
} from "../state/types";
import { WRITE_AGENT_IDS } from "../state/types";
import type { AgentDefinition } from "../agents/base-agent";
import { registerAgent, clearRegistry, hasAgent } from "../agents/registry";
import type { RuntimeProvider } from "../runtime/provider";

// ── Test helpers ──

function makeDocument(): TasksDocument {
  return {
    idea: "Test idea",
    generatedAt: "2026-01-01T00:00:00.000Z",
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
            title: "Implement feature",
            description: "Build it",
            notes: [],
          },
        ],
      },
    ],
  };
}

function makeRunState(): RunState {
  return {
    schemaVersion: 2,
    runId: "test-run",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "running",
    branch: "test-branch",
    retryLimit: 1,
    defaultRuntime: "claude-code",
    runDir: "/tmp/test/.ralphx/test-run",
    sourcesDir: "/tmp/test/.ralphx/test-run/sources",
    decisionsDir: "/tmp/test/.ralphx/test-run/decisions",
    progressDir: "/tmp/test/.ralphx/test-run/progress",
    logDir: "/tmp/test/.ralphx/test-run/logs",
    messageDir: "/tmp/test/.ralphx/test-run/messages",
    handoffPath: "/tmp/test/.ralphx/test-run/HANDOFF.md",
    eventsPath: "/tmp/test/.ralphx/test-run/events.jsonl",
    phases: [{ id: "phase-1", name: "Phase 1", status: "pending" }],
    tasks: [
      {
        id: "task-001",
        phaseId: "phase-1",
        title: "Implement feature",
        status: "pending",
        attempts: 0,
        changedFiles: [],
        qaCycles: 0,
      },
    ],
    agents: [],
  };
}

function makeAgentOutput(
  agentId: string,
  raw: string,
  exitCode = 0,
): AgentOutput {
  return {
    agentId,
    taskId: "task-001",
    raw,
    exitCode,
    durationMs: 100,
    changedFiles: [],
  };
}

function makePlannerRecommendation(
  action: string,
  agentId?: string,
  extra: Partial<PlannerRecommendation["recommendation"]> = {},
): PlannerRecommendation {
  return {
    contextBriefing: "Test briefing",
    recommendation: {
      action,
      agentId,
      rationale: `Test rationale for ${action}`,
      ...extra,
    },
    warnings: [],
  };
}

const mockRuntime: RuntimeProvider = {
  name: "test-runtime",
  async execute() {
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      output: "mock output",
      durationMs: 100,
    };
  },
  async isAvailable() {
    return true;
  },
};

function createMockDeps(
  overrides: Partial<OrchestratorDependencies> = {},
): OrchestratorDependencies {
  return {
    saveRunState: mock(async () => {}),
    runQualityGates: mock(async () => ({
      passed: true,
      details: "all checks passed",
    })),
    listChangedFiles: mock(async () => ["src/index.ts"]),
    stageAll: mock(async () => {}),
    stagedDiffStat: mock(async () => "1 file changed"),
    stagedDiff: mock(async () => "+added line"),
    commitStaged: mock(async () => {}),
    headCommit: mock(async () => "abc123"),
    writeProgressFile: mock(async () => {}),
    appendDecision: mock(async () => {}),
    writeHandoff: mock(async () => {}),
    runAgent: mock(async (params) => {
      return makeAgentOutput(
        params.agent.id,
        JSON.stringify({ subject: "feat(test): test", body: "" }),
      );
    }),
    consultPlanner: mock(async () => ({
      recommendation: makePlannerRecommendation(
        "dispatch_agent",
        "software-developer",
      ),
      output: makeAgentOutput("orchestrator-planner", "{}"),
    })),
    ...overrides,
  };
}

function registerTestAgents() {
  const agentIds = [
    "orchestrator-planner",
    "software-developer",
    "qa-engineer",
    "refactorer",
    "bug-fixer",
    "commit-generator",
    "engineering-manager",
    "product-manager",
    "product-designer",
  ];
  for (const id of agentIds) {
    if (!hasAgent(id)) {
      registerAgent({
        id,
        name: id,
        capabilities: ["read"],
        defaultSandbox: "read-only",
        buildPrompt: () => "test prompt",
      });
    }
  }
}

// ── Tests ──

describe("detectAgentCycle", () => {
  it("returns false for empty history", () => {
    expect(detectAgentCycle([])).toBe(false);
  });

  it("returns false for short history", () => {
    expect(detectAgentCycle(["a", "b", "a"])).toBe(false);
  });

  it("detects 4 consecutive same agents", () => {
    expect(detectAgentCycle(["a", "a", "a", "a"])).toBe(true);
  });

  it("detects 2-agent cycle repeated 3 times", () => {
    expect(detectAgentCycle(["a", "b", "a", "b", "a", "b"])).toBe(true);
  });

  it("does not false-positive for mixed history", () => {
    expect(detectAgentCycle(["a", "b", "c", "a", "b", "c"])).toBe(false);
  });

  it("does not false-positive for 3 consecutive same agents", () => {
    expect(detectAgentCycle(["a", "a", "a"])).toBe(false);
  });

  it("detects cycle in longer history", () => {
    expect(detectAgentCycle(["x", "y", "a", "b", "a", "b", "a", "b"])).toBe(
      true,
    );
  });
});

describe("buildFallbackRecommendation", () => {
  it("dispatches implementer when no write agent ran", () => {
    const rec = buildFallbackRecommendation(
      [],
      "software-developer",
      "qa-engineer",
    );
    expect(rec.recommendation.action).toBe("dispatch_agent");
    expect(rec.recommendation.agentId).toBe("software-developer");
  });

  it("dispatches implementer when only advisory agents ran", () => {
    const rec = buildFallbackRecommendation(
      ["product-manager"],
      "software-developer",
      "qa-engineer",
    );
    expect(rec.recommendation.action).toBe("dispatch_agent");
    expect(rec.recommendation.agentId).toBe("software-developer");
  });

  it("dispatches reviewer after write agent", () => {
    const rec = buildFallbackRecommendation(
      ["software-developer"],
      "software-developer",
      "qa-engineer",
    );
    expect(rec.recommendation.action).toBe("dispatch_agent");
    expect(rec.recommendation.agentId).toBe("qa-engineer");
  });

  it("dispatches reviewer after refactorer", () => {
    const rec = buildFallbackRecommendation(
      ["software-developer", "qa-engineer", "refactorer"],
      "software-developer",
      "qa-engineer",
    );
    expect(rec.recommendation.action).toBe("dispatch_agent");
    expect(rec.recommendation.agentId).toBe("qa-engineer");
  });

  it("returns task_complete when QA verdict is DONE", () => {
    const rec = buildFallbackRecommendation(
      ["software-developer", "qa-engineer"],
      "software-developer",
      "qa-engineer",
      "DONE",
    );
    expect(rec.recommendation.action).toBe("task_complete");
  });

  it("dispatches bug-fixer when QA verdict is ISSUES", () => {
    const rec = buildFallbackRecommendation(
      ["software-developer", "qa-engineer"],
      "software-developer",
      "qa-engineer",
      "ISSUES",
    );
    expect(rec.recommendation.action).toBe("dispatch_agent");
    expect(rec.recommendation.agentId).toBe("bug-fixer");
  });

  it("dispatches refactorer when QA verdict is REFACTOR", () => {
    const rec = buildFallbackRecommendation(
      ["software-developer", "qa-engineer"],
      "software-developer",
      "qa-engineer",
      "REFACTOR",
    );
    expect(rec.recommendation.action).toBe("dispatch_agent");
    expect(rec.recommendation.agentId).toBe("refactorer");
  });

  it("blocks when it cannot determine next step", () => {
    const rec = buildFallbackRecommendation(
      ["software-developer", "unknown-agent"],
      "software-developer",
      "qa-engineer",
    );
    expect(rec.recommendation.action).toBe("block_task");
  });

  it("includes fallback warnings", () => {
    const rec = buildFallbackRecommendation(
      [],
      "software-developer",
      "qa-engineer",
    );
    expect(rec.warnings.length).toBeGreaterThan(0);
    expect(rec.warnings[0]).toContain("fallback");
  });
});

describe("resolveAgentIds", () => {
  it("returns defaults with no team config", () => {
    const { implementer, reviewer } = resolveAgentIds();
    expect(implementer).toBe("software-developer");
    expect(reviewer).toBe("qa-engineer");
  });

  it("uses team config roles", () => {
    const { implementer, reviewer } = resolveAgentIds({
      name: "test-team",
      roles: [
        {
          id: "custom-dev",
          name: "Dev",
          sandbox: "workspace-write",
          permissions: { canWrite: true, canExecute: true, canCommit: false },
        },
        {
          id: "custom-qa-reviewer",
          name: "QA",
          sandbox: "read-only",
          permissions: { canWrite: false, canExecute: false, canCommit: false },
        },
      ],
    });
    expect(implementer).toBe("custom-dev");
    expect(reviewer).toBe("custom-qa-reviewer");
  });
});

describe("WRITE_AGENT_IDS", () => {
  it("includes the three write agents", () => {
    expect(WRITE_AGENT_IDS.has("software-developer")).toBe(true);
    expect(WRITE_AGENT_IDS.has("refactorer")).toBe(true);
    expect(WRITE_AGENT_IDS.has("bug-fixer")).toBe(true);
  });

  it("does not include read-only agents", () => {
    expect(WRITE_AGENT_IDS.has("qa-engineer")).toBe(false);
    expect(WRITE_AGENT_IDS.has("product-manager")).toBe(false);
  });
});

describe("executeOrchestrator — planner-driven flow", () => {
  beforeEach(() => {
    clearRegistry();
    registerTestAgents();
  });

  it("dispatches PM → DEV → QA(DONE) → commit (full advisory flow)", async () => {
    const doc = makeDocument();
    const state = makeRunState();
    const eventBus = new EventBus();
    const dispatched: string[] = [];

    let plannerCallCount = 0;
    const plannerSequence: PlannerRecommendation[] = [
      makePlannerRecommendation("dispatch_agent", "product-manager"),
      makePlannerRecommendation("dispatch_agent", "software-developer"),
      makePlannerRecommendation("dispatch_agent", "qa-engineer"),
    ];

    const deps = createMockDeps({
      consultPlanner: mock(async () => {
        const rec =
          plannerSequence[plannerCallCount] ??
          makePlannerRecommendation("block_task");
        plannerCallCount++;
        return {
          recommendation: rec,
          output: makeAgentOutput("orchestrator-planner", "{}"),
        };
      }),
      runAgent: mock(async (params) => {
        dispatched.push(params.agent.id);
        if (params.agent.id === "qa-engineer") {
          return makeAgentOutput(
            "qa-engineer",
            JSON.stringify({ status: "DONE", notes: [] }),
          );
        }
        if (params.agent.id === "commit-generator") {
          return makeAgentOutput(
            "commit-generator",
            JSON.stringify({
              subject: "feat(test): implement feature",
              body: "",
            }),
          );
        }
        return makeAgentOutput(params.agent.id, "ok");
      }),
    });

    await executeOrchestrator(
      {
        rootDir: "/tmp/test",
        state,
        statePath: "/tmp/test/state.json",
        document: doc,
        runtime: mockRuntime,
        eventBus,
        streamOutput: false,
        skipQualityGates: true,
      },
      deps,
    );

    expect(dispatched).toContain("product-manager");
    expect(dispatched).toContain("software-developer");
    expect(dispatched).toContain("qa-engineer");
    expect(dispatched).toContain("commit-generator");
    expect(state.tasks[0]?.status).toBe("passed");
  });

  it("skips PM/PD for simple tasks — straight to DEV → QA → commit", async () => {
    const doc = makeDocument();
    const state = makeRunState();
    const eventBus = new EventBus();
    const dispatched: string[] = [];

    let plannerCallCount = 0;
    const plannerSequence: PlannerRecommendation[] = [
      makePlannerRecommendation("dispatch_agent", "software-developer"),
      makePlannerRecommendation("dispatch_agent", "qa-engineer"),
    ];

    const deps = createMockDeps({
      consultPlanner: mock(async () => {
        const rec =
          plannerSequence[plannerCallCount] ??
          makePlannerRecommendation("block_task");
        plannerCallCount++;
        return {
          recommendation: rec,
          output: makeAgentOutput("orchestrator-planner", "{}"),
        };
      }),
      runAgent: mock(async (params) => {
        dispatched.push(params.agent.id);
        if (params.agent.id === "qa-engineer") {
          return makeAgentOutput(
            "qa-engineer",
            JSON.stringify({ status: "DONE", notes: [] }),
          );
        }
        if (params.agent.id === "commit-generator") {
          return makeAgentOutput(
            "commit-generator",
            JSON.stringify({
              subject: "feat(test): implement feature",
              body: "",
            }),
          );
        }
        return makeAgentOutput(params.agent.id, "ok");
      }),
    });

    await executeOrchestrator(
      {
        rootDir: "/tmp/test",
        state,
        statePath: "/tmp/test/state.json",
        document: doc,
        runtime: mockRuntime,
        eventBus,
        streamOutput: false,
        skipQualityGates: true,
      },
      deps,
    );

    expect(dispatched).not.toContain("product-manager");
    expect(dispatched).not.toContain("product-designer");
    expect(dispatched).toContain("software-developer");
    expect(dispatched).toContain("qa-engineer");
    expect(state.tasks[0]?.status).toBe("passed");
  });

  it("falls back when planner agent crashes", async () => {
    const doc = makeDocument();
    const state = makeRunState();
    const eventBus = new EventBus();
    const dispatched: string[] = [];

    const deps = createMockDeps({
      consultPlanner: mock(async () => {
        throw new Error("Planner crashed");
      }),
      runAgent: mock(async (params) => {
        dispatched.push(params.agent.id);
        if (params.agent.id === "qa-engineer") {
          return makeAgentOutput(
            "qa-engineer",
            JSON.stringify({ status: "DONE", notes: [] }),
          );
        }
        if (params.agent.id === "commit-generator") {
          return makeAgentOutput(
            "commit-generator",
            JSON.stringify({
              subject: "feat(test): implement feature",
              body: "",
            }),
          );
        }
        return makeAgentOutput(params.agent.id, "ok");
      }),
    });

    await executeOrchestrator(
      {
        rootDir: "/tmp/test",
        state,
        statePath: "/tmp/test/state.json",
        document: doc,
        runtime: mockRuntime,
        eventBus,
        streamOutput: false,
        skipQualityGates: true,
      },
      deps,
    );

    // Fallback should dispatch DEV → QA → commit
    expect(dispatched).toContain("software-developer");
    expect(dispatched).toContain("qa-engineer");
    expect(state.tasks[0]?.status).toBe("passed");

    // Should log planner_fallback decisions
    const appendCalls = (deps.appendDecision as ReturnType<typeof mock>).mock
      .calls;
    const fallbackDecisions = appendCalls.filter(
      (c: unknown[]) =>
        (c[1] as { action: string }).action === "planner_fallback",
    );
    expect(fallbackDecisions.length).toBeGreaterThan(0);
  });

  it("detects cycle and breaks planner loop", async () => {
    const doc = makeDocument();
    const state = makeRunState();
    const eventBus = new EventBus();
    const dispatched: string[] = [];

    // Planner keeps alternating between dev and qa-engineer without QA producing a parseable verdict
    let plannerCallCount = 0;
    const deps = createMockDeps({
      consultPlanner: mock(async () => {
        const agentId =
          plannerCallCount % 2 === 0 ? "software-developer" : "qa-engineer";
        plannerCallCount++;
        return {
          recommendation: makePlannerRecommendation("dispatch_agent", agentId),
          output: makeAgentOutput("orchestrator-planner", "{}"),
        };
      }),
      runAgent: mock(async (params) => {
        dispatched.push(params.agent.id);
        if (params.agent.id === "qa-engineer") {
          // Return unparseable QA output to prevent commit
          return makeAgentOutput("qa-engineer", "unparseable");
        }
        return makeAgentOutput(params.agent.id, "ok");
      }),
    });

    await executeOrchestrator(
      {
        rootDir: "/tmp/test",
        state,
        statePath: "/tmp/test/state.json",
        document: doc,
        runtime: mockRuntime,
        eventBus,
        streamOutput: false,
        skipQualityGates: true,
      },
      deps,
    );

    // Eventually cycle detection should kick in or task should be blocked
    expect(state.tasks[0]?.status).not.toBe("passed");
  });

  it("enforces MAX_PLANNER_STEPS", async () => {
    const doc = makeDocument();
    const state = makeRunState();
    const eventBus = new EventBus();

    let plannerCallCount = 0;
    const deps = createMockDeps({
      consultPlanner: mock(async () => {
        plannerCallCount++;
        // Keep dispatching PM which doesn't resolve
        return {
          recommendation: makePlannerRecommendation(
            "dispatch_agent",
            "product-manager",
          ),
          output: makeAgentOutput("orchestrator-planner", "{}"),
        };
      }),
      runAgent: mock(async (params) => {
        return makeAgentOutput(params.agent.id, "ok");
      }),
    });

    await executeOrchestrator(
      {
        rootDir: "/tmp/test",
        state,
        statePath: "/tmp/test/state.json",
        document: doc,
        runtime: mockRuntime,
        eventBus,
        streamOutput: false,
        skipQualityGates: true,
      },
      deps,
    );

    // Should have stopped after MAX_PLANNER_STEPS (20) per attempt
    // With retryLimit=1, that's 2 attempts × 20 steps max = 40 max planner calls
    expect(plannerCallCount).toBeLessThanOrEqual(40);
    expect(state.tasks[0]?.status).not.toBe("passed");
  });

  it("enforces QA cycle limit within planner loop", async () => {
    const doc = makeDocument();
    const state = makeRunState();
    const eventBus = new EventBus();
    let qaCycles = 0;

    let plannerCallCount = 0;
    const deps = createMockDeps({
      consultPlanner: mock(async () => {
        plannerCallCount++;
        // Alternate between dev, qa, and fix agents
        if (plannerCallCount === 1) {
          return {
            recommendation: makePlannerRecommendation(
              "dispatch_agent",
              "software-developer",
            ),
            output: makeAgentOutput("orchestrator-planner", "{}"),
          };
        }
        // After first dev run, always dispatch QA then bug-fixer
        if (plannerCallCount % 2 === 0) {
          return {
            recommendation: makePlannerRecommendation(
              "dispatch_agent",
              "qa-engineer",
            ),
            output: makeAgentOutput("orchestrator-planner", "{}"),
          };
        }
        return {
          recommendation: makePlannerRecommendation(
            "dispatch_agent",
            "bug-fixer",
          ),
          output: makeAgentOutput("orchestrator-planner", "{}"),
        };
      }),
      runAgent: mock(async (params) => {
        if (params.agent.id === "qa-engineer") {
          qaCycles++;
          return makeAgentOutput(
            "qa-engineer",
            JSON.stringify({
              status: "ISSUES",
              notes: ["needs work"],
            }),
          );
        }
        return makeAgentOutput(params.agent.id, "ok");
      }),
    });

    await executeOrchestrator(
      {
        rootDir: "/tmp/test",
        state,
        statePath: "/tmp/test/state.json",
        document: doc,
        runtime: mockRuntime,
        eventBus,
        streamOutput: false,
        skipQualityGates: true,
      },
      deps,
    );

    // QA cycles should not exceed MAX_QA_CYCLES (5) per attempt
    // With 2 attempts, max is 10
    expect(qaCycles).toBeLessThanOrEqual(10);
  });

  it("runs quality gates after write agents", async () => {
    const doc = makeDocument();
    const state = makeRunState();
    const eventBus = new EventBus();
    let gatesRan = false;

    let plannerCallCount = 0;
    const plannerSequence: PlannerRecommendation[] = [
      makePlannerRecommendation("dispatch_agent", "software-developer"),
      makePlannerRecommendation("dispatch_agent", "qa-engineer"),
    ];

    const deps = createMockDeps({
      consultPlanner: mock(async () => {
        const rec =
          plannerSequence[plannerCallCount] ??
          makePlannerRecommendation("block_task");
        plannerCallCount++;
        return {
          recommendation: rec,
          output: makeAgentOutput("orchestrator-planner", "{}"),
        };
      }),
      runAgent: mock(async (params) => {
        if (params.agent.id === "qa-engineer") {
          return makeAgentOutput(
            "qa-engineer",
            JSON.stringify({ status: "DONE", notes: [] }),
          );
        }
        if (params.agent.id === "commit-generator") {
          return makeAgentOutput(
            "commit-generator",
            JSON.stringify({
              subject: "feat(test): implement feature",
              body: "",
            }),
          );
        }
        return makeAgentOutput(params.agent.id, "ok");
      }),
      runQualityGates: mock(async () => {
        gatesRan = true;
        return { passed: true, details: "all checks passed" };
      }),
    });

    await executeOrchestrator(
      {
        rootDir: "/tmp/test",
        state,
        statePath: "/tmp/test/state.json",
        document: doc,
        runtime: mockRuntime,
        eventBus,
        streamOutput: false,
        skipQualityGates: false,
      },
      deps,
    );

    expect(gatesRan).toBe(true);
    expect(state.tasks[0]?.status).toBe("passed");
  });

  it("commits on QA DONE verdict", async () => {
    const doc = makeDocument();
    const state = makeRunState();
    const eventBus = new EventBus();
    let committed = false;

    let plannerCallCount = 0;
    const plannerSequence: PlannerRecommendation[] = [
      makePlannerRecommendation("dispatch_agent", "software-developer"),
      makePlannerRecommendation("dispatch_agent", "qa-engineer"),
    ];

    const deps = createMockDeps({
      consultPlanner: mock(async () => {
        const rec =
          plannerSequence[plannerCallCount] ??
          makePlannerRecommendation("block_task");
        plannerCallCount++;
        return {
          recommendation: rec,
          output: makeAgentOutput("orchestrator-planner", "{}"),
        };
      }),
      runAgent: mock(async (params) => {
        if (params.agent.id === "qa-engineer") {
          return makeAgentOutput(
            "qa-engineer",
            JSON.stringify({ status: "DONE", notes: [] }),
          );
        }
        if (params.agent.id === "commit-generator") {
          return makeAgentOutput(
            "commit-generator",
            JSON.stringify({
              subject: "feat(test): implement feature",
              body: "",
            }),
          );
        }
        return makeAgentOutput(params.agent.id, "ok");
      }),
      commitStaged: mock(async () => {
        committed = true;
      }),
    });

    await executeOrchestrator(
      {
        rootDir: "/tmp/test",
        state,
        statePath: "/tmp/test/state.json",
        document: doc,
        runtime: mockRuntime,
        eventBus,
        streamOutput: false,
        skipQualityGates: true,
      },
      deps,
    );

    expect(committed).toBe(true);
    expect(state.tasks[0]?.status).toBe("passed");
    expect(state.tasks[0]?.lastCommit).toBe("abc123");
  });

  it("handles skip_task from planner", async () => {
    const doc = makeDocument();
    const state = makeRunState();
    const eventBus = new EventBus();

    const deps = createMockDeps({
      consultPlanner: mock(async () => ({
        recommendation: makePlannerRecommendation("skip_task"),
        output: makeAgentOutput("orchestrator-planner", "{}"),
      })),
    });

    await executeOrchestrator(
      {
        rootDir: "/tmp/test",
        state,
        statePath: "/tmp/test/state.json",
        document: doc,
        runtime: mockRuntime,
        eventBus,
        streamOutput: false,
        skipQualityGates: true,
      },
      deps,
    );

    expect(state.tasks[0]?.status).toBe("passed");
  });

  it("handles block_task from planner", async () => {
    const doc = makeDocument();
    const state = makeRunState();
    const eventBus = new EventBus();

    const deps = createMockDeps({
      consultPlanner: mock(async () => ({
        recommendation: makePlannerRecommendation("block_task"),
        output: makeAgentOutput("orchestrator-planner", "{}"),
      })),
    });

    await executeOrchestrator(
      {
        rootDir: "/tmp/test",
        state,
        statePath: "/tmp/test/state.json",
        document: doc,
        runtime: mockRuntime,
        eventBus,
        streamOutput: false,
        skipQualityGates: true,
      },
      deps,
    );

    expect(state.tasks[0]?.status).toBe("blocked");
    expect(state.status).toBe("blocked");
  });

  it("handles task_complete from planner", async () => {
    const doc = makeDocument();
    const state = makeRunState();
    const eventBus = new EventBus();

    let plannerCallCount = 0;
    const deps = createMockDeps({
      consultPlanner: mock(async () => {
        plannerCallCount++;
        if (plannerCallCount === 1) {
          return {
            recommendation: makePlannerRecommendation(
              "dispatch_agent",
              "software-developer",
            ),
            output: makeAgentOutput("orchestrator-planner", "{}"),
          };
        }
        return {
          recommendation: makePlannerRecommendation("task_complete"),
          output: makeAgentOutput("orchestrator-planner", "{}"),
        };
      }),
      runAgent: mock(async (params) => {
        if (params.agent.id === "commit-generator") {
          return makeAgentOutput(
            "commit-generator",
            JSON.stringify({
              subject: "feat(test): implement feature",
              body: "",
            }),
          );
        }
        return makeAgentOutput(params.agent.id, "ok");
      }),
    });

    await executeOrchestrator(
      {
        rootDir: "/tmp/test",
        state,
        statePath: "/tmp/test/state.json",
        document: doc,
        runtime: mockRuntime,
        eventBus,
        streamOutput: false,
        skipQualityGates: true,
      },
      deps,
    );

    expect(state.tasks[0]?.status).toBe("passed");
  });

  it("handles retry_task from planner", async () => {
    const doc = makeDocument();
    const state = makeRunState();
    const eventBus = new EventBus();

    let plannerCallCount = 0;
    const deps = createMockDeps({
      consultPlanner: mock(async () => {
        plannerCallCount++;
        // First attempt: retry
        if (plannerCallCount === 1) {
          return {
            recommendation: makePlannerRecommendation("retry_task"),
            output: makeAgentOutput("orchestrator-planner", "{}"),
          };
        }
        // Second attempt: proceed normally
        if (plannerCallCount === 2) {
          return {
            recommendation: makePlannerRecommendation(
              "dispatch_agent",
              "software-developer",
            ),
            output: makeAgentOutput("orchestrator-planner", "{}"),
          };
        }
        if (plannerCallCount === 3) {
          return {
            recommendation: makePlannerRecommendation(
              "dispatch_agent",
              "qa-engineer",
            ),
            output: makeAgentOutput("orchestrator-planner", "{}"),
          };
        }
        return {
          recommendation: makePlannerRecommendation("block_task"),
          output: makeAgentOutput("orchestrator-planner", "{}"),
        };
      }),
      runAgent: mock(async (params) => {
        if (params.agent.id === "qa-engineer") {
          return makeAgentOutput(
            "qa-engineer",
            JSON.stringify({ status: "DONE", notes: [] }),
          );
        }
        if (params.agent.id === "commit-generator") {
          return makeAgentOutput(
            "commit-generator",
            JSON.stringify({
              subject: "feat(test): implement feature",
              body: "",
            }),
          );
        }
        return makeAgentOutput(params.agent.id, "ok");
      }),
    });

    await executeOrchestrator(
      {
        rootDir: "/tmp/test",
        state,
        statePath: "/tmp/test/state.json",
        document: doc,
        runtime: mockRuntime,
        eventBus,
        streamOutput: false,
        skipQualityGates: true,
      },
      deps,
    );

    // Should have retried and then succeeded on second attempt
    expect(state.tasks[0]?.attempts).toBe(2);
    expect(state.tasks[0]?.status).toBe("passed");
  });

  it("planner context is injected into agent peerProgress", async () => {
    const doc = makeDocument();
    const state = makeRunState();
    const eventBus = new EventBus();
    let capturedPeerProgress: Map<string, string> | undefined;

    let plannerCallCount = 0;
    const deps = createMockDeps({
      consultPlanner: mock(async () => {
        plannerCallCount++;
        if (plannerCallCount === 1) {
          return {
            recommendation: makePlannerRecommendation(
              "dispatch_agent",
              "software-developer",
              {
                agentContext: "Focus on the API layer",
                scope: ["src/api.ts", "src/routes.ts"],
              },
            ),
            output: makeAgentOutput("orchestrator-planner", "{}"),
          };
        }
        return {
          recommendation: makePlannerRecommendation("task_complete"),
          output: makeAgentOutput("orchestrator-planner", "{}"),
        };
      }),
      runAgent: mock(async (params) => {
        if (params.agent.id === "software-developer") {
          capturedPeerProgress = params.input.peerProgress;
        }
        if (params.agent.id === "commit-generator") {
          return makeAgentOutput(
            "commit-generator",
            JSON.stringify({
              subject: "feat(test): implement feature",
              body: "",
            }),
          );
        }
        return makeAgentOutput(params.agent.id, "ok");
      }),
    });

    await executeOrchestrator(
      {
        rootDir: "/tmp/test",
        state,
        statePath: "/tmp/test/state.json",
        document: doc,
        runtime: mockRuntime,
        eventBus,
        streamOutput: false,
        skipQualityGates: true,
      },
      deps,
    );

    expect(capturedPeerProgress).toBeDefined();
    expect(capturedPeerProgress!.get("plannerContext")).toBe(
      "Focus on the API layer",
    );
    expect(capturedPeerProgress!.get("plannerScope")).toBe(
      "src/api.ts\nsrc/routes.ts",
    );
  });
});
