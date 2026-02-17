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

/**
 * Default quality gate steps. Override by passing custom steps to runQualityGates.
 * Each step runs sequentially; execution stops on first failure.
 */
export function defaultQualityGateSteps(rootDir: string): QualityGateStep[] {
  return [
    { name: "format", cmd: ["bun", "run", "format"], cwd: rootDir },
    { name: "lint", cmd: ["bun", "run", "lint"], cwd: rootDir },
    { name: "check-types", cmd: ["bun", "run", "check-types"], cwd: rootDir },
    { name: "test", cmd: ["bun", "run", "test"], cwd: rootDir },
  ];
}

export async function runQualityGates(params: {
  rootDir: string;
  logPath: string;
  streamOutput: boolean;
  steps?: QualityGateStep[];
}): Promise<QualityGateResult> {
  const steps = params.steps ?? defaultQualityGateSteps(params.rootDir);

  for (const step of steps) {
    const result = await runProcess({
      cmd: step.cmd,
      cwd: step.cwd,
      streamOutput: params.streamOutput,
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
