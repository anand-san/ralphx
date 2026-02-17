import type { SandboxMode } from "../state/types";

export interface RuntimeExecuteParams {
  rootDir: string;
  prompt: string;
  logPath: string;
  outputPath: string;
  model?: string;
  sandbox?: SandboxMode;
  timeout?: number;
  streamOutput?: boolean;
  outputSchema?: object;
}

export interface RuntimeExecuteResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
  durationMs: number;
}

export interface RuntimeProvider {
  name: string;
  execute(params: RuntimeExecuteParams): Promise<RuntimeExecuteResult>;
  isAvailable(): Promise<boolean>;
}
