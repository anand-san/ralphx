import { mkdir, readFile, writeFile, copyFile, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { RunState, RuntimeName, TasksDocument } from "./types";
import { runStateSchema } from "../config/schema";

function isoNow(): string {
  return new Date().toISOString();
}

function makeTimestampId(): string {
  const now = new Date();
  const yyyy = now.getFullYear().toString();
  const mm = (now.getMonth() + 1).toString().padStart(2, "0");
  const dd = now.getDate().toString().padStart(2, "0");
  const hh = now.getHours().toString().padStart(2, "0");
  const min = now.getMinutes().toString().padStart(2, "0");
  const sec = now.getSeconds().toString().padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${sec}`;
}

export function buildRunId(): string {
  return makeTimestampId();
}

const RALPHX_DIR = ".ralphx";

export function getRalphxDir(rootDir: string): string {
  return resolve(rootDir, RALPHX_DIR);
}

export function buildRunPaths(rootDir: string, runId: string) {
  const runDir = resolve(rootDir, RALPHX_DIR, runId);
  return {
    runDir,
    sourcesDir: join(runDir, "sources"),
    decisionsDir: join(runDir, "decisions"),
    progressDir: join(runDir, "progress"),
    logDir: join(runDir, "logs"),
    messageDir: join(runDir, "messages"),
    handoffPath: join(runDir, "HANDOFF.md"),
    eventsPath: join(runDir, "events.jsonl"),
    statePath: join(runDir, "state.json"),
    pidPath: join(runDir, "daemon.pid"),
  };
}

export async function ensureRunDirectories(state: RunState): Promise<void> {
  await mkdir(state.runDir, { recursive: true });
  await mkdir(state.sourcesDir, { recursive: true });
  await mkdir(state.decisionsDir, { recursive: true });
  await mkdir(state.progressDir, { recursive: true });
  await mkdir(state.logDir, { recursive: true });
  await mkdir(state.messageDir, { recursive: true });
}

export async function copySourceFiles(params: {
  sourcesDir: string;
  planPath: string;
  tasksPath: string;
  teamPath?: string;
}): Promise<void> {
  await copyFile(params.planPath, join(params.sourcesDir, "PLAN.md"));
  await copyFile(params.tasksPath, join(params.sourcesDir, "tasks.json"));
  if (params.teamPath) {
    await copyFile(params.teamPath, join(params.sourcesDir, "team.json"));
  }
}

export function createInitialRunState(params: {
  runId: string;
  branch: string;
  retryLimit: number;
  defaultRuntime: RuntimeName;
  teamConfigPath?: string;
  paths: ReturnType<typeof buildRunPaths>;
  tasksDocument: TasksDocument;
}): RunState {
  const phases: RunState["phases"] = params.tasksDocument.phases.map(
    (phase) => {
      const status = phase.tasks.every((task) => task.status === "done")
        ? ("completed" as const)
        : ("pending" as const);
      return { id: phase.id, name: phase.name, status };
    },
  );

  const tasks: RunState["tasks"] = params.tasksDocument.phases.flatMap(
    (phase) =>
      phase.tasks.map((task) => ({
        id: task.id,
        phaseId: phase.id,
        title: task.title,
        status:
          task.status === "done" ? ("passed" as const) : ("pending" as const),
        attempts: 0,
        changedFiles: [],
        qaCycles: 0,
      })),
  );

  const now = isoNow();
  return {
    schemaVersion: 2,
    runId: params.runId,
    createdAt: now,
    updatedAt: now,
    status: "running",
    branch: params.branch,
    retryLimit: params.retryLimit,
    defaultRuntime: params.defaultRuntime,
    teamConfigPath: params.teamConfigPath,
    runDir: params.paths.runDir,
    sourcesDir: params.paths.sourcesDir,
    decisionsDir: params.paths.decisionsDir,
    progressDir: params.paths.progressDir,
    logDir: params.paths.logDir,
    messageDir: params.paths.messageDir,
    handoffPath: params.paths.handoffPath,
    eventsPath: params.paths.eventsPath,
    phases,
    tasks,
    agents: [],
  };
}

export async function saveRunState(
  path: string,
  state: RunState,
): Promise<void> {
  state.updatedAt = isoNow();
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

export async function loadRunState(path: string): Promise<RunState> {
  const raw = await readFile(path, "utf8");
  const json = JSON.parse(raw) as unknown;
  return runStateSchema.parse(json);
}
