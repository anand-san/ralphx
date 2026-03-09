import type {
  RuntimeProvider,
  RuntimeExecuteParams,
  RuntimeExecuteResult,
} from "../provider";
import { runProcess } from "../process";
import { appendLog } from "../log";

/**
 * Extract structured output from Claude Code JSON response.
 * When using --output-format json, Claude Code returns a JSON response
 * with a `structured_output` field containing the schema-validated data.
 */
function extractStructuredOutput(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      result?: string;
      structured_output?: unknown;
    };
    if (parsed.structured_output !== undefined) {
      return typeof parsed.structured_output === "string"
        ? parsed.structured_output
        : JSON.stringify(parsed.structured_output);
    }
    if (parsed.result !== undefined) {
      return parsed.result;
    }
  } catch {
    // Not JSON, return as-is
  }
  return raw;
}

export class ClaudeCodeProvider implements RuntimeProvider {
  name = "claude-code" as const;

  async execute(params: RuntimeExecuteParams): Promise<RuntimeExecuteResult> {
    const startTime = Date.now();

    const args = ["--print", "--dangerously-skip-permissions"];

    if (params.model) {
      args.push("--model", params.model);
    }

    if (params.outputSchema) {
      args.push(
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(params.outputSchema),
      );
    }

    const result = await runProcess({
      cmd: ["claude", ...args],
      cwd: params.rootDir,
      stdin: params.prompt,
      streamOutput: params.streamOutput,
      onOutput: params.onOutput,
      onSpawn: params.onSpawn,
      onHeartbeat: params.onHeartbeat,
      timeout: params.timeout,
    });

    let output: string;
    if (params.outputSchema) {
      output = extractStructuredOutput(result.stdout);
    } else {
      output = result.stdout;
    }

    const durationMs = Date.now() - startTime;

    await appendLog(
      params.logPath,
      "Claude Code Execution",
      [
        `Command: claude ${args.join(" ")}`,
        `Duration: ${durationMs}ms`,
        "",
        "OUTPUT:",
        output || "(empty)",
        "",
        "STDOUT:",
        result.stdout.slice(0, 2000) || "(empty)",
        "",
        "STDERR:",
        result.stderr.slice(0, 2000) || "(empty)",
        "",
        `Exit Code: ${result.exitCode}`,
      ].join("\n"),
    );

    return {
      pid: result.pid,
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
        cmd: ["claude", "--version"],
        cwd: process.cwd(),
        timeout: 5000,
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }
}
