import { describe, expect, it } from "bun:test";
import { runProcess } from "../runtime/process";

describe("runProcess", () => {
  it("reports pid and activity callbacks", async () => {
    let observedPid: number | undefined;
    let heartbeats = 0;

    const result = await runProcess({
      cmd: ["/bin/sh", "-c", "printf 'hello'; sleep 0.01; printf ' world'"],
      cwd: process.cwd(),
      onSpawn: (pid) => {
        observedPid = pid;
      },
      onHeartbeat: () => {
        heartbeats += 1;
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello world");
    expect(result.pid).toBe(observedPid);
    expect(typeof observedPid).toBe("number");
    expect(heartbeats).toBeGreaterThan(0);
  });
});
