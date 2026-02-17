import type { RuntimeProvider } from "../runtime/provider";
import type { EventBus } from "../monitor/event-bus";
import type {
  AgentInput,
  AgentOutput,
  Decision,
  FailedAttempt,
  FailureCategory,
  PlanPhase,
  PlanTask,
  RunState,
  TasksDocument,
} from "../state/types";
import type { TeamConfig } from "../config/types";
import { getAgent } from "../agents/registry";
import { runAgent } from "../agents/agent-runner";
import { appendDecision } from "./decision-log";
import { findNextTask, isRunBlocked, isRunFinished } from "./scheduler";
import {
  getSourcesPlanPath,
  getSourcesTasksPath,
  markTaskDoneInSources,
} from "./planner";
import { getPhaseState, getTaskState } from "../state/selectors";
import { saveRunState } from "../state/run-state";
import { runQualityGates } from "../runtime/quality-gates";
import { buildStepArtifacts } from "../state/artifacts";
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
import { getRecoveryStrategy, type RecoveryStrategy } from "../errors/recovery";
import { categorizeQualityGateFailure } from "../errors/categories";

const MAX_QA_CYCLES = 5;

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

function resolveAgentIds(teamConfig?: TeamConfig): {
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
};

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

  for (const phase of document.phases) {
    const phaseState = getPhaseState(state, phase.id);
    if (phaseState.status === "completed") continue;

    phaseState.status = "in_progress";
    await deps.saveRunState(statePath, state);

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

interface TaskFlowResult {
  success: boolean;
  commitHash?: string;
  failureCategory?: FailureCategory;
  failureDetails?: string;
}

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
): Promise<void> {
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
  } catch (err) {
    console.error("EM escalation failed (best-effort):", err);
  }
}

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

    let stepSequence = 0;
    const previousOutputs: AgentOutput[] = [];
    const failedAttempts: FailedAttempt[] = [];

    // Step 1: Implementer agent
    stepSequence += 1;
    const devInput: AgentInput = {
      task: planTask,
      phase,
      planPath: getSourcesPlanPath(state.sourcesDir),
      tasksPath: getSourcesTasksPath(state.sourcesDir),
      previousOutputs,
      peerProgress: new Map(),
      previousFailedAttempts: failedAttempts,
      failureContext: lastFailure || undefined,
      attempt,
      maxAttempts,
    };

    const devAgent = getAgent(implementer);
    const devOutput = await deps.runAgent({
      agent: devAgent,
      input: devInput,
      runtime,
      state,
      stepSequence,
      eventBus,
      model: params.model,
      streamOutput: params.streamOutput,
      timeout: params.timeout,
    });

    if (devOutput.exitCode !== 0) {
      const category: FailureCategory = "runtime_crash";
      const strategy = getRecoveryStrategy(category, attempt);
      lastFailure = `${implementer} failed with code ${devOutput.exitCode}`;
      taskState.lastError = lastFailure;
      taskState.lastExitCode = devOutput.exitCode;
      await deps.saveRunState(statePath, state);

      await deps.appendDecision(state.decisionsDir, {
        ts: new Date().toISOString(),
        action: "dispatch_agent",
        agentId: implementer,
        taskId: planTask.id,
        outcome: `failed (exit ${devOutput.exitCode}), strategy: ${strategy}`,
      });

      if (strategy === "block_and_handoff") {
        return {
          success: false,
          failureCategory: category,
          failureDetails: lastFailure,
        };
      }
      if (strategy === "escalate_to_em") {
        await escalateToEM(
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
      }
      continue;
    }

    previousOutputs.push(devOutput);

    // Check for changed files
    const changedFiles = await deps.listChangedFiles(rootDir);
    if (changedFiles.length === 0) {
      const category: FailureCategory = "agent_no_changes";
      const strategy = getRecoveryStrategy(category, attempt);
      lastFailure = `No repository changes detected after ${implementer}`;
      taskState.lastError = lastFailure;
      await deps.saveRunState(statePath, state);

      await deps.appendDecision(state.decisionsDir, {
        ts: new Date().toISOString(),
        action: "dispatch_agent",
        agentId: implementer,
        taskId: planTask.id,
        outcome: `no_changes, strategy: ${strategy}`,
      });

      if (strategy === "block_and_handoff") {
        return {
          success: false,
          failureCategory: category,
          failureDetails: lastFailure,
        };
      }
      if (strategy === "escalate_to_em") {
        await escalateToEM(
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
      }
      continue;
    }

    // Step 2: Quality gates
    if (!params.skipQualityGates) {
      const artifacts = buildStepArtifacts({
        state,
        phaseId: phase.id,
        taskId: planTask.id,
        attempt,
        stepSequence,
        agent: "quality-gates",
      });

      await eventBus.emit({
        type: "quality-gate:running",
        ts: new Date().toISOString(),
        runId: state.runId,
      });

      const gateResult = await deps.runQualityGates({
        rootDir,
        logPath: artifacts.logPath,
        streamOutput: params.streamOutput,
      });

      if (!gateResult.passed) {
        const gateCategory = categorizeQualityGateFailure(
          gateResult.failedStep ?? "unknown",
        );
        const gateStrategy = getRecoveryStrategy(gateCategory, attempt);
        lastFailure = gateResult.details;
        taskState.lastError = lastFailure;
        taskState.lastQualityGate = gateResult.failedStep;
        await deps.saveRunState(statePath, state);

        await eventBus.emit({
          type: "quality-gate:failed",
          ts: new Date().toISOString(),
          runId: state.runId,
          gate: gateResult.failedStep,
          details: gateResult.details,
        });

        await deps.appendDecision(state.decisionsDir, {
          ts: new Date().toISOString(),
          action: "retry",
          taskId: planTask.id,
          outcome: `gate ${gateResult.failedStep} failed, strategy: ${gateStrategy}`,
        });

        if (gateStrategy === "block_and_handoff") {
          return {
            success: false,
            failureCategory: gateCategory,
            failureDetails: lastFailure,
          };
        }
        if (gateStrategy === "auto_fix_retry") {
          // Dispatch refactorer with gate failure context
          stepSequence += 1;
          const autoFixAgent = getAgent("refactorer");
          const autoFixInput: AgentInput = {
            task: planTask,
            phase,
            planPath: getSourcesPlanPath(state.sourcesDir),
            tasksPath: getSourcesTasksPath(state.sourcesDir),
            previousOutputs,
            peerProgress: new Map([
              ["gateFailure", gateResult.details],
              ["failedStep", gateResult.failedStep ?? "unknown"],
            ]),
            previousFailedAttempts: [],
            failureContext: `Quality gate "${gateResult.failedStep}" failed: ${gateResult.details}`,
            attempt,
            maxAttempts,
          };
          await deps.runAgent({
            agent: autoFixAgent,
            input: autoFixInput,
            runtime,
            state,
            stepSequence,
            eventBus,
            model: params.model,
            streamOutput: params.streamOutput,
            timeout: params.timeout,
          });
        }
        if (gateStrategy === "escalate_to_em") {
          await escalateToEM(
            {
              state,
              phase,
              planTask,
              runtime,
              eventBus,
              failureContext: `Quality gate "${gateResult.failedStep}" failed: ${gateResult.details}`,
              stepSequence,
              model: params.model,
              streamOutput: params.streamOutput,
              timeout: params.timeout,
            },
            deps,
          );
        }
        continue;
      }

      await eventBus.emit({
        type: "quality-gate:passed",
        ts: new Date().toISOString(),
        runId: state.runId,
      });
    }

    // Step 3: QA verification loop
    let qaCycle = 0;
    let qaVerdict: "DONE" | "REFACTOR" | "ISSUES" = "ISSUES";

    while (qaCycle < MAX_QA_CYCLES) {
      qaCycle += 1;
      taskState.qaCycles = qaCycle;
      stepSequence += 1;

      const qaAgent = getAgent(reviewer);
      const qaInput: AgentInput = {
        task: planTask,
        phase,
        planPath: getSourcesPlanPath(state.sourcesDir),
        tasksPath: getSourcesTasksPath(state.sourcesDir),
        previousOutputs,
        peerProgress: new Map(),
        previousFailedAttempts: failedAttempts,
        attempt: qaCycle,
        maxAttempts: MAX_QA_CYCLES,
      };

      const qaOutput = await deps.runAgent({
        agent: qaAgent,
        input: qaInput,
        runtime,
        state,
        stepSequence,
        eventBus,
        model: params.model,
        streamOutput: params.streamOutput,
        timeout: params.timeout,
      });

      if (qaOutput.exitCode !== 0) {
        const qaCategory: FailureCategory = "runtime_crash";
        const qaStrategy = getRecoveryStrategy(qaCategory, attempt);
        lastFailure = `${reviewer} failed with code ${qaOutput.exitCode}`;

        await deps.appendDecision(state.decisionsDir, {
          ts: new Date().toISOString(),
          action: "dispatch_agent",
          agentId: reviewer,
          taskId: planTask.id,
          outcome: `failed (exit ${qaOutput.exitCode}), strategy: ${qaStrategy}`,
        });

        if (qaStrategy === "escalate_to_em") {
          await escalateToEM(
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
        }
        break;
      }

      let decision: { status: "DONE" | "REFACTOR" | "ISSUES"; notes: string[] };
      try {
        decision = parseVerifierDecision(qaOutput.raw);
      } catch {
        lastFailure = `Invalid QA output: ${qaOutput.raw.slice(0, 200)}`;
        break;
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

      qaVerdict = decision.status;
      previousOutputs.push(qaOutput);

      if (decision.status === "DONE") break;

      // Get the diff before fix agent for failed attempts tracking
      const currentDiff = await deps.stagedDiff(rootDir).catch(() => "");

      // Dispatch refactorer or bug-fixer
      const fixAgentId =
        decision.status === "REFACTOR" ? "refactorer" : "bug-fixer";
      stepSequence += 1;

      const fixAgent = getAgent(fixAgentId);
      const fixInput: AgentInput = {
        task: planTask,
        phase,
        planPath: getSourcesPlanPath(state.sourcesDir),
        tasksPath: getSourcesTasksPath(state.sourcesDir),
        previousOutputs,
        peerProgress: new Map(),
        previousFailedAttempts: failedAttempts,
        attempt: qaCycle,
        maxAttempts: MAX_QA_CYCLES,
      };

      const fixOutput = await deps.runAgent({
        agent: fixAgent,
        input: fixInput,
        runtime,
        state,
        stepSequence,
        eventBus,
        model: params.model,
        streamOutput: params.streamOutput,
        timeout: params.timeout,
      });

      if (fixOutput.exitCode !== 0) {
        const fixCategory: FailureCategory = "runtime_crash";
        const fixStrategy = getRecoveryStrategy(fixCategory, attempt);
        lastFailure = `${fixAgentId} failed with code ${fixOutput.exitCode}`;

        await deps.appendDecision(state.decisionsDir, {
          ts: new Date().toISOString(),
          action: "dispatch_agent",
          agentId: fixAgentId,
          taskId: planTask.id,
          outcome: `failed (exit ${fixOutput.exitCode}), strategy: ${fixStrategy}`,
        });

        if (fixStrategy === "escalate_to_em") {
          await escalateToEM(
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
        }
        break;
      }

      failedAttempts.push({
        agentId: fixAgentId,
        diff: truncateText(currentDiff, 3000),
        qaNotes: decision.notes,
        cycle: qaCycle,
      });

      previousOutputs.push(fixOutput);

      // Run quality gates again after fix
      if (!params.skipQualityGates) {
        const fixArtifacts = buildStepArtifacts({
          state,
          phaseId: phase.id,
          taskId: planTask.id,
          attempt,
          stepSequence,
          agent: "quality-gates",
        });

        const fixGateResult = await deps.runQualityGates({
          rootDir,
          logPath: fixArtifacts.logPath,
          streamOutput: params.streamOutput,
        });

        if (!fixGateResult.passed) {
          lastFailure = fixGateResult.details;
          break;
        }
      }
    }

    if (qaVerdict === "DONE") {
      // Commit the changes
      try {
        const allChanged = await deps.listChangedFiles(rootDir);
        await deps.stageAll(rootDir);
        const diffStat = await deps.stagedDiffStat(rootDir);
        const diffPatch = truncateText(await deps.stagedDiff(rootDir), 12000);

        // Use commit-generator mini agent
        const commitAgent = getAgent("commit-generator");
        stepSequence += 1;
        const commitInput: AgentInput = {
          task: planTask,
          phase,
          planPath: getSourcesPlanPath(state.sourcesDir),
          tasksPath: getSourcesTasksPath(state.sourcesDir),
          previousOutputs,
          peerProgress: new Map([
            ["diffStat", diffStat],
            ["diffPatch", diffPatch],
            ["changedFiles", allChanged.join("\n")],
          ]),
          previousFailedAttempts: [],
          attempt,
          maxAttempts,
        };

        const commitOutput = await deps.runAgent({
          agent: commitAgent,
          input: commitInput,
          runtime,
          state,
          stepSequence,
          eventBus,
          model: params.model,
          streamOutput: params.streamOutput,
          timeout: params.timeout,
        });

        let commitMessage: { subject: string; body: string };
        try {
          commitMessage = parseConventionalCommit(commitOutput.raw);
        } catch {
          commitMessage = {
            subject: `feat(task): ${planTask.title}`,
            body: "",
          };
        }

        await deps.commitStaged(
          commitMessage.subject,
          commitMessage.body,
          rootDir,
        );
        const hash = await deps.headCommit(rootDir);

        taskState.status = "passed";
        taskState.lastCommit = hash;
        taskState.changedFiles = allChanged;
        await deps.saveRunState(statePath, state);
        await markTaskDoneInSources(state.sourcesDir, planTask.id);

        await deps.appendDecision(state.decisionsDir, {
          ts: new Date().toISOString(),
          action: "task_complete",
          taskId: planTask.id,
          commit: hash,
        });

        await eventBus.emit({
          type: "task:completed",
          ts: new Date().toISOString(),
          runId: state.runId,
          taskId: planTask.id,
          phaseId: phase.id,
          commitHash: hash,
        });

        // Write progress file
        await deps.writeProgressFile({
          progressDir: state.progressDir,
          taskId: planTask.id,
          agentId: implementer,
          content: [
            `# Agent Progress: ${implementer}`,
            `## Task: ${planTask.id} (${planTask.title})`,
            "",
            `### What Was Done`,
            `- Implemented task per requirements`,
            "",
            `### Files Changed`,
            allChanged.map((f) => `- ${f}`).join("\n"),
            "",
            `### QA Cycles: ${qaCycle}`,
            `### Commit: ${hash}`,
          ].join("\n"),
        });

        return { success: true, commitHash: hash };
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
        taskState.lastError = lastFailure;
        await deps.saveRunState(statePath, state);
        continue;
      }
    }

    // QA loop exhausted without DONE
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
  }

  // All attempts exhausted
  return {
    success: false,
    failureCategory: "task_blocked",
    failureDetails: lastFailure || "All retry attempts exhausted",
  };
}
