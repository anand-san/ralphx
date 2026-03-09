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
}

export interface TeamConfig {
  name: string;
  defaultRuntime?: RuntimeName;
  roles: TeamRoleConfig[];
}
