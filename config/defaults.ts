import type { TeamConfig } from "./types";

export const DEFAULT_TEAM: TeamConfig = {
  name: "default-engineering-team",
  defaultRuntime: "claude-code",
  roles: [
    {
      id: "engineering-manager",
      name: "Engineering Manager",
      sandbox: "read-only",
      permissions: { canWrite: false, canExecute: false, canCommit: false },
    },
    {
      id: "product-manager",
      name: "Product Manager",
      sandbox: "read-only",
      permissions: { canWrite: false, canExecute: false, canCommit: false },
    },
    {
      id: "product-designer",
      name: "Product Designer",
      sandbox: "read-only",
      permissions: { canWrite: false, canExecute: false, canCommit: false },
    },
    {
      id: "software-developer",
      name: "Software Developer",
      sandbox: "workspace-write",
      permissions: { canWrite: true, canExecute: true, canCommit: false },
    },
    {
      id: "qa-engineer",
      name: "QA Engineer",
      sandbox: "read-only",
      permissions: { canWrite: false, canExecute: false, canCommit: false },
    },
  ],
  workflow: {
    type: "sequential",
    phases: [
      { agents: ["product-manager"], strategy: "sequential" },
      { agents: ["software-developer"], strategy: "sequential" },
      { agents: ["qa-engineer"], strategy: "sequential" },
    ],
  },
};
