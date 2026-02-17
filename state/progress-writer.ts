import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildProgressPath } from "./artifacts";

export async function writeProgressFile(params: {
  progressDir: string;
  taskId: string;
  agentId: string;
  content: string;
}): Promise<void> {
  const path = buildProgressPath(
    params.progressDir,
    params.taskId,
    params.agentId,
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, params.content, "utf8");
}

export async function readProgressFile(params: {
  progressDir: string;
  taskId: string;
  agentId: string;
}): Promise<string | null> {
  const path = buildProgressPath(
    params.progressDir,
    params.taskId,
    params.agentId,
  );
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function readAllProgressForTask(params: {
  progressDir: string;
  taskId: string;
  agentIds: string[];
}): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const agentId of params.agentIds) {
    const content = await readProgressFile({
      progressDir: params.progressDir,
      taskId: params.taskId,
      agentId,
    });
    if (content) {
      result.set(agentId, content);
    }
  }
  return result;
}
