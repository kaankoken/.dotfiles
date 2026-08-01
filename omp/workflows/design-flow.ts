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
      "Parent skills: path-load using-superpowers, design-flow, brainstorming (cold skill:// only intent-router+beads).",
      "Phases: Intake → PDR (pdr-writer→pdr-reviewer) → Arc42 (arc42-writer→arc42-reviewer) → ADR (adr-writer JSON-only; controller writes docs/adr) → Handoff.",
      "Models via resolveModelRoute/resolveReviewerModel. PDR/Arc42: bd best-effort when issue available; session handoff always.",
      "Never write docs/superpowers or docs/plans. Never auto-start /harness. Design only — no code/worktrees/implementer.",
      "Writers path-load ~/.agents/skills/architect/SKILL.md when present (fail-open if missing); do not vendor skill bodies.",
    ].join(" "),
  };
}
