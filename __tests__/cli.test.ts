import { describe, expect, it } from "bun:test";
import { parseCliOptions } from "../cli/parse-options";

describe("parseCliOptions", () => {
  it("parses start with defaults", () => {
    const opts = parseCliOptions(["start"]);
    expect(opts.command).toBe("start");
    expect(opts.runtime).toBe("claude-code");
    expect(opts.retry).toBe(3);
    expect(opts.timeout).toBe(600000);
    expect(opts.heartbeatInterval).toBe(30000);
    expect(opts.concurrency).toBe(1);
    expect(opts.noTui).toBe(false);
    expect(opts.detached).toBe(false);
    expect(opts.skipQualityGates).toBe(false);
    expect(opts.allowDirty).toBe(false);
    expect(opts.dryRun).toBe(false);
  });

  it("parses start with all flags", () => {
    const opts = parseCliOptions([
      "start",
      "--plan",
      "my-plan.md",
      "--tasks",
      "my-tasks.json",
      "--runtime",
      "codex",
      "--team",
      "./team.json",
      "--retry",
      "5",
      "--timeout",
      "300000",
      "--heartbeat-interval",
      "10000",
      "--concurrency",
      "2",
      "--model",
      "gpt-4",
      "--no-tui",
      "--skip-quality-gates",
      "--allow-dirty",
      "--dry-run",
    ]);
    expect(opts.planPath).toBe("my-plan.md");
    expect(opts.tasksPath).toBe("my-tasks.json");
    expect(opts.runtime).toBe("codex");
    expect(opts.teamPath).toBe("./team.json");
    expect(opts.retry).toBe(5);
    expect(opts.timeout).toBe(300000);
    expect(opts.heartbeatInterval).toBe(10000);
    expect(opts.concurrency).toBe(2);
    expect(opts.model).toBe("gpt-4");
    expect(opts.noTui).toBe(true);
    expect(opts.skipQualityGates).toBe(true);
    expect(opts.allowDirty).toBe(true);
    expect(opts.dryRun).toBe(true);
  });

  it("parses resume with --run", () => {
    const opts = parseCliOptions(["resume", "--run", "20260101-120000"]);
    expect(opts.command).toBe("resume");
    expect(opts.runId).toBe("20260101-120000");
  });

  it("parses detached sets noTui", () => {
    const opts = parseCliOptions(["start", "--detached"]);
    expect(opts.detached).toBe(true);
    expect(opts.noTui).toBe(true);
  });

  it("throws on invalid command", () => {
    expect(() => parseCliOptions(["invalid"])).toThrow();
  });

  it("throws on invalid runtime", () => {
    expect(() => parseCliOptions(["start", "--runtime", "invalid"])).toThrow(
      "Invalid runtime",
    );
  });

  it("throws on missing value", () => {
    expect(() => parseCliOptions(["start", "--plan"])).toThrow("Missing value");
  });

  it("throws on unknown option", () => {
    expect(() => parseCliOptions(["start", "--unknown", "value"])).toThrow(
      "Unknown option",
    );
  });
});
