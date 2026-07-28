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
import {
  assertGlobalShakeConfig,
  parseCompactionConfig,
  type CompactionConfig,
} from "./compaction";

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
  planGlobalShake,
  planSnapcompact,
  runGlobalShake,
  runSelectiveSnapcompact,
  phaseBoundaryCompact,
  assertGlobalShakeConfig,
  validateCompactModeArg,
  validateResumeSource,
  GLOBAL_STRATEGY,
} from "./compaction";
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

/**
 * OMP ExtensionCommandContext (subset). Official signature is
 * `handler(args: string, ctx: ExtensionCommandContext)` — NOT (ctx) alone.
 * @see oh-my-pi coding-agent agent-session `#tryExecuteExtensionCommand`
 */
export type HarnessCommandContext = {
  toolsConfig?: OmpToolsConfig;
  /** Some hosts may nest config; prefer top-level when present. */
  settings?: { tools?: OmpToolsConfig };
};

/** Extract slash args from OMP's (args, ctx) call shape (and legacy (ctx) mistakes). */
export function extractHarnessArgs(
  first: unknown,
  second?: unknown,
): string {
  // Canonical OMP: handler(args: string, ctx)
  if (typeof first === "string") return first;
  // Legacy mistaken shape we used: handler({ args })
  if (first && typeof first === "object" && "args" in first) {
    const a = (first as { args?: unknown }).args;
    if (typeof a === "string") return a;
  }
  if (second && typeof second === "object" && "args" in (second as object)) {
    const a = (second as { args?: unknown }).args;
    if (typeof a === "string") return a;
  }
  return "";
}

/** Register only `/harness`. Must not register goal/guided-goal/init. */
export function registerHarnessCommand(api: ExtensionAPI): void {
  api.registerCommand(HARNESS_COMMAND_NAME, {
    description:
      "Like /goal, but empty args bind the 8 default quality requirements; non-empty args bind that text exactly. Then runs Spec→Plan→… with dual reviews.",
    handler: async (first: unknown, second?: unknown) => {
      const args = extractHarnessArgs(first, second);
      const ctx =
        (typeof first === "object" && first !== null
          ? (first as HarnessCommandContext)
          : undefined) ??
        (typeof second === "object" && second !== null
          ? (second as HarnessCommandContext)
          : undefined);
      // Soft-sandbox preflight — refuse if approval mode incompatible
      const toolsConfig =
        ctx?.toolsConfig ??
        ctx?.settings?.tools ??
        ({ approvalMode: "always-ask", extensionGuard: true } as OmpToolsConfig);
      const pf = preflightHarnessSandbox(toolsConfig);
      if (!pf.ok) {
        throw new Error(`harness soft-sandbox preflight failed: ${pf.reason}`);
      }
      const result = handleHarnessCommand(args);
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

/**
 * Load compaction section from omp/config.yml (shake global).
 */
export function getHarnessCompactionConfig(): CompactionConfig {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const path = join(root, "config.yml");
  const text = readFileSync(path, "utf8");
  // Minimal YAML parse for compaction block without requiring yaml in runtime path of tests that mock —
  // prefer full parse when available via dynamic; here regex for lean keys.
  const enabled = /compaction:\s*\n(?:[^\n]*\n)*?\s*enabled:\s*(true|false)/.exec(
    text,
  );
  const strategy = /compaction:\s*\n(?:[^\n]*\n)*?\s*strategy:\s*(\S+)/.exec(
    text,
  );
  const cfg: CompactionConfig = {
    enabled: enabled ? enabled[1] === "true" : true,
    strategy: (strategy?.[1] ?? "shake") as CompactionConfig["strategy"],
  };
  // Also support adjacent keys order (enabled then strategy as in tree)
  if (!strategy) {
    const s2 = /strategy:\s*(shake|snapcompact|off|handoff|context-full)/.exec(
      text,
    );
    if (s2) cfg.strategy = s2[1] as CompactionConfig["strategy"];
  }
  return cfg;
}

/** Assert config contract at harness load / preflight. */
export function assertCompactionContract():
  | { ok: true; config: CompactionConfig }
  | { ok: false; reason: string } {
  try {
    const config = getHarnessCompactionConfig();
    assertGlobalShakeConfig(config);
    return { ok: true, config };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Extension load: register commands only — no model resolution or network. */
export default async function (api: ExtensionAPI) {
  const compaction = assertCompactionContract();
  if (!compaction.ok) {
    // Fail closed on misconfigured global strategy (do not start harness soft)
    throw new Error(`compaction contract: ${compaction.reason}`);
  }
  registerHarnessCommand(api);
}
