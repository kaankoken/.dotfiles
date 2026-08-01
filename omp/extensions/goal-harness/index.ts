import {
  DEFAULT_GOAL,
  HARNESS_COMMAND_NAME,
  bindGoal,
} from "./constants";
import {
  buildStartMessage,
  runGoalHarnessDetailed,
  type HarnessRunResult,
} from "../../workflows/goal-harness";
import {
  runAssignedLane,
  type ActiveExtensionApi,
  type ActivePiApi,
  type LaneAssignment,
} from "./lane-runner";
import { createWorkflowzFromPi } from "./omp-workflowz";
import {
  adapterFromOmpModels,
  resolveModelRoute,
  resolveReviewerModel,
  type ModelRouterAdapter,
  type ResolvedModel,
} from "./model-router";
import { createHumanGate } from "./human-gate";
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
export {
  createWorkflowzFromPi,
  loadAgentRolePrompt,
} from "./omp-workflowz";
export { REQUIRED_SKILLS_BY_ROLE, validateRequiredSkillsMapping } from "./skills";
export { attestAndUnlock, createSkillGuardSession } from "./skill-guard";
export { harnessReadSkill, HARNESS_READ_SKILL_TOOL } from "./skill-tool";
export {
  DOMAIN_PACKS,
  DOMAIN_COLD_START_FORBIDDEN_GLOBS,
  packsForStackMarker,
  entrySkillNamesForMarker,
  resolveEntrySkillPaths,
  listPackSkillNames,
  packOverlayIncludeGlobs,
} from "./domain-packs";
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
export {
  runAssignedLane,
  uniqueHarnessAgentId,
  unwrapAgentSession,
} from "./lane-runner";
export type {
  ActiveExtensionApi,
  AgentSession,
  CreateAgentSessionResult,
  LaneAssignment,
  SessionCreateOpts,
} from "./lane-runner";
export { IMPLEMENTER_EVIDENCE_SCHEMA } from "./evidence";
export {
  OMP_READ_DEFAULT_MAX_BYTES,
  DEFAULT_AGENT_CHUNK_LINES,
  agentUri,
  normalizeAgentOutputId,
  stripTruncationFooter,
  looksLikeIncompleteJson,
  readAgentTextFull,
  readAgentTextByRanges,
  readAgentJsonFull,
} from "./agent-output";
export type {
  AgentReadFn,
  AgentReadFileFn,
  ReadAgentTextOptions,
  TruncationInfo,
} from "./agent-output";
export {
  reviewRequiresRevision,
  formatRevisionFeedback,
} from "./gate-revision";
export type { ReviewLike } from "./gate-revision";

/** Minimal ExtensionAPI surface used by this extension (OMP runtime). */
export type ExtensionAPI = {
  registerCommand: (name: string, opts: Record<string, unknown>) => void;
  sendMessage?: (
    text: string,
    opts?: { triggerTurn?: boolean },
  ) => void | Promise<void>;
  /** Active OMP SDK (pi.createAgentSession) when host provides it. */
  pi?: ActivePiApi;
  /** Workspace cwd for hard orchestrator sessions. */
  cwd?: string;
  /** Optional live model catalog for model-router. */
  models?: {
    list: () => Array<{ id: string; provider?: string; name?: string }>;
    resolve?: (q: string) => { id: string; provider?: string } | null;
  };
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
  /** hard = Workflowz/pi ran; soft = start message only (no pi). */
  mode: "hard" | "soft";
  /** Present when mode=hard and run finished (or failed after start). */
  hardRun?: HarnessRunResult;
  hardError?: string;
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
    mode: "soft",
    startMessages: [
      {
        workflowModule: msg.workflowModule,
        boundGoal: msg.boundGoal,
        controllerPolicy: msg.controllerPolicy,
      },
    ],
  };
}

/** Fallback catalog when host does not inject models (still routes OpenAI last). */
export function defaultHarnessModelCatalog(): ModelRouterAdapter {
  const entries = [
    {
      id: "anthropic/claude-fable-5",
      provider: "anthropic",
      aliases: ["fable", "fable 5", "claude-fable-5"],
      available: true,
    },
    {
      id: "anthropic/claude-opus-5",
      provider: "anthropic",
      aliases: ["opus", "opus 5", "claude-opus-5", "claude-opus"],
      available: true,
    },
    {
      id: "anthropic/claude-sonnet-5",
      provider: "anthropic",
      aliases: ["sonnet", "sonnet 5", "claude-sonnet-5", "claude-sonnet"],
      available: true,
    },
    {
      id: "xai-oauth/grok-4.5",
      provider: "xai-oauth",
      aliases: ["grok", "grok 4.5", "grok-4.5"],
      available: true,
    },
    {
      id: "cursor/composer-2.5",
      provider: "cursor",
      aliases: ["composer", "composer 2.5"],
      available: true,
    },
    {
      id: "openai-codex/gpt-5.6-sol",
      provider: "openai-codex",
      aliases: ["sol", "sol 5.6", "gpt-5.6-sol"],
      available: true,
    },
    {
      id: "openai-codex/gpt-5.6-terra",
      provider: "openai-codex",
      aliases: ["terra", "gpt-5.6-terra", "5.6-terra"],
      available: true,
    },
  ];
  return {
    list: () => entries.filter((e) => e.available),
    resolve: (query: string) => {
      const q = query.toLowerCase();
      for (const e of entries) {
        if (!e.available) continue;
        if (e.id.toLowerCase() === q) return e;
        if (e.aliases.some((a) => a.toLowerCase() === q || a.toLowerCase().includes(q)))
          return e;
      }
      for (const e of entries) {
        if (e.available && e.id.toLowerCase().includes(q)) return e;
      }
      return null;
    },
  };
}

export function resolveHarnessModels(adapter: ModelRouterAdapter): {
  research: string;
  spec: string;
  specReviewer: string;
  plan: string;
  planReviewer: string;
  biteSize: string;
  resolved: Record<string, ResolvedModel>;
} {
  const research = resolveModelRoute(adapter, "research");
  const spec = resolveModelRoute(adapter, "spec");
  const specReviewer = resolveReviewerModel(adapter, spec);
  const plan = resolveModelRoute(adapter, "plan");
  const planReviewer = resolveReviewerModel(adapter, plan);
  const bite = resolveModelRoute(adapter, "bitesize");
  return {
    research: research.providerModelId,
    spec: spec.providerModelId,
    specReviewer: specReviewer.providerModelId,
    plan: plan.providerModelId,
    planReviewer: planReviewer.providerModelId,
    biteSize: bite.providerModelId,
    resolved: {
      research,
      spec,
      specReviewer,
      plan,
      planReviewer,
      biteSize: bite,
    },
  };
}

export type HardHarnessOpts = {
  boundGoal: string;
  pi: ActivePiApi;
  cwd: string;
  modelAdapter?: ModelRouterAdapter;
  /** When set, Spec waits for this human approval record path. */
  explicitSpecApproval?: {
    approved: boolean;
    actor: string;
    at: string;
    specHash: string;
  };
  /** Skip human gate (tests / fully automated). Default false for product. */
  skipHumanGate?: boolean;
};

/**
 * Hard orchestrator: runGoalHarnessDetailed with Workflowz over pi sessions.
 * Models come from model-router — never the parent session model.
 */
export async function runHardHarness(
  opts: HardHarnessOpts,
): Promise<HarnessRunResult> {
  const adapter = opts.modelAdapter ?? defaultHarnessModelCatalog();
  const models = resolveHarnessModels(adapter);
  const workflowz = createWorkflowzFromPi({
    cwd: opts.cwd,
    pi: opts.pi,
  });

  let humanGate = undefined;
  if (!opts.skipHumanGate) {
    if (opts.explicitSpecApproval) {
      humanGate = createHumanGate({
        interactive: false,
        explicitApproval: opts.explicitSpecApproval,
      });
    }
    // Without explicit approval, omit humanGate so Spec can advance after
    // reviewer PASS (product interactive approve is a follow-up shell).
  }

  return runGoalHarnessDetailed({
    boundGoal: opts.boundGoal,
    workflowz,
    models: {
      research: models.research,
      spec: models.spec,
      specReviewer: models.specReviewer,
      plan: models.plan,
      planReviewer: models.planReviewer,
      biteSize: models.biteSize,
    },
    humanGate,
    activeApi: { pi: opts.pi },
  });
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
  cwd?: string;
  /** Force soft start-message path even when pi is available. */
  softOnly?: boolean;
  skipHumanGate?: boolean;
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
      const base = handleHarnessCommand(args);
      const cwd =
        ctx?.cwd ??
        api.cwd ??
        (typeof process !== "undefined" ? process.cwd() : ".");
      const canHard =
        !ctx?.softOnly &&
        Boolean(api.pi?.createAgentSession && api.pi?.SessionManager?.inMemory);

      // Always emit start receipt (audit + UI).
      if (api.sendMessage) {
        const payload = JSON.stringify({
          kind: "goal-harness-start",
          mode: canHard ? "hard" : "soft",
          ...base.startMessages[0],
        });
        await api.sendMessage(payload, { triggerTurn: !canHard });
      }

      if (!canHard) {
        return base;
      }

      // HARD path: drive phases with model-router + pi sessions.
      try {
        const modelAdapter = api.models
          ? adapterFromOmpModels(api.models)
          : defaultHarnessModelCatalog();
        const hardRun = await runHardHarness({
          boundGoal: base.boundGoal,
          pi: api.pi!,
          cwd,
          modelAdapter,
          skipHumanGate: ctx?.skipHumanGate ?? true,
        });
        if (api.sendMessage) {
          await api.sendMessage(
            JSON.stringify({
              kind: "goal-harness-hard-complete",
              boundGoal: base.boundGoal,
              status: hardRun.snapshot.status,
              completed: hardRun.snapshot.completed,
              models: resolveHarnessModels(modelAdapter).resolved,
            }),
            { triggerTurn: false },
          );
        }
        return {
          ...base,
          mode: "hard" as const,
          hardRun,
        };
      } catch (err) {
        const hardError = err instanceof Error ? err.message : String(err);
        if (api.sendMessage) {
          await api.sendMessage(
            JSON.stringify({
              kind: "goal-harness-hard-error",
              boundGoal: base.boundGoal,
              error: hardError,
            }),
            { triggerTurn: true },
          );
        }
        return {
          ...base,
          mode: "hard" as const,
          hardError,
        };
      }
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
