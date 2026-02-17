import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Decision } from "../state/types";

export async function appendDecision(
  decisionsDir: string,
  decision: Decision,
): Promise<void> {
  const filePath = join(decisionsDir, "decisions.jsonl");
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, JSON.stringify(decision) + "\n", "utf8");
}

export async function readDecisions(decisionsDir: string): Promise<Decision[]> {
  const filePath = join(decisionsDir, "decisions.jsonl");
  try {
    const content = await readFile(filePath, "utf8");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Decision);
  } catch {
    return [];
  }
}

export async function readRecentDecisions(
  decisionsDir: string,
  count: number,
): Promise<Decision[]> {
  const all = await readDecisions(decisionsDir);
  return all.slice(-count);
}
