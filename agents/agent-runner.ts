import type { RuntimeProvider } from "../runtime/provider";
import type { EventBus } from "../monitor/event-bus";
import type { AgentDefinition } from "./base-agent";
import type {
  AgentInput,
  AgentOutput,
  AgentRuntimeState,
  RunState,
} from "../state/types";
import { buildStepArtifacts } from "../state/artifacts";

export interface AgentRunnerParams {
  agent: AgentDefinition;
  input: AgentInput;
  runtime: RuntimeProvider;
  state: RunState;
  stepSequence: number;
  eventBus: EventBus;
  model?: string;
  streamOutput?: boolean;
  timeout?: number;
}

export async function runAgent(
  params: AgentRunnerParams,
): Promise<AgentOutput> {
  const { agent, input, runtime, state, eventBus } = params;
  const prompt = agent.buildPrompt(input);

  const artifacts = buildStepArtifacts({
    state,
    phaseId: input.phase.id,
    taskId: input.task.id,
    attempt: input.attempt,
    stepSequence: params.stepSequence,
    agent: agent.id,
  });

  // Track agent in state.agents[]
  const agentEntry: AgentRuntimeState = {
    agentId: agent.id,
    taskId: input.task.id,
    phaseId: input.phase.id,
    runtime: runtime.name as AgentRuntimeState["runtime"],
    status: "running",
    startedAt: new Date().toISOString(),
  };
  const existingIdx = state.agents.findIndex((a) => a.agentId === agent.id);
  if (existingIdx >= 0) {
    state.agents[existingIdx] = agentEntry;
  } else {
    state.agents.push(agentEntry);
  }

  // Emit dispatch event
  await eventBus.emit({
    type: "agent:dispatched",
    ts: new Date().toISOString(),
    runId: state.runId,
    agentId: agent.id,
    taskId: input.task.id,
    phaseId: input.phase.id,
    message: `Dispatching ${agent.name} for ${input.task.id}`,
  });

  const result = await runtime.execute({
    rootDir: state.runDir.replace(/\/.ralphx\/.*$/, ""),
    prompt,
    logPath: artifacts.logPath,
    outputPath: artifacts.messagePath,
    model: params.model,
    sandbox: agent.defaultSandbox,
    timeout: params.timeout,
    streamOutput: params.streamOutput,
  });

  // Update agent entry in state.agents[]
  const completedEntry = state.agents.find((a) => a.agentId === agent.id);
  if (completedEntry) {
    completedEntry.status = result.exitCode === 0 ? "completed" : "failed";
    completedEntry.completedAt = new Date().toISOString();
    completedEntry.exitCode = result.exitCode;
  }

  // Emit completion event
  await eventBus.emit({
    type: "agent:completed",
    ts: new Date().toISOString(),
    runId: state.runId,
    agentId: agent.id,
    taskId: input.task.id,
    phaseId: input.phase.id,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
  });

  const output: AgentOutput = {
    agentId: agent.id,
    taskId: input.task.id,
    raw: result.output,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    changedFiles: [],
  };

  if (agent.parseOutput && result.output) {
    try {
      output.parsed = agent.parseOutput(result.output);
    } catch {
      // Parsing failure is handled by the caller
    }
  }

  return output;
}
