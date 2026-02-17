import { registerAgent, hasAgent } from "./registry";
import { softwareDeveloper } from "./built-in/software-developer";
import { qaEngineer } from "./built-in/qa-engineer";
import { engineeringManager } from "./built-in/engineering-manager";
import { productManager } from "./built-in/product-manager";
import { productDesigner } from "./built-in/product-designer";
import { orchestratorPlanner } from "./mini/orchestrator-planner";
import { commitGenerator } from "./mini/commit-generator";
import { codeReviewer } from "./mini/code-reviewer";
import { refactorer } from "./mini/refactorer";
import { bugFixer } from "./mini/bug-fixer";
import { docUpdater } from "./mini/doc-updater";

const defaultAgents = [
  softwareDeveloper,
  qaEngineer,
  engineeringManager,
  productManager,
  productDesigner,
  orchestratorPlanner,
  commitGenerator,
  codeReviewer,
  refactorer,
  bugFixer,
  docUpdater,
];

export function registerDefaultAgents(): void {
  for (const agent of defaultAgents) {
    if (!hasAgent(agent.id)) {
      registerAgent(agent);
    }
  }
}
