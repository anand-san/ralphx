import { readFile } from "node:fs/promises";
import type {
  RuntimeProvider,
  RuntimeExecuteParams,
  RuntimeExecuteResult,
} from "../provider";
import { runProcess } from "../process";
import { appendLog } from "../log";

async function readOutputFileOrFallback(
  outputPath: string,
  fallback: string,
): Promise<string> {
  try {
    return await readFile(outputPath, "utf8");
  } catch {
    return fallback;
  }
}

export class CodexProvider implements RuntimeProvider {
  name = "codex" as const;

  async execute(params: RuntimeExecuteParams): Promise<RuntimeExecuteResult> {
    const startTime = Date.now();

    const args = ["exec", "--full-auto", "-o", params.outputPath];

    if (params.model) {
      args.push("-m", params.model);
    }
    if (params.sandbox) {
      args.push("-s", params.sandbox);
    }
    if (params.outputSchema) {
      args.push("--output-schema", JSON.stringify(params.outputSchema));
    }
    args.push("-");

    const result = await runProcess({
      cmd: ["codex", ...args],
      cwd: params.rootDir,
      stdin: params.prompt,
      streamOutput: params.streamOutput,
      timeout: params.timeout,
    });

    const output = await readOutputFileOrFallback(
      params.outputPath,
      result.stdout,
    );

    const durationMs = Date.now() - startTime;

    await appendLog(
      params.logPath,
      "Codex Execution",
      [
        `Command: codex ${args.join(" ")}`,
        `Duration: ${durationMs}ms`,
        "",
        "OUTPUT:",
        output || "(empty)",
        "",
        "STDOUT:",
        result.stdout || "(empty)",
        "",
        "STDERR:",
        result.stderr || "(empty)",
        "",
        `Exit Code: ${result.exitCode}`,
      ].join("\n"),
    );

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      output,
      durationMs,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await runProcess({
        cmd: ["codex", "--version"],
        cwd: process.cwd(),
        timeout: 5000,
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }
}
