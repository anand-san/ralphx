import { appendLog } from "./log";
import { runProcess } from "./process";

export interface QualityGateStep {
  name: string;
  cmd: string[];
  cwd: string;
}

export interface QualityGateResult {
  passed: boolean;
  failedStep?: string;
  details: string;
}

export async function runQualityGates(params: {
  rootDir: string;
  logPath: string;
  streamOutput: boolean;
  steps?: QualityGateStep[];
}): Promise<QualityGateResult> {
  const steps = params.steps ?? [];

  await appendLog(
    params.logPath,
    "Quality Gate Discovery",
    steps.length > 0
      ? `Running ${steps.length} gate(s): ${steps.map((s) => s.name).join(", ")}`
      : "No quality gate steps configured; skipping gates.",
  );

  for (const step of steps) {
    const result = await runProcess({
      cmd: step.cmd,
      cwd: step.cwd,
      streamOutput: params.streamOutput,
      timeout: 180_000,
    });

    await appendLog(
      params.logPath,
      `Quality Gate: ${step.name}`,
      [
        `CWD: ${step.cwd}`,
        `Command: ${step.cmd.join(" ")}`,
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

    if (result.exitCode !== 0) {
      return {
        passed: false,
        failedStep: step.name,
        details: `${step.name} failed with exit code ${result.exitCode}`,
      };
    }
  }

  return { passed: true, details: "all checks passed" };
}
