#!/usr/bin/env bun
import { parseCliOptions } from "./parse-options";
import { startCommand } from "./commands/start";
import { resumeCommand } from "./commands/resume";
import { attachCommand } from "./commands/attach";
import { stopCommand } from "./commands/stop";
import { statusCommand } from "./commands/status";
import { listCommand } from "./commands/list";

export { parseCliOptions } from "./parse-options";

async function main(): Promise<void> {
  const options = parseCliOptions(Bun.argv.slice(2));

  switch (options.command) {
    case "start":
      await startCommand(options);
      break;
    case "resume":
      await resumeCommand(options);
      break;
    case "attach":
      await attachCommand(options);
      break;
    case "stop":
      await stopCommand(options);
      break;
    case "status":
      await statusCommand(options);
      break;
    case "list":
      await listCommand(options);
      break;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
