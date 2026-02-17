import type { RuntimeProvider } from "../runtime/provider";
import type { EventBus } from "../monitor/event-bus";
import type {
  AgentInput,
  AgentOutput,
  FailedAttempt,
  FailureCategory,
  PlanPhase,
  PlanTask,
  PlannerRecommendation,
  RunState,
  TasksDocument,
  VerifierStatus,
} from "../state/types";
import { WRITE_AGENT_IDS } from "../state/types";
import type { TeamConfig } from "../config/types";
import { getAgent, hasAgent } from "../agents/registry";
import { runAgent } from "../agents/agent-runner";
import { appendDecision } from "./decision-log";
import { isRunFinished } from "./scheduler";
import {
  consultPlanner,
  getSourcesPlanPath,
  getSourcesTasksPath,
  markTaskDoneInSources,
} from "./planner";
import { getPhaseState, getTaskState } from "../state/selectors";
import { saveRunState } from "../state/run-state";
import { runQualityGates } from "../runtime/quality-gates";
import type { QualityGateStep } from "../runtime/quality-gates";
import { buildStepArtifacts } from "../state/artifacts";
import type { DiscoveredSteps } from "../agents/mini/quality-gate-discoverer";
import {
  parseVerifierDecision,
  parseConventionalCommit,
} from "../agents/prompts/templates";
import { truncateText } from "../agents/prompts/context-builder";
import { writeProgressFile } from "../state/progress-writer";
import { writeHandoff } from "./handoff";
import {
  commitStaged,
  headCommit,
  listChangedFiles,
  stageAll,
  stagedDiff,
  stagedDiffStat,
} from "../git/operations";
import { getRecoveryStrategy } from "../errors/recovery";
import { categorizeQualityGateFailure } from "../errors/categories";

const MAX_QA_CYCLES = 5;
const MAX_PLANNER_STEPS = 20;

export interface OrchestratorParams {
  rootDir: string;
  state: RunState;
  statePath: string;
  document: TasksDocument;
  runtime: RuntimeProvider;
  eventBus: EventBus;
  model?: string;
  streamOutput: boolean;
  skipQualityGates: boolean;
  timeout?: number;
  teamConfig?: TeamConfig;
}

export function resolveAgentIds(teamConfig?: TeamConfig): {
  implementer: string;
  reviewer: string;
} {
  if (!teamConfig) {
    return { implementer: "software-developer", reviewer: "qa-engineer" };
  }
  const implementer =
    teamConfig.roles.find((r) => r.permissions.canWrite)?.id ??
    "software-developer";
  const reviewer =
    teamConfig.roles.find((r) => r.id.includes("qa") || r.id.includes("review"))
      ?.id ?? "qa-engineer";
  return { implementer, reviewer };
}

export interface OrchestratorDependencies {
  saveRunState: typeof saveRunState;
  runQualityGates: typeof runQualityGates;
  listChangedFiles: typeof listChangedFiles;
  stageAll: typeof stageAll;
  stagedDiffStat: typeof stagedDiffStat;
  stagedDiff: typeof stagedDiff;
  commitStaged: typeof commitStaged;
  headCommit: typeof headCommit;
  writeProgressFile: typeof writeProgressFile;
  appendDecision: typeof appendDecision;
  writeHandoff: typeof writeHandoff;
  runAgent: typeof runAgent;
  consultPlanner: typeof consultPlanner;
}

const defaultDeps: OrchestratorDependencies = {
  saveRunState,
  runQualityGates,
  listChangedFiles,
  stageAll,
  stagedDiffStat,
  stagedDiff,
  commitStaged,
  headCommit,
  writeProgressFile,
  appendDecision,
  writeHandoff,
  runAgent,
  consultPlanner,
};

async function discoverAndCacheQualityGateSteps(
  params: OrchestratorParams,
  deps: OrchestratorDependencies,
): Promise<void> {
  const { rootDir, state, statePath, runtime, eventBus } = params;

  if (!hasAgent("quality-gate-discoverer")) return;

  const agent = getAgent("quality-gate-discoverer");

  const logPath = `${state.logDir}/quality-gate-discovery.log`;
  const outputPath = `${state.messageDir}/quality-gate-discovery.md`;

  // Show agent as running in TUI
  await eventBus.emit({
    type: "agent:dispatched",
    ts: new Date().toISOString(),
    runId: state.runId,
    agentId: "quality-gate-discoverer",
    taskId: "_discovery",
    phaseId: "_discovery",
    message: "Scanning repo for quality gate commands...",
  });

  // Build a minimal AgentInput for the discoverer (it ignores task-specific fields)
  const dummyInput: AgentInput = {
    task: {
      id: "_discovery",
      status: "todo",
      title: "Quality Gate Discovery",
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
    peerProgress: new Map(),
    previousFailedAttempts: [],
    attempt: 1,
    maxAttempts: 1,
  };

  const prompt = agent.buildPrompt(dummyInput);
  const startTime = Date.now();

  try {
    const result = await runtime.execute({
      rootDir,
      prompt,
      logPath,
      outputPath,
      model: params.model,
      sandbox: agent.defaultSandbox,
      timeout: 60_000,
      streamOutput: false,
    });

    const durationMs = Date.now() - startTime;

    let steps: DiscoveredSteps["steps"] = [];
    if (agent.parseOutput && result.output) {
      try {
        const parsed = agent.parseOutput(result.output) as DiscoveredSteps;
        steps = parsed.steps ?? [];
      } catch {
        // Parse failure → no gates
      }
    }

    state.qualityGateSteps = steps.map((s) => ({ name: s.name, cmd: s.cmd }));
    await deps.saveRunState(statePath, state);

    // Mark agent completed in TUI
    await eventBus.emit({
      type: "agent:completed",
      ts: new Date().toISOString(),
      runId: state.runId,
      agentId: "quality-gate-discoverer",
      taskId: "_discovery",
      phaseId: "_discovery",
      exitCode: result.exitCode,
      durationMs,
    });

    await eventBus.emit({
      type: "quality-gate:discovered",
      ts: new Date().toISOString(),
      runId: state.runId,
      steps: state.qualityGateSteps,
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;

    // Discovery failure is non-fatal — gates will be empty
    state.qualityGateSteps = [];
    await deps.saveRunState(statePath, state);

    // Mark agent failed in TUI
    await eventBus.emit({
      type: "agent:completed",
      ts: new Date().toISOString(),
      runId: state.runId,
      agentId: "quality-gate-discoverer",
      taskId: "_discovery",
      phaseId: "_discovery",
      exitCode: 1,
      durationMs,
    });

    await eventBus.emit({
      type: "log:warn",
      ts: new Date().toISOString(),
      runId: state.runId,
      source: "orchestrator",
      message: `Quality gate discovery failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

export async function executeOrchestrator(
  params: OrchestratorParams,
  deps: OrchestratorDependencies = defaultDeps,
): Promise<void> {
  const { rootDir, state, statePath, document, runtime, eventBus } = params;

  await eventBus.emit({
    type: "run:started",
    ts: new Date().toISOString(),
    runId: state.runId,
    details: `Starting run with ${document.phases.length} phases`,
  });

  // Discover quality gate steps once per run (cached in state)
  if (!params.skipQualityGates && state.qualityGateSteps === undefined) {
    await discoverAndCacheQualityGateSteps(params, deps);
  }

  for (const phase of document.phases) {
    const phaseState = getPhaseState(state, phase.id);
    if (phaseState.status === "completed") continue;

    phaseState.status = "in_progress";
    await deps.saveRunState(statePath, state);

    await eventBus.emit({
      type: "log:info",
      ts: new Date().toISOString(),
      runId: state.runId,
      source: "orchestrator",
      message: `Starting phase ${phase.id}: ${phase.name} (${phase.tasks.length} tasks)`,
    });

    for (const planTask of phase.tasks) {
      const taskState = getTaskState(state, phase.id, planTask.id);
      if (taskState.status === "passed") continue;
      if (taskState.status === "blocked") continue;

      await eventBus.emit({
        type: "task:started",
        ts: new Date().toISOString(),
        runId: state.runId,
        taskId: planTask.id,
        phaseId: phase.id,
      });

      const result = await executeTaskFlow(
        {
          rootDir,
          state,
          statePath,
          phase,
          planTask,
          runtime,
          eventBus,
          model: params.model,
          streamOutput: params.streamOutput,
          skipQualityGates: params.skipQualityGates,
          timeout: params.timeout,
          teamConfig: params.teamConfig,
        },
        deps,
      );

      if (!result.success) {
        taskState.status = "blocked";
        phaseState.status = "blocked";
        state.status = "blocked";

        await deps.writeHandoff({
          state,
          phase,
          task: planTask,
          failureCategory: result.failureCategory ?? "task_blocked",
          failureDetails: result.failureDetails ?? "Unknown failure",
        });

        await deps.saveRunState(statePath, state);

        await eventBus.emit({
          type: "task:blocked",
          ts: new Date().toISOString(),
          runId: state.runId,
          taskId: planTask.id,
          phaseId: phase.id,
          failureCategory: result.failureCategory,
          failureDetails: result.failureDetails,
        });

        await eventBus.emit({
          type: "run:blocked",
          ts: new Date().toISOString(),
          runId: state.runId,
          details: `Blocked on ${planTask.id}: ${result.failureDetails}`,
        });

        return;
      }
    }

    // Check if phase is complete
    const allPassed = phase.tasks.every((t) => {
      const ts = getTaskState(state, phase.id, t.id);
      return ts.status === "passed";
    });
    if (allPassed) {
      phaseState.status = "completed";
      await eventBus.emit({
        type: "log:info",
        ts: new Date().toISOString(),
        runId: state.runId,
        source: "orchestrator",
        message: `Phase ${phase.id} completed`,
      });
    }
    await deps.saveRunState(statePath, state);
  }

  if (isRunFinished(state, document.phases)) {
    state.status = "completed";
    await deps.saveRunState(statePath, state);
    await eventBus.emit({
      type: "run:completed",
      ts: new Date().toISOString(),
      runId: state.runId,
    });
  }
}

// ── Types ──

interface TaskFlowResult {
  success: boolean;
  commitHash?: string;
  failureCategory?: FailureCategory;
  failureDetails?: string;
}

interface QualityGateCheckResult {
  passed: boolean;
  failureDetails?: string;
  failedStep?: string;
  category?: FailureCategory;
  strategy?: string;
}

interface CommitResult {
  success: boolean;
  commitHash?: string;
  error?: string;
}

// ── Extracted helpers ──

async function escalateToEM(
  params: {
    state: RunState;
    phase: PlanPhase;
    planTask: PlanTask;
    runtime: RuntimeProvider;
    eventBus: EventBus;
    failureContext: string;
    stepSequence: number;
    model?: string;
    streamOutput: boolean;
    timeout?: number;
  },
  deps: OrchestratorDependencies,
): Promise<AgentOutput | null> {
  try {
    const emAgent = getAgent("engineering-manager");
    const emInput: AgentInput = {
      task: params.planTask,
      phase: params.phase,
      planPath: getSourcesPlanPath(params.state.sourcesDir),
      tasksPath: getSourcesTasksPath(params.state.sourcesDir),
      previousOutputs: [],
      peerProgress: new Map([["failureContext", params.failureContext]]),
      previousFailedAttempts: [],
      attempt: 1,
      maxAttempts: 1,
    };

    const emOutput = await deps.runAgent({
      agent: emAgent,
      input: emInput,
      runtime: params.runtime,
      state: params.state,
      stepSequence: params.stepSequence + 100,
      eventBus: params.eventBus,
      model: params.model,
      streamOutput: params.streamOutput,
      timeout: params.timeout,
    });

    await deps.appendDecision(params.state.decisionsDir, {
      ts: new Date().toISOString(),
      action: "escalate",
      agentId: "engineering-manager",
      taskId: params.planTask.id,
      outcome: `EM recommendation: ${emOutput.raw.slice(0, 500)}`,
    });

    await params.eventBus.emit({
      type: "log:info",
      ts: new Date().toISOString(),
      runId: params.state.runId,
      message: `EM escalation for ${params.planTask.id}: ${emOutput.raw.slice(0, 200)}`,
      source: "engineering-manager",
    });

    return emOutput;
  } catch (err) {
    console.error("EM escalation failed (best-effort):", err);
    return null;
  }
}

export async function runQualityGateCheck(
  params: {
    rootDir: string;
    state: RunState;
    phase: PlanPhase;
    planTask: PlanTask;
    attempt: number;
    stepSequence: number;
    streamOutput: boolean;
    eventBus: EventBus;
  },
  deps: OrchestratorDependencies,
): Promise<QualityGateCheckResult> {
  const artifacts = buildStepArtifacts({
    state: params.state,
    phaseId: params.phase.id,
    taskId: params.planTask.id,
    attempt: params.attempt,
    stepSequence: params.stepSequence,
    agent: "quality-gates",
  });

  await params.eventBus.emit({
    type: "quality-gate:running",
    ts: new Date().toISOString(),
    runId: params.state.runId,
  });

  // Convert cached step configs into full QualityGateStep objects with cwd
  const cachedSteps: QualityGateStep[] | undefined =
    params.state.qualityGateSteps?.map((s) => ({
      name: s.name,
      cmd: s.cmd,
      cwd: params.rootDir,
    }));

  const gateResult = await deps.runQualityGates({
    rootDir: params.rootDir,
    logPath: artifacts.logPath,
    streamOutput: params.streamOutput,
    steps: cachedSteps,
  });

  if (!gateResult.passed) {
    const category = categorizeQualityGateFailure(
      gateResult.failedStep ?? "unknown",
    );
    const strategy = getRecoveryStrategy(category, params.attempt);

    await params.eventBus.emit({
      type: "quality-gate:failed",
      ts: new Date().toISOString(),
      runId: params.state.runId,
      gate: gateResult.failedStep,
      details: gateResult.details,
    });

    return {
      passed: false,
      failureDetails: gateResult.details,
      failedStep: gateResult.failedStep,
      category,
      strategy,
    };
  }

  await params.eventBus.emit({
    type: "quality-gate:passed",
    ts: new Date().toISOString(),
    runId: params.state.runId,
  });

  return { passed: true };
}

export async function commitChanges(
  params: {
    rootDir: string;
    state: RunState;
    statePath: string;
    phase: PlanPhase;
    planTask: PlanTask;
    runtime: RuntimeProvider;
    eventBus: EventBus;
    previousOutputs: AgentOutput[];
    stepSequence: number;
    attempt: number;
    maxAttempts: number;
    qaCycles: number;
    implementer: string;
    model?: string;
    streamOutput: boolean;
    timeout?: number;
  },
  deps: OrchestratorDependencies,
): Promise<CommitResult> {
  try {
    const allChanged = await deps.listChangedFiles(params.rootDir);
    await deps.stageAll(params.rootDir);
    const diffStat = await deps.stagedDiffStat(params.rootDir);
    const diffPatch = truncateText(
      await deps.stagedDiff(params.rootDir),
      12000,
    );

    const commitAgent = getAgent("commit-generator");
    const commitInput: AgentInput = {
      task: params.planTask,
      phase: params.phase,
      planPath: getSourcesPlanPath(params.state.sourcesDir),
      tasksPath: getSourcesTasksPath(params.state.sourcesDir),
      previousOutputs: params.previousOutputs,
      peerProgress: new Map([
        ["diffStat", diffStat],
        ["diffPatch", diffPatch],
        ["changedFiles", allChanged.join("\n")],
      ]),
      previousFailedAttempts: [],
      attempt: params.attempt,
      maxAttempts: params.maxAttempts,
    };

    const commitOutput = await deps.runAgent({
      agent: commitAgent,
      input: commitInput,
      runtime: params.runtime,
      state: params.state,
      stepSequence: params.stepSequence + 1,
      eventBus: params.eventBus,
      model: params.model,
      streamOutput: params.streamOutput,
      timeout: params.timeout,
    });

    let commitMessage: { subject: string; body: string };
    try {
      commitMessage = parseConventionalCommit(commitOutput.raw);
    } catch {
      commitMessage = {
        subject: `feat(task): ${params.planTask.title}`,
        body: "",
      };
    }

    await deps.commitStaged(
      commitMessage.subject,
      commitMessage.body,
      params.rootDir,
    );
    const hash = await deps.headCommit(params.rootDir);

    const taskState = getTaskState(
      params.state,
      params.phase.id,
      params.planTask.id,
    );
    taskState.status = "passed";
    taskState.lastCommit = hash;
    taskState.changedFiles = allChanged;
    await deps.saveRunState(params.statePath, params.state);

    // Best-effort: update sources file (non-critical, commit is done)
    try {
      await markTaskDoneInSources(params.state.sourcesDir, params.planTask.id);
    } catch {
      // Sources file update failure should not break the commit flow
    }

    await deps.appendDecision(params.state.decisionsDir, {
      ts: new Date().toISOString(),
      action: "task_complete",
      taskId: params.planTask.id,
      commit: hash,
    });

    await params.eventBus.emit({
      type: "task:completed",
      ts: new Date().toISOString(),
      runId: params.state.runId,
      taskId: params.planTask.id,
      phaseId: params.phase.id,
      commitHash: hash,
    });

    await deps.writeProgressFile({
      progressDir: params.state.progressDir,
      taskId: params.planTask.id,
      agentId: params.implementer,
      content: [
        `# Agent Progress: ${params.implementer}`,
        `## Task: ${params.planTask.id} (${params.planTask.title})`,
        "",
        `### What Was Done`,
        `- Implemented task per requirements`,
        "",
        `### Files Changed`,
        allChanged.map((f) => `- ${f}`).join("\n"),
        "",
        `### QA Cycles: ${params.qaCycles}`,
        `### Commit: ${hash}`,
      ].join("\n"),
    });

    return { success: true, commitHash: hash };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ── Cycle detection ──

export function detectAgentCycle(agentHistory: string[]): boolean {
  // Same agent dispatched 4+ times consecutively
  if (agentHistory.length >= 4) {
    const last4 = agentHistory.slice(-4);
    if (last4.every((a) => a === last4[0])) return true;
  }

  // 2-agent cycle repeated 3 times (A→B→A→B→A→B = 6 entries)
  if (agentHistory.length >= 6) {
    const last6 = agentHistory.slice(-6);
    const a = last6[0]!;
    const b = last6[1]!;
    if (
      a !== b &&
      last6[2] === a &&
      last6[3] === b &&
      last6[4] === a &&
      last6[5] === b
    ) {
      return true;
    }
  }

  return false;
}

// ── Fallback recommendation ──

export function buildFallbackRecommendation(
  agentHistory: string[],
  implementer: string,
  reviewer: string,
  lastQaVerdict?: VerifierStatus,
): PlannerRecommendation {
  const lastAgent = agentHistory.length > 0 ? agentHistory.at(-1) : undefined;

  // No DEV yet → dispatch DEV
  if (!agentHistory.some((a) => WRITE_AGENT_IDS.has(a))) {
    return {
      contextBriefing: "Fallback: no write agent has run yet",
      recommendation: {
        action: "dispatch_agent",
        agentId: implementer,
        rationale: "No implementation agent has run; dispatching implementer",
      },
      warnings: ["Using fallback logic — planner agent was unavailable"],
    };
  }

  // Last was DEV/fix agent → dispatch QA
  if (lastAgent && WRITE_AGENT_IDS.has(lastAgent)) {
    return {
      contextBriefing: "Fallback: write agent completed, need QA review",
      recommendation: {
        action: "dispatch_agent",
        agentId: reviewer,
        rationale: "Write agent completed; dispatching reviewer for QA",
      },
      warnings: ["Using fallback logic — planner agent was unavailable"],
    };
  }

  // Last was QA → parse verdict
  if (lastAgent === reviewer || lastAgent === "qa-engineer") {
    if (lastQaVerdict === "DONE") {
      return {
        contextBriefing: "Fallback: QA approved",
        recommendation: {
          action: "task_complete",
          rationale: "QA returned DONE; task is ready to commit",
        },
        warnings: ["Using fallback logic — planner agent was unavailable"],
      };
    }
    // QA found issues → dispatch fix agent
    const fixAgent = lastQaVerdict === "REFACTOR" ? "refactorer" : "bug-fixer";
    return {
      contextBriefing: "Fallback: QA found issues, dispatching fix agent",
      recommendation: {
        action: "dispatch_agent",
        agentId: fixAgent,
        rationale: `QA returned ${lastQaVerdict ?? "ISSUES"}; dispatching ${fixAgent}`,
      },
      warnings: ["Using fallback logic — planner agent was unavailable"],
    };
  }

  // Can't determine → block
  return {
    contextBriefing: "Fallback: unable to determine next step",
    recommendation: {
      action: "block_task",
      rationale:
        "Planner unavailable and fallback logic cannot determine next step",
    },
    warnings: ["Using fallback logic — planner agent was unavailable"],
  };
}

// ── Main task flow (planner-driven) ──

async function executeTaskFlow(
  params: {
    rootDir: string;
    state: RunState;
    statePath: string;
    phase: PlanPhase;
    planTask: PlanTask;
    runtime: RuntimeProvider;
    eventBus: EventBus;
    model?: string;
    streamOutput: boolean;
    skipQualityGates: boolean;
    timeout?: number;
    teamConfig?: TeamConfig;
  },
  deps: OrchestratorDependencies,
): Promise<TaskFlowResult> {
  const { rootDir, state, statePath, phase, planTask, runtime, eventBus } =
    params;
  const { implementer, reviewer } = resolveAgentIds(params.teamConfig);
  const taskState = getTaskState(state, phase.id, planTask.id);
  const maxAttempts = state.retryLimit + 1;
  let lastFailure = "";

  for (
    let attempt = taskState.attempts + 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    taskState.status = "running";
    taskState.attempts = attempt;
    taskState.lastError = undefined;
    taskState.lastQualityGate = undefined;
    taskState.changedFiles = [];
    taskState.qaCycles = 0;
    await deps.saveRunState(statePath, state);

    if (attempt > 1) {
      await eventBus.emit({
        type: "log:warn",
        ts: new Date().toISOString(),
        runId: state.runId,
        source: "orchestrator",
        message: `Retrying task ${planTask.id}, attempt ${attempt}/${maxAttempts}`,
      });
    }

    let stepSequence = 0;
    const previousOutputs: AgentOutput[] = [];
    const failedAttempts: FailedAttempt[] = [];
    const agentHistory: string[] = [];
    let plannerSteps = 0;
    let qaCycles = 0;
    let lastQaVerdict: VerifierStatus | undefined;
    let shouldRetry = false;

    while (plannerSteps < MAX_PLANNER_STEPS) {
      plannerSteps++;
      stepSequence++;

      // Build peer progress context for planner
      const changedFiles = await deps
        .listChangedFiles(rootDir)
        .catch(() => [] as string[]);
      const peerProgress = new Map<string, string>();
      peerProgress.set("implementer", implementer);
      peerProgress.set("reviewer", reviewer);
      if (changedFiles.length > 0) {
        peerProgress.set("changedFiles", changedFiles.join("\n"));
      }
      peerProgress.set("qaCycles", String(qaCycles));
      if (lastFailure) {
        peerProgress.set("lastFailure", lastFailure);
      }

      // Consult planner (with fallback)
      let recommendation: PlannerRecommendation;
      let usedFallback = false;

      if (hasAgent("orchestrator-planner")) {
        try {
          const result = await deps.consultPlanner({
            state,
            phase,
            task: planTask,
            runtime,
            eventBus,
            previousOutputs,
            peerProgress,
            failedAttempts,
            failureContext: lastFailure || undefined,
            attempt,
            maxAttempts,
            stepSequence,
            model: params.model,
            streamOutput: params.streamOutput,
            timeout: params.timeout,
          });
          recommendation = result.recommendation;
          previousOutputs.push(result.output);
        } catch {
          recommendation = buildFallbackRecommendation(
            agentHistory,
            implementer,
            reviewer,
            lastQaVerdict,
          );
          usedFallback = true;
        }
      } else {
        recommendation = buildFallbackRecommendation(
          agentHistory,
          implementer,
          reviewer,
          lastQaVerdict,
        );
        usedFallback = true;
      }

      // Log planner decision
      await deps.appendDecision(state.decisionsDir, {
        ts: new Date().toISOString(),
        action: usedFallback ? "planner_fallback" : "planner_consulted",
        taskId: planTask.id,
        rationale: recommendation.recommendation.rationale,
        agentId: recommendation.recommendation.agentId,
        outcome: `action=${recommendation.recommendation.action}`,
      });

      let action = recommendation.recommendation.action;

      await eventBus.emit({
        type: "decision:made",
        ts: new Date().toISOString(),
        runId: state.runId,
        action: `${usedFallback ? "fallback" : "planner"}: ${action}${recommendation.recommendation.agentId ? ` → ${recommendation.recommendation.agentId}` : ""}`,
        taskId: planTask.id,
        rationale: recommendation.recommendation.rationale,
      });

      // Route by action

      if (action === "skip_task") {
        taskState.status = "passed";
        await deps.saveRunState(statePath, state);
        return { success: true };
      }

      if (action === "block_task") {
        return {
          success: false,
          failureCategory: "task_blocked",
          failureDetails:
            recommendation.recommendation.rationale || "Blocked by planner",
        };
      }

      if (action === "retry_task") {
        // If no write agent has run in this attempt yet, convert retry_task
        // to dispatch_agent so we don't waste the attempt without running anyone.
        const hasWriteRun = agentHistory.some((a) => {
          try {
            return getAgent(a).capabilities.includes("write");
          } catch {
            return false;
          }
        });
        if (!hasWriteRun && recommendation.recommendation.agentId) {
          // Treat as dispatch_agent — fall through to the dispatch logic below
          action = "dispatch_agent";
        } else {
          shouldRetry = true;
          lastFailure =
            recommendation.recommendation.rationale ||
            "Planner requested retry";
          break;
        }
      }

      if (action === "task_complete") {
        const commitResult = await commitChanges(
          {
            rootDir,
            state,
            statePath,
            phase,
            planTask,
            runtime,
            eventBus,
            previousOutputs,
            stepSequence,
            attempt,
            maxAttempts,
            qaCycles,
            implementer,
            model: params.model,
            streamOutput: params.streamOutput,
            timeout: params.timeout,
          },
          deps,
        );
        if (commitResult.success) {
          return { success: true, commitHash: commitResult.commitHash };
        }
        lastFailure = commitResult.error ?? "Commit failed";
        taskState.lastError = lastFailure;
        await deps.saveRunState(statePath, state);
        continue;
      }

      // action === "dispatch_agent"
      const agentId = recommendation.recommendation.agentId;
      if (!agentId) {
        lastFailure = "Planner recommended dispatch_agent but no agentId";
        continue;
      }

      // Guard: verify agent exists before dispatching
      if (!hasAgent(agentId)) {
        lastFailure = `Planner recommended non-existent agent "${agentId}"`;
        await eventBus.emit({
          type: "log:warn",
          ts: new Date().toISOString(),
          runId: state.runId,
          source: "orchestrator",
          message: lastFailure,
        });
        continue;
      }

      // Cycle detection
      agentHistory.push(agentId);
      if (detectAgentCycle(agentHistory)) {
        lastFailure = `Agent cycle detected: ${agentHistory.slice(-6).join(" → ")}`;
        await deps.appendDecision(state.decisionsDir, {
          ts: new Date().toISOString(),
          action: "task_blocked",
          taskId: planTask.id,
          rationale: lastFailure,
        });
        await eventBus.emit({
          type: "log:warn",
          ts: new Date().toISOString(),
          runId: state.runId,
          source: "orchestrator",
          message: lastFailure,
        });
        break;
      }

      // Inject planner context into agent peer progress
      const agentPeerProgress = new Map<string, string>();
      if (recommendation.recommendation.agentContext) {
        agentPeerProgress.set(
          "plannerContext",
          recommendation.recommendation.agentContext,
        );
      }
      if (recommendation.recommendation.scope?.length) {
        agentPeerProgress.set(
          "plannerScope",
          recommendation.recommendation.scope.join("\n"),
        );
      }

      // Run the agent (wrapped in try/catch to prevent orchestrator crash)
      const agent = getAgent(agentId);
      const agentInput: AgentInput = {
        task: planTask,
        phase,
        planPath: getSourcesPlanPath(state.sourcesDir),
        tasksPath: getSourcesTasksPath(state.sourcesDir),
        previousOutputs,
        peerProgress: agentPeerProgress,
        previousFailedAttempts: failedAttempts,
        failureContext: lastFailure || undefined,
        agentContext: recommendation.recommendation.agentContext,
        attempt,
        maxAttempts,
      };

      let output: AgentOutput;
      try {
        output = await deps.runAgent({
          agent,
          input: agentInput,
          runtime,
          state,
          stepSequence,
          eventBus,
          model: params.model,
          streamOutput: params.streamOutput,
          timeout: params.timeout,
        });
      } catch (runError) {
        const category: FailureCategory = "runtime_crash";
        lastFailure = `${agentId} crashed: ${runError instanceof Error ? runError.message : String(runError)}`;

        // Guide retry agents to discover partial work via git
        const crashedAgent = getAgent(agentId);
        if (crashedAgent.capabilities.includes("write")) {
          const partialFiles = await deps
            .listChangedFiles(rootDir)
            .catch(() => []);
          if (partialFiles.length > 0) {
            lastFailure += `\nPartial changes detected in working tree (${partialFiles.length} files). The next agent should run \`git diff\` to understand what was already implemented and continue from there.`;
          }
        }

        taskState.lastError = lastFailure;
        await deps.saveRunState(statePath, state);
        await eventBus.emit({
          type: "log:error",
          ts: new Date().toISOString(),
          runId: state.runId,
          source: "orchestrator",
          message: lastFailure,
        });
        continue;
      }

      // Handle agent failure
      if (output.exitCode !== 0) {
        const category: FailureCategory = "runtime_crash";
        const strategy = getRecoveryStrategy(category, attempt);
        lastFailure = `${agentId} failed with code ${output.exitCode}`;

        // Guide retry agents to discover partial work via git
        const failedAgent = getAgent(agentId);
        if (failedAgent.capabilities.includes("write")) {
          const partialFiles = await deps
            .listChangedFiles(rootDir)
            .catch(() => []);
          if (partialFiles.length > 0) {
            lastFailure += `\nPartial changes detected in working tree (${partialFiles.length} files). The next agent should run \`git diff\` to understand what was already implemented and continue from there.`;
          }
        }
        taskState.lastError = lastFailure;
        taskState.lastExitCode = output.exitCode;
        await deps.saveRunState(statePath, state);

        await eventBus.emit({
          type: "log:error",
          ts: new Date().toISOString(),
          runId: state.runId,
          source: "orchestrator",
          message: `${lastFailure}, recovery: ${strategy}`,
        });

        await deps.appendDecision(state.decisionsDir, {
          ts: new Date().toISOString(),
          action: "dispatch_agent",
          agentId,
          taskId: planTask.id,
          outcome: `failed (exit ${output.exitCode}), strategy: ${strategy}`,
        });

        if (strategy === "block_and_handoff") {
          return {
            success: false,
            failureCategory: category,
            failureDetails: lastFailure,
          };
        }
        if (strategy === "escalate_to_em") {
          const emOutput = await escalateToEM(
            {
              state,
              phase,
              planTask,
              runtime,
              eventBus,
              failureContext: lastFailure,
              stepSequence,
              model: params.model,
              streamOutput: params.streamOutput,
              timeout: params.timeout,
            },
            deps,
          );
          if (emOutput?.raw) {
            lastFailure = `${lastFailure}\n\nEM recommendation: ${emOutput.raw}`;
          }
        }
        // All other strategies (planner_decides) — let planner re-evaluate
        continue;
      }

      previousOutputs.push(output);

      // POST-AGENT INVARIANTS

      // After write agents: check changed files + quality gates
      const agentDef = getAgent(agentId);
      if (agentDef.capabilities.includes("write") && !params.skipQualityGates) {
        const writeChangedFiles = await deps.listChangedFiles(rootDir);

        if (writeChangedFiles.length === 0) {
          const category: FailureCategory = "agent_no_changes";
          lastFailure = `No repository changes detected after ${agentId}`;
          taskState.lastError = lastFailure;
          await deps.saveRunState(statePath, state);

          await deps.appendDecision(state.decisionsDir, {
            ts: new Date().toISOString(),
            action: "dispatch_agent",
            agentId,
            taskId: planTask.id,
            outcome: `no_changes`,
          });

          await eventBus.emit({
            type: "log:warn",
            ts: new Date().toISOString(),
            runId: state.runId,
            source: "orchestrator",
            message: `No changes after ${agentId} — re-evaluating`,
          });
          // Let planner re-evaluate
          continue;
        }

        taskState.changedFiles = writeChangedFiles;

        const gateCheck = await runQualityGateCheck(
          {
            rootDir,
            state,
            phase,
            planTask,
            attempt,
            stepSequence,
            streamOutput: params.streamOutput,
            eventBus,
          },
          deps,
        );

        if (!gateCheck.passed) {
          lastFailure = gateCheck.failureDetails ?? "Quality gate failed";
          taskState.lastError = lastFailure;
          taskState.lastQualityGate = gateCheck.failedStep;
          await deps.saveRunState(statePath, state);

          await deps.appendDecision(state.decisionsDir, {
            ts: new Date().toISOString(),
            action: "retry",
            taskId: planTask.id,
            outcome: `gate ${gateCheck.failedStep} failed, strategy: ${gateCheck.strategy}`,
          });

          if (gateCheck.strategy === "block_and_handoff") {
            return {
              success: false,
              failureCategory: gateCheck.category,
              failureDetails: lastFailure,
            };
          }
          // Let planner decide how to fix
          continue;
        }
      }

      // After QA agent: parse verdict and handle
      if (agentId === reviewer || agentId === "qa-engineer") {
        qaCycles++;
        taskState.qaCycles = qaCycles;

        let decision: { status: VerifierStatus; notes: string[] };
        try {
          decision = parseVerifierDecision(output.raw);
        } catch {
          lastFailure = `Invalid QA output: ${output.raw.slice(0, 200)}`;
          continue;
        }

        await deps.appendDecision(state.decisionsDir, {
          ts: new Date().toISOString(),
          action: "qa_verdict",
          taskId: planTask.id,
          verdict: decision.status,
          notes: decision.notes,
        });

        await eventBus.emit({
          type: "decision:made",
          ts: new Date().toISOString(),
          runId: state.runId,
          action: "qa_verdict",
          taskId: planTask.id,
          verdict: decision.status,
        });

        await eventBus.emit({
          type: "log:info",
          ts: new Date().toISOString(),
          runId: state.runId,
          source: "orchestrator",
          message: `QA verdict for ${planTask.id}: ${decision.status} (cycle ${qaCycles}/${MAX_QA_CYCLES})`,
        });

        lastQaVerdict = decision.status;

        if (decision.status === "DONE") {
          const commitResult = await commitChanges(
            {
              rootDir,
              state,
              statePath,
              phase,
              planTask,
              runtime,
              eventBus,
              previousOutputs,
              stepSequence,
              attempt,
              maxAttempts,
              qaCycles,
              implementer,
              model: params.model,
              streamOutput: params.streamOutput,
              timeout: params.timeout,
            },
            deps,
          );
          if (commitResult.success) {
            return { success: true, commitHash: commitResult.commitHash };
          }
          lastFailure = commitResult.error ?? "Commit failed";
          taskState.lastError = lastFailure;
          await deps.saveRunState(statePath, state);
          continue;
        }

        if (qaCycles >= MAX_QA_CYCLES) {
          lastFailure = `QA cycles exhausted (${MAX_QA_CYCLES}) without approval`;
          taskState.status = "failed";
          taskState.lastError = lastFailure;
          await deps.saveRunState(statePath, state);

          await eventBus.emit({
            type: "task:failed",
            ts: new Date().toISOString(),
            runId: state.runId,
            taskId: planTask.id,
            phaseId: phase.id,
            failureDetails: lastFailure,
          });
          break;
        }

        // Track failed attempt for context
        const currentDiff = await deps.stagedDiff(rootDir).catch(() => "");
        failedAttempts.push({
          agentId: reviewer,
          diff: truncateText(currentDiff, 3000),
          qaNotes: decision.notes,
          cycle: qaCycles,
        });

        // Let planner decide next fix agent
        continue;
      }
    }

    if (shouldRetry) {
      continue;
    }

    // If we broke out of the planner loop without returning, the task failed this attempt
    if (plannerSteps >= MAX_PLANNER_STEPS) {
      lastFailure = `Planner step limit reached (${MAX_PLANNER_STEPS})`;
    }
    taskState.lastError = lastFailure;
    taskState.status = "failed";
    await deps.saveRunState(statePath, state);

    await eventBus.emit({
      type: "task:failed",
      ts: new Date().toISOString(),
      runId: state.runId,
      taskId: planTask.id,
      phaseId: phase.id,
      failureDetails: lastFailure,
    });
  }

  // All attempts exhausted
  return {
    success: false,
    failureCategory: "task_blocked",
    failureDetails: lastFailure || "All retry attempts exhausted",
  };
}
