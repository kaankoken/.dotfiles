import {
  DEFAULT_GOAL,
  HARNESS_COMMAND_NAME,
  bindGoal,
} from "./constants";
import { buildStartMessage } from "../../workflows/goal-harness";

export { DEFAULT_GOAL, bindGoal, HARNESS_COMMAND_NAME };
export {
  validateReviewResult,
  validateImplementerEvidence,
} from "./validation";
export { reviewResultSchema, implementerEvidenceSchema } from "./schemas";
export { buildStartMessage } from "../../workflows/goal-harness";
export type { HarnessStartMessage } from "../../workflows/goal-harness";

/** Minimal ExtensionAPI surface used by this extension (OMP runtime). */
export type ExtensionAPI = {
  registerCommand: (name: string, opts: Record<string, unknown>) => void;
  sendMessage?: (
    text: string,
    opts?: { triggerTurn?: boolean },
  ) => void | Promise<void>;
};

export type HarnessHandlerResult = {
  boundGoal: string;
  /** Controller/policy context — separate from boundGoal. */
  controllerPolicy: string;
  /** Exactly one internal start message to queue. */
  startMessages: Array<{
    workflowModule: string;
    boundGoal: string;
    controllerPolicy: string;
  }>;
};

/**
 * Pure handler logic (testable without OMP runtime).
 * Extension load remains side-effect free — no model calls here.
 */
export function handleHarnessCommand(args: string): HarnessHandlerResult {
  const boundGoal = bindGoal(args);
  const msg = buildStartMessage(boundGoal);
  return {
    boundGoal: msg.boundGoal,
    controllerPolicy: msg.controllerPolicy,
    startMessages: [
      {
        workflowModule: msg.workflowModule,
        boundGoal: msg.boundGoal,
        controllerPolicy: msg.controllerPolicy,
      },
    ],
  };
}

/** Register only `/harness`. Must not register goal/guided-goal/init. */
export function registerHarnessCommand(api: ExtensionAPI): void {
  api.registerCommand(HARNESS_COMMAND_NAME, {
    description:
      "OMP goal harness. Empty args → default 7 quality goals; otherwise exact override.",
    handler: async (ctx: { args?: string }) => {
      const result = handleHarnessCommand(ctx.args ?? "");
      // After preflight, queue exactly one start message (triggerTurn) if supported.
      if (api.sendMessage) {
        const payload = JSON.stringify({
          kind: "goal-harness-start",
          ...result.startMessages[0],
        });
        await api.sendMessage(payload, { triggerTurn: true });
      }
      return result;
    },
  });
}

/** Extension load: register commands only — no model resolution or network. */
export default async function (api: ExtensionAPI) {
  registerHarnessCommand(api);
}
