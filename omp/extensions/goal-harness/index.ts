import {
  DEFAULT_GOAL,
  HARNESS_COMMAND_NAME,
  bindGoal,
} from "./constants";

export { DEFAULT_GOAL, bindGoal, HARNESS_COMMAND_NAME };
export {
  validateReviewResult,
  validateImplementerEvidence,
} from "./validation";
export { reviewResultSchema, implementerEvidenceSchema } from "./schemas";

/** Minimal ExtensionAPI surface used by this extension (OMP runtime). */
export type ExtensionAPI = {
  registerCommand: (name: string, opts: Record<string, unknown>) => void;
};

/** Register only `/harness`. Must not register goal/guided-goal/init. */
export function registerHarnessCommand(api: ExtensionAPI): void {
  api.registerCommand(HARNESS_COMMAND_NAME, {
    description:
      "OMP goal harness. Empty args → default 7 quality goals; otherwise exact override.",
    handler: async (ctx: { args?: string }) => {
      const boundGoal = bindGoal(ctx.args ?? "");
      return {
        boundGoal,
        // Controller instructions / AGENTS policy stay separate fields (later phases).
      };
    },
  });
}

export default async function (api: ExtensionAPI) {
  registerHarnessCommand(api);
}
