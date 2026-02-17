import type { SandboxMode } from "../state/types";

/**
 * v1: All agents run in full-auto/YOLO mode.
 * This module provides the interface for future permission hardening (v2).
 */

export function resolveSandbox(
  agentDefault: SandboxMode,
  override?: SandboxMode,
): SandboxMode {
  return override ?? agentDefault;
}

export function isWriteAllowed(sandbox: SandboxMode): boolean {
  return sandbox === "workspace-write" || sandbox === "danger-full-access";
}

export function isExecuteAllowed(sandbox: SandboxMode): boolean {
  return sandbox === "danger-full-access";
}
