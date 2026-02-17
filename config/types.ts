import type { RuntimeName, SandboxMode } from "../state/types";

export interface TeamRoleConfig {
  id: string;
  name: string;
  sandbox: SandboxMode;
  permissions: {
    canWrite: boolean;
    canExecute: boolean;
    canCommit: boolean;
  };
  promptTemplate?: string;
}

export interface WorkflowPhaseConfig {
  agents: string[];
  strategy: "sequential" | "parallel";
}

export interface WorkflowConfig {
  type: "sequential" | "custom";
  phases: WorkflowPhaseConfig[];
}

export interface TeamConfig {
  name: string;
  defaultRuntime?: RuntimeName;
  roles: TeamRoleConfig[];
  workflow?: WorkflowConfig;
}
