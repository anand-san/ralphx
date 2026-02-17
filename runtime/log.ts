import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function appendLog(
  logPath: string,
  title: string,
  body: string,
): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  const content = [
    "",
    `### ${new Date().toISOString()} ${title}`,
    "",
    body.trimEnd(),
    "",
  ].join("\n");
  await appendFile(logPath, content, "utf8");
}
