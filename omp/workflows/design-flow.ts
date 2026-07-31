/**
 * /design start message + re-export runDesignFlow for command handlers.
 */

import { runDesignFlow } from "../extensions/design-flow/workflow";

export { runDesignFlow };

export type DesignStartMessage = {
  kind: "design-flow-start";
  workflowModule: "omp/workflows/design-flow.ts";
  boundGoal: string;
  controllerPolicy: string;
};

export function bindDesignGoal(args: string): string {
  return args.trim();
}

export function buildDesignStartMessage(args: string): DesignStartMessage {
  const boundGoal = bindDesignGoal(args);
  return {
    kind: "design-flow-start",
    workflowModule: "omp/workflows/design-flow.ts",
    boundGoal,
    controllerPolicy: [
      "boundGoal is the only design task text. Do not invent a second goal.",
      "Parent skills: skill://using-superpowers then skill://design-flow then skill://brainstorming.",
      "Phases: Intake → PDR (pdr-writer→pdr-reviewer) → Arc42 (arc42-writer→arc42-reviewer) → ADR (adr-writer JSON-only; controller writes docs/adr) → Handoff.",
      "Models via resolveModelRoute/resolveReviewerModel. PDR/Arc42: bd best-effort when issue available; session handoff always.",
      "Never write docs/superpowers or docs/plans. Never auto-start /harness. Design only — no code/worktrees/implementer.",
      "Future architect skill: load when present; until then brainstorming only.",
    ].join(" "),
  };
}
