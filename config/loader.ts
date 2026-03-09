import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { teamConfigSchema } from "./schema";
import { DEFAULT_TEAM } from "./defaults";
import type { TeamConfig } from "./types";

export async function loadTeamConfig(teamPath?: string): Promise<TeamConfig> {
  if (!teamPath) {
    return DEFAULT_TEAM;
  }

  const raw = await readFile(teamPath, "utf8");
  const json = JSON.parse(raw) as unknown;
  return teamConfigSchema.parse(json);
}

export async function loadOptionalTeamConfig(
  teamPath?: string,
): Promise<TeamConfig | undefined> {
  if (!teamPath) {
    return undefined;
  }

  const raw = await readFile(teamPath, "utf8");
  const json = JSON.parse(raw) as unknown;
  return teamConfigSchema.parse(json);
}

export function getSourcesTeamConfigPath(sourcesDir: string): string {
  return join(sourcesDir, "team.json");
}

export async function hasTeamConfig(teamPath: string): Promise<boolean> {
  try {
    await access(teamPath);
    return true;
  } catch {
    return false;
  }
}
