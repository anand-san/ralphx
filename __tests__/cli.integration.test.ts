import { afterEach, describe, expect, it } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI_PATH = resolve(import.meta.dir, "..", "cli", "index.ts");
const TEMP_DIRS: string[] = [];

const PLAN_CONTENT = `# Integration Fixture Plan

This plan exists to exercise RalphX end-to-end through the real CLI.

## Goals

- Create concrete repository changes for each task.
- Run at least one real quality gate command.
- Persist run artifacts, decisions, and events.
`;

const TASKS_DOCUMENT = {
  idea: "Exercise RalphX through a full fake-runtime integration test",
  generatedAt: "2026-03-09T10:00:00.000Z",
  repo: "fixture-repo",
  phases: [
    {
      id: "phase-1",
      name: "Foundation",
      goal: "Complete the first integration task",
      exitCriteria: ["Task 1 committed"],
      tasks: [
        {
          id: "task-001",
          status: "todo",
          title: "Implement the first integration artifact",
          description: "Append task-001 to src/integration-log.txt",
          notes: ["Keep the repo runnable after the change."],
        },
      ],
    },
    {
      id: "phase-2",
      name: "Follow-up",
      goal: "Complete the second integration task",
      exitCriteria: ["Task 2 committed"],
      tasks: [
        {
          id: "task-002",
          status: "todo",
          title: "Implement the second integration artifact",
          description: "Append task-002 to src/integration-log.txt",
          notes: ["Leave a clean working tree after the run."],
        },
      ],
    },
  ],
};

const TEAM_DOCUMENT = {
  name: "integration-team",
  defaultRuntime: "codex",
  roles: [
    {
      id: "software-developer",
      name: "Software Developer",
      sandbox: "workspace-write",
      permissions: {
        canWrite: true,
        canExecute: true,
        canCommit: false,
      },
    },
    {
      id: "qa-engineer",
      name: "QA Engineer",
      sandbox: "read-only",
      permissions: {
        canWrite: false,
        canExecute: false,
        canCommit: false,
      },
    },
  ],
};

afterEach(async () => {
  for (const dir of TEMP_DIRS.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function runCommand(
  cmd: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

function expectOk(
  result: { exitCode: number; stdout: string; stderr: string },
  context: string,
): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `${context} failed (${result.exitCode})\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
}

function buildFakeCodexScript(logPath: string): string {
  return `#!${process.execPath}
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function detectAgent(prompt) {
  if (prompt.includes("You are a build-system analyst")) {
    return "quality-gate-discoverer";
  }
  if (prompt.includes("You are the orchestrator planner")) {
    return "orchestrator-planner";
  }
  if (prompt.includes("You are a senior software developer")) {
    return "software-developer";
  }
  if (prompt.includes("You are a strict QA engineer")) {
    return "qa-engineer";
  }
  if (prompt.includes("Generate a conventional commit message as strict JSON.")) {
    return "commit-generator";
  }
  return "unknown";
}

function getTaskId(prompt) {
  const xmlMatch = prompt.match(/<current_task>[\\s\\S]*?<id>([^<]+)<\\/id>/);
  if (xmlMatch?.[1]) {
    return xmlMatch[1].trim();
  }
  const plannerMatch = prompt.match(/^- ID: ([^\\n]+)/m);
  if (plannerMatch?.[1]) {
    return plannerMatch[1].trim();
  }
  return "task-unknown";
}

function plannerOutput(taskId, prompt) {
  if (prompt.includes("DEV completed: no")) {
    return JSON.stringify({
      contextBriefing: \`Dispatch developer for \${taskId}\`,
      recommendation: {
        action: "dispatch_agent",
        agentId: "software-developer",
        taskId,
        rationale: \`Implement \${taskId}\`,
      },
      warnings: [],
    });
  }

  if (prompt.includes("DEV completed: yes")) {
    return JSON.stringify({
      contextBriefing: \`Dispatch QA for \${taskId}\`,
      recommendation: {
        action: "dispatch_agent",
        agentId: "qa-engineer",
        taskId,
        rationale: \`Review \${taskId}\`,
      },
      warnings: [],
    });
  }

  return JSON.stringify({
    contextBriefing: \`Complete \${taskId}\`,
    recommendation: {
      action: "task_complete",
      taskId,
      rationale: \`Task \${taskId} is ready to commit\`,
    },
    warnings: [],
  });
}

const args = process.argv.slice(2);

if (args.length === 1 && args[0] === "--version") {
  console.log("codex-test 0.0.0");
  process.exit(0);
}

let outputPath = "";
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "-o" && args[i + 1]) {
    outputPath = args[i + 1];
  }
}

const prompt = await new Response(Bun.stdin.stream()).text();
const agent = detectAgent(prompt);
const taskId = getTaskId(prompt);

await appendFile(
  ${JSON.stringify(logPath)},
  JSON.stringify({ agent, taskId, cwd: process.cwd() }) + "\\n",
  "utf8",
);

let output = "ok";

if (agent === "quality-gate-discoverer") {
  output = JSON.stringify({
    steps: [
      {
        name: "test",
        cmd: ["/bin/sh", "-c", "printf integration-quality-gate"],
      },
    ],
  });
} else if (agent === "orchestrator-planner") {
  output = plannerOutput(taskId, prompt);
} else if (agent === "software-developer") {
  const srcDir = join(process.cwd(), "src");
  await mkdir(srcDir, { recursive: true });
  const filePath = join(srcDir, "integration-log.txt");
  await appendFile(filePath, taskId + "\\n", "utf8");
  output = [
    \`Implemented \${taskId}\`,
    "<summary>",
    \`Updated src/integration-log.txt for \${taskId}\`,
    "</summary>",
  ].join("\\n");
} else if (agent === "qa-engineer") {
  output = JSON.stringify({ status: "DONE", notes: [] });
} else if (agent === "commit-generator") {
  output = JSON.stringify({
    subject: "feat(integration): record fixture progress",
    body: "",
  });
}

if (outputPath) {
  await writeFile(outputPath, output, "utf8");
} else {
  process.stdout.write(output);
}
`;
}

async function writeFakeCodexExecutable(
  repoDir: string,
): Promise<{ binDir: string; logPath: string }> {
  const binDir = join(repoDir, "bin");
  const logPath = join(repoDir, ".fake-codex-log.jsonl");
  const codexPath = join(binDir, "codex");

  await mkdir(binDir, { recursive: true });
  await writeFile(codexPath, buildFakeCodexScript(logPath), "utf8");
  await chmod(codexPath, 0o755);

  return { binDir, logPath };
}

async function createFixtureRepo(): Promise<{
  repoDir: string;
  binDir: string;
  fakeLogPath: string;
}> {
  const repoDir = await mkdtemp(join(tmpdir(), "ralphx-cli-int-"));
  TEMP_DIRS.push(repoDir);

  await writeFile(
    join(repoDir, ".gitignore"),
    ".ralphx/\n.fake-codex-log.jsonl\n",
    "utf8",
  );
  await writeFile(join(repoDir, "PLAN.md"), PLAN_CONTENT, "utf8");
  await writeFile(
    join(repoDir, "tasks.json"),
    `${JSON.stringify(TASKS_DOCUMENT, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(repoDir, "team.json"),
    `${JSON.stringify(TEAM_DOCUMENT, null, 2)}\n`,
    "utf8",
  );

  const { binDir, logPath } = await writeFakeCodexExecutable(repoDir);

  expectOk(await runCommand(["git", "init"], repoDir), "git init");
  expectOk(
    await runCommand(["git", "checkout", "-b", "main"], repoDir),
    "git checkout -b main",
  );
  expectOk(
    await runCommand(["git", "config", "user.name", "RalphX Test"], repoDir),
    "git config user.name",
  );
  expectOk(
    await runCommand(
      ["git", "config", "user.email", "ralphx@example.com"],
      repoDir,
    ),
    "git config user.email",
  );
  expectOk(await runCommand(["git", "add", "."], repoDir), "git add");
  expectOk(
    await runCommand(
      ["git", "commit", "-m", "chore(test): seed integration repo"],
      repoDir,
    ),
    "git commit",
  );

  return { repoDir, binDir, fakeLogPath: logPath };
}

async function runCli(
  repoDir: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return runCommand([process.execPath, CLI_PATH, ...args], repoDir, extraEnv);
}

async function getRunId(repoDir: string): Promise<string> {
  const entries = (await readdir(join(repoDir, ".ralphx"))).filter(
    (entry) => entry !== ".gitignore",
  );
  expect(entries).toHaveLength(1);
  return entries[0]!;
}

describe("CLI integration", () => {
  it("executes start --dry-run with realistic plan, tasks, and team inputs", async () => {
    const { repoDir } = await createFixtureRepo();

    const result = await runCli(repoDir, [
      "start",
      "--plan",
      "PLAN.md",
      "--tasks",
      "tasks.json",
      "--team",
      "team.json",
      "--dry-run",
    ]);

    expectOk(result, "ralphx start --dry-run");
    expect(result.stdout).toContain("phase-1 | Foundation");
    expect(result.stdout).toContain(
      "task-001 [todo] Implement the first integration artifact",
    );
    expect(result.stdout).toContain("phase-2 | Follow-up");

    expect(await Bun.file(join(repoDir, ".ralphx")).exists()).toBe(false);

    const branch = await runCommand(
      ["git", "branch", "--show-current"],
      repoDir,
    );
    expectOk(branch, "git branch --show-current");
    expect(branch.stdout.trim()).toBe("main");
  });

  it("runs a full real CLI flow with a fake codex runtime and persists run artifacts", async () => {
    const { repoDir, binDir, fakeLogPath } = await createFixtureRepo();
    const env = {
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    };

    const startResult = await runCli(
      repoDir,
      [
        "start",
        "--plan",
        "PLAN.md",
        "--tasks",
        "tasks.json",
        "--team",
        "team.json",
        "--no-tui",
      ],
      env,
    );

    expectOk(startResult, "ralphx start");
    expect(startResult.stdout).toContain("RalphX run ");
    expect(startResult.stdout).toContain("Runtime: codex");
    expect(startResult.stdout).toContain("finished with status: completed");

    const runId = await getRunId(repoDir);
    const runDir = join(repoDir, ".ralphx", runId);
    const state = JSON.parse(
      await readFile(join(runDir, "state.json"), "utf8"),
    ) as {
      status: string;
      branch: string;
      qualityGateSteps?: Array<{ name: string; cmd: string[] }>;
      phases: Array<{ id: string; status: string }>;
      tasks: Array<{
        id: string;
        status: string;
        lastCommit?: string;
      }>;
    };

    expect(state.status).toBe("completed");
    expect(state.branch).toBe(`ralphx/${runId}`);
    expect(state.phases.map((phase) => phase.status)).toEqual([
      "completed",
      "completed",
    ]);
    expect(state.tasks.map((task) => task.status)).toEqual([
      "passed",
      "passed",
    ]);
    expect(state.tasks.every((task) => !!task.lastCommit)).toBe(true);
    expect(state.qualityGateSteps).toEqual([
      {
        name: "test",
        cmd: ["/bin/sh", "-c", "printf integration-quality-gate"],
      },
    ]);

    const branch = await runCommand(
      ["git", "branch", "--show-current"],
      repoDir,
    );
    expectOk(branch, "git branch --show-current");
    expect(branch.stdout.trim()).toBe(`ralphx/${runId}`);

    const headSubject = await runCommand(
      ["git", "log", "-1", "--pretty=%s"],
      repoDir,
    );
    expectOk(headSubject, "git log -1 --pretty=%s");
    expect(headSubject.stdout.trim()).toBe(
      "feat(integration): record fixture progress",
    );

    const statusClean = await runCommand(
      ["git", "status", "--porcelain"],
      repoDir,
    );
    expectOk(statusClean, "git status --porcelain");
    expect(statusClean.stdout.trim()).toBe("");

    const integrationLog = await readFile(
      join(repoDir, "src", "integration-log.txt"),
      "utf8",
    );
    expect(integrationLog).toBe("task-001\ntask-002\n");

    const copiedPlan = await readFile(
      join(runDir, "sources", "PLAN.md"),
      "utf8",
    );
    expect(copiedPlan).toContain("Integration Fixture Plan");

    const copiedTasks = JSON.parse(
      await readFile(join(runDir, "sources", "tasks.json"), "utf8"),
    ) as typeof TASKS_DOCUMENT;
    expect(copiedTasks.phases[0]?.tasks[0]?.status).toBe("done");
    expect(copiedTasks.phases[1]?.tasks[0]?.status).toBe("done");

    const copiedTeam = JSON.parse(
      await readFile(join(runDir, "sources", "team.json"), "utf8"),
    ) as typeof TEAM_DOCUMENT;
    expect(copiedTeam.defaultRuntime).toBe("codex");

    const decisionLines = (
      await readFile(join(runDir, "decisions", "decisions.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { action: string; verdict?: string });
    expect(
      decisionLines.some((line) => line.action === "planner_consulted"),
    ).toBe(true);
    expect(decisionLines.some((line) => line.action === "qa_verdict")).toBe(
      true,
    );
    expect(decisionLines.some((line) => line.action === "task_complete")).toBe(
      true,
    );

    const eventTypes = (await readFile(join(runDir, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string })
      .map((event) => event.type);
    expect(eventTypes).toContain("run:started");
    expect(eventTypes).toContain("quality-gate:discovered");
    expect(eventTypes).toContain("task:completed");
    expect(eventTypes).toContain("run:completed");

    const fakeCodexCalls = (await readFile(fakeLogPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { agent: string })
      .map((entry) => entry.agent);
    expect(fakeCodexCalls).toEqual([
      "quality-gate-discoverer",
      "orchestrator-planner",
      "software-developer",
      "orchestrator-planner",
      "qa-engineer",
      "commit-generator",
      "orchestrator-planner",
      "software-developer",
      "orchestrator-planner",
      "qa-engineer",
      "commit-generator",
    ]);

    const statusResult = await runCli(repoDir, ["status", "--run", runId], env);
    expectOk(statusResult, "ralphx status");
    expect(statusResult.stdout).toContain(`Run: ${runId}`);
    expect(statusResult.stdout).toContain("Status: completed");
    expect(statusResult.stdout).toContain("Progress: 2/2 passed");

    const listResult = await runCli(repoDir, ["list"], env);
    expectOk(listResult, "ralphx list");
    expect(listResult.stdout).toContain("RalphX Runs:");
    expect(listResult.stdout).toContain(runId);
    expect(listResult.stdout).toContain("[completed]");
  });
});
