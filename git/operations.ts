import type { ProcessResult } from "../state/types";

async function runCommand(cmd: string[], cwd: string): Promise<ProcessResult> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

async function runGitOrThrow(
  args: string[],
  cwd: string,
): Promise<ProcessResult> {
  const result = await runCommand(["git", ...args], cwd);
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${result.exitCode})\n${result.stderr || result.stdout}`,
    );
  }
  return result;
}

export async function ensureGitRepo(cwd: string): Promise<void> {
  await runGitOrThrow(["rev-parse", "--is-inside-work-tree"], cwd);
}

export async function currentBranch(cwd: string): Promise<string> {
  const result = await runGitOrThrow(
    ["rev-parse", "--abbrev-ref", "HEAD"],
    cwd,
  );
  return result.stdout.trim();
}

export async function branchExists(
  branch: string,
  cwd: string,
): Promise<boolean> {
  const result = await runCommand(
    ["git", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    cwd,
  );
  return result.exitCode === 0;
}

export async function createBranch(branch: string, cwd: string): Promise<void> {
  await runGitOrThrow(["checkout", "-b", branch], cwd);
}

export async function checkoutBranch(
  branch: string,
  cwd: string,
): Promise<void> {
  await runGitOrThrow(["checkout", branch], cwd);
}

export async function statusPorcelain(cwd: string): Promise<string> {
  const result = await runGitOrThrow(["status", "--porcelain"], cwd);
  return result.stdout;
}

export async function hasChanges(cwd: string): Promise<boolean> {
  const output = await statusPorcelain(cwd);
  return output.trim().length > 0;
}

export async function ensureCleanWorkingTree(cwd: string): Promise<void> {
  const output = await statusPorcelain(cwd);
  if (output.trim().length > 0) {
    throw new Error(
      "Working tree is not clean. Commit/stash changes or use --allow-dirty.",
    );
  }
}

export function parseChangedFilesFromPorcelain(output: string): string[] {
  const lines = output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const files = new Set<string>();
  for (const line of lines) {
    const rawPath = line.slice(3).trim();
    const path = rawPath.includes(" -> ")
      ? (rawPath.split(" -> ").at(-1) ?? rawPath)
      : rawPath;
    files.add(path);
  }
  return [...files];
}

export async function listChangedFiles(cwd: string): Promise<string[]> {
  const output = await statusPorcelain(cwd);
  return parseChangedFilesFromPorcelain(output);
}

export async function stageAll(cwd: string): Promise<void> {
  await runGitOrThrow(["add", "-A"], cwd);
}

export async function stagedDiff(cwd: string): Promise<string> {
  const result = await runGitOrThrow(["diff", "--cached", "--no-color"], cwd);
  return result.stdout;
}

export async function stagedDiffStat(cwd: string): Promise<string> {
  const result = await runGitOrThrow(
    ["diff", "--cached", "--stat", "--no-color"],
    cwd,
  );
  return result.stdout;
}

export async function commitStaged(
  subject: string,
  body: string,
  cwd: string,
): Promise<void> {
  if (body.trim().length === 0) {
    await runGitOrThrow(["commit", "-m", subject], cwd);
    return;
  }
  await runGitOrThrow(["commit", "-m", subject, "-m", body], cwd);
}

export async function headCommit(cwd: string): Promise<string> {
  const result = await runGitOrThrow(["rev-parse", "HEAD"], cwd);
  return result.stdout.trim();
}

/**
 * Create a run-specific branch: ralphx/<run-id>
 * All task commits go to this single branch.
 */
export async function createRunBranch(
  runId: string,
  cwd: string,
): Promise<string> {
  const branchName = `ralphx/${runId}`;
  const exists = await branchExists(branchName, cwd);
  if (exists) {
    await checkoutBranch(branchName, cwd);
  } else {
    await createBranch(branchName, cwd);
  }
  return branchName;
}
