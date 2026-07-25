import {
  DEFAULT_GOAL,
  HARNESS_COMMAND_NAME,
  bindGoal,
} from "./constants";
import { buildStartMessage } from "../../workflows/goal-harness";
import {
  runAssignedLane,
  type ActiveExtensionApi,
  type LaneAssignment,
} from "./lane-runner";
import {
  REQUIRED_SKILLS_BY_ROLE,
  validateRequiredSkillsMapping,
} from "./skills";
import { attestAndUnlock, type CreateGuardOpts } from "./skill-guard";
import { HARNESS_READ_SKILL_TOOL } from "./skill-tool";
import {
  createInterceptor,
  interceptToolCall,
  preflightOmpApprovalConfig,
  type BeadsAuditSink,
  type OmpToolsConfig,
  type ToolCallRequest,
} from "./audit";
import type { PhaseCapabilityManifest } from "./capabilities";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export { DEFAULT_GOAL, bindGoal, HARNESS_COMMAND_NAME };
export { REQUIRED_SKILLS_BY_ROLE, validateRequiredSkillsMapping } from "./skills";
export { attestAndUnlock, createSkillGuardSession } from "./skill-guard";
export { harnessReadSkill, HARNESS_READ_SKILL_TOOL } from "./skill-tool";
export { buildPhaseCapabilities, validatePhaseCapabilities } from "./capabilities";
export {
  preflightOmpApprovalConfig,
  interceptToolCall,
  createInterceptor,
} from "./audit";
export {
  validateReviewResult,
  validateImplementerEvidence,
} from "./validation";
export { reviewResultSchema, implementerEvidenceSchema } from "./schemas";
export { buildStartMessage } from "../../workflows/goal-harness";
export type { HarnessStartMessage } from "../../workflows/goal-harness";
export { runAssignedLane } from "./lane-runner";
export type { ActiveExtensionApi, LaneAssignment } from "./lane-runner";
export { IMPLEMENTER_EVIDENCE_SCHEMA } from "./evidence";

/** Minimal ExtensionAPI surface used by this extension (OMP runtime). */
export type ExtensionAPI = {
  registerCommand: (name: string, opts: Record<string, unknown>) => void;
  sendMessage?: (
    text: string,
    opts?: { triggerTurn?: boolean },
  ) => void | Promise<void>;
  /** Active OMP SDK (pi.createAgentSession) when host provides it. */
  pi?: ActiveExtensionApi["pi"];
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
    handler: async (ctx: {
      args?: string;
      toolsConfig?: OmpToolsConfig;
    }) => {
      // Soft-sandbox preflight — refuse if approval mode incompatible
      const pf = preflightHarnessSandbox(
        ctx.toolsConfig ?? { approvalMode: "always-ask", extensionGuard: true },
      );
      if (!pf.ok) {
        throw new Error(`harness soft-sandbox preflight failed: ${pf.reason}`);
      }
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

/**
 * Controller helper: run implementer in assigned worktree via active API.
 * Passes only the lane assignment — never a Beads write broker or worktree controller.
 */
export async function runLaneWithActiveApi(
  api: ExtensionAPI,
  assignment: LaneAssignment,
) {
  if (!api.pi?.createAgentSession || !api.pi?.SessionManager?.inMemory) {
    throw new Error(
      "active ExtensionAPI.pi.createAgentSession + SessionManager.inMemory required",
    );
  }
  const active: ActiveExtensionApi = { pi: api.pi };
  return runAssignedLane(active, assignment);
}

/**
 * Parent /harness entry: restrict to skill tool until attestation unlocks role tools.
 * Never vendors Superpowers bodies — live SKILL.md only.
 */
export function preflightParentSkills(
  skillRoots: string[],
  roleTools: string[] = ["bash", "read", "search", "agent"],
) {
  const mapping = validateRequiredSkillsMapping();
  if (!mapping.ok) {
    throw new Error(`REQUIRED_SKILLS_BY_ROLE invalid: ${mapping.reason}`);
  }
  return attestAndUnlock({
    role: "parent-orchestrator",
    skillRoots: { customDirectories: skillRoots },
    roleTools,
    restrictedTools: [HARNESS_READ_SKILL_TOOL.name, "read"],
  } satisfies CreateGuardOpts);
}

function loadCompatibilitySettings(): string[] {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
    const p = join(root, "compatibility.json");
    if (!existsSync(p)) return ["tools.approvalMode"];
    const j = JSON.parse(readFileSync(p, "utf8")) as { settings?: string[] };
    return j.settings ?? ["tools.approvalMode"];
  } catch {
    return ["tools.approvalMode"];
  }
}

/**
 * Refuse /harness if OMP approval keys are missing/permissive/incompatible.
 */
export function preflightHarnessSandbox(
  config: OmpToolsConfig,
): { ok: true } | { ok: false; reason: string } {
  return preflightOmpApprovalConfig(config, {
    settings: loadCompatibilitySettings(),
  });
}

/**
 * Fail-closed tool_call interceptor bound to current phase capability manifest.
 */
export function registerSandboxToolHandler(
  manifest: PhaseCapabilityManifest,
  sink?: BeadsAuditSink,
): (req: ToolCallRequest) => ReturnType<typeof interceptToolCall> {
  const state = createInterceptor(manifest, sink);
  return (req) => interceptToolCall(state, req);
}

/** Extension load: register commands only — no model resolution or network. */
export default async function (api: ExtensionAPI) {
  registerHarnessCommand(api);
}
