import type { AgentDefinition } from "./base-agent";

const agents = new Map<string, AgentDefinition>();

export function registerAgent(agent: AgentDefinition): void {
  if (agents.has(agent.id)) {
    throw new Error(`Agent "${agent.id}" is already registered`);
  }
  agents.set(agent.id, agent);
}

export function getAgent(id: string): AgentDefinition {
  const agent = agents.get(id);
  if (!agent) {
    throw new Error(
      `Agent "${id}" not found. Available: ${[...agents.keys()].join(", ")}`,
    );
  }
  return agent;
}

export function listAgents(): AgentDefinition[] {
  return [...agents.values()];
}

export function hasAgent(id: string): boolean {
  return agents.has(id);
}

export function clearRegistry(): void {
  agents.clear();
}
