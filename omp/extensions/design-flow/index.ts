/**
 * OMP extension entry for /design.
 * Named exports stay library API; default export is the required factory.
 */

import {
  bindDesignGoal,
  buildDesignStartMessage,
  type DesignStartMessage,
} from "../../workflows/design-flow";

export {
  ADR_DIR,
  AdrPathError,
  adrAbsolutePath,
  adrRelativePath,
  assertAllowedAdrWritePath,
  formatAdrId,
  nextAdrNumber,
  renderAdrMarkdown,
  slugifyTitle,
} from "./adr-paths";
export {
  DESIGN_GATE_BUDGETS,
  DESIGN_PHASE_ORDER,
  applyDesignTransition,
  createInitialDesignSnapshot,
  type DesignGateName,
  type DesignPhaseName,
  type DesignSnapshot,
  type DesignTransition,
} from "./phase-machine";
export {
  resolveDesignModels,
  runDesignFlow,
  type DesignHandoff,
  type DesignModels,
  type RunDesignFlowResult,
} from "./workflow";
export {
  persistDesignArtifactsBestEffort,
  type BdRunner,
} from "./persist";
export {
  bindDesignGoal,
  buildDesignStartMessage,
  type DesignStartMessage,
};
/** Minimal ExtensionAPI surface used by this extension (OMP runtime). */
export type DesignExtensionAPI = {
  registerCommand: (name: string, opts: Record<string, unknown>) => void;
  sendMessage?: (
    text: string,
    opts?: { triggerTurn?: boolean; deliverAs?: string },
  ) => void | Promise<void>;
};

function record(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null
    ? (v as Record<string, unknown>)
    : {};
}

/** Extract `/design` args from OMP command handler shapes. */
export function extractDesignArgs(
  first: unknown,
  second?: unknown,
): string {
  if (typeof first === "string") return first;
  const a = record(first).args;
  if (typeof a === "string") return a;
  const b = record(second).args;
  if (typeof b === "string") return b;
  return "";
}

export function registerDesignCommand(api: DesignExtensionAPI): void {
  api.registerCommand("design", {
    description:
      "Pre-harness design only: PDR → Arc42 → ADR. Never auto-starts /harness. Bound args = design goal.",
    handler: async (first: unknown, second?: unknown) => {
      const args = extractDesignArgs(first, second).trim();
      if (!args) {
        // Empty shell: ask once via start message with empty goal marker.
        const empty = buildDesignStartMessage("");
        if (api.sendMessage) {
          await api.sendMessage(JSON.stringify(empty), { triggerTurn: true });
        }
        return { ...empty, askedForGoal: true };
      }
      const start = buildDesignStartMessage(args);
      if (api.sendMessage) {
        await api.sendMessage(JSON.stringify(start), { triggerTurn: true });
      }
      return { boundGoal: start.boundGoal, start };
    },
  });
}

/** Extension load: register `/design` only — no model resolution or network. */
export default async function designFlowExtension(
  api: DesignExtensionAPI,
): Promise<void> {
  registerDesignCommand(api);
}
