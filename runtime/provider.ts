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
  onOutput?: (line: string, stream: "stdout" | "stderr") => void;
  onSpawn?: (pid: number) => void;
  onHeartbeat?: () => void;
  outputSchema?: object;
}

export interface RuntimeExecuteResult {
  pid?: number;
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
