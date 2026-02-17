import { readFile } from "node:fs/promises";
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
