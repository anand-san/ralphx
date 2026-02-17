import type { AgentCapability, AgentInput, SandboxMode } from "../state/types";

export interface AgentDefinition {
  id: string;
  name: string;
  capabilities: AgentCapability[];
  defaultSandbox: SandboxMode;
  buildPrompt(input: AgentInput): string;
  parseOutput?(raw: string): unknown;
}
