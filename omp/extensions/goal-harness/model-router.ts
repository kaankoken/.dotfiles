/**
 * Deterministic harness model routing.
 * Catalog-driven: match semantic aliases, persist exact provider/model IDs + efforts.
 * Never hard-code unverified Pi provider IDs as the only path — aliases map via catalog.
 */

export type PhaseKind =
  | "spec"
  | "plan"
  | "bitesize"
  | "milestone"
  | "implement"
  | "research"
  | "init"
  | "pr"
  /** /design PDR writer + reviewer chain */
  | "design-pdr"
  /** /design ADR writer chain (same family order as PDR) */
  | "design-adr"
  /** /design Arc42 writer + reviewer */
  | "design-arc42";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export type ModelFamily =
  | "sol"
  | "fable"
  | "opus"
  | "grok"
  | "composer"
  | "sonnet"
  | "terra";

export type ModelCatalogEntry = {
  id: string;
  aliases: string[];
  provider: string;
  available: boolean;
};

export type ModelRouterAdapter = {
  /** Currently available models. */
  list: () => ModelCatalogEntry[];
  /** Full catalog including unavailable (for diagnostics). */
  all?: () => ModelCatalogEntry[];
  /** Resolve semantic query to a catalog entry if available. */
  resolve: (query: string) => ModelCatalogEntry | null;
};

export type ResolvedModel = {
  providerModelId: string;
  provider: string;
  family: ModelFamily;
  effort: Effort;
  phase: PhaseKind;
  /** Stable key for retries within a phase. */
  instanceKey: string;
  degradedIndependence: boolean;
  isolatedInstance: boolean;
  /** Ordered preferred chain for this phase (for diagnostics / fallback). */
  fallbackChain: Array<{ family: ModelFamily; effort: Effort }>;
};

export type ResolveOptions = {
  priorResolved?: ResolvedModel;
  /** Keep prior model (retry of same gate attempt). */
  retry?: boolean;
  /** Current invocation failed; advance chain for this invocation only. */
  invocationFailure?: boolean;
};

type ChainStep = { family: ModelFamily; effort: Effort; queries: string[] };

/**
 * Until this instant (UTC), OpenAI Codex models (Sol + Terra) are last-resort
 * on every chain. Quota/context thrash on Spec/Plan/Milestone/PR/design.
 * After 2026-08-08T00:00:00Z, prior primary positions restore.
 */
export const OPENAI_DEPRIORITIZE_UNTIL_MS = Date.parse(
  "2026-08-08T00:00:00.000Z",
);

/** Injectable clock for tests. True while OpenAI (Sol/Terra) is last-resort. */
export function isOpenAiDeprioritized(nowMs: number = Date.now()): boolean {
  return nowMs < OPENAI_DEPRIORITIZE_UNTIL_MS;
}

const SOL_ULTRA: ChainStep = {
  family: "sol",
  effort: "ultra",
  queries: ["sol 5.6", "gpt-5.6-sol", "sol"],
};
const SOL_HIGH: ChainStep = {
  family: "sol",
  effort: "high",
  queries: ["sol 5.6", "gpt-5.6-sol", "sol"],
};
const SOL_MEDIUM: ChainStep = {
  family: "sol",
  effort: "medium",
  queries: ["sol 5.6", "gpt-5.6-sol", "sol"],
};
const FABLE_MAX: ChainStep = {
  family: "fable",
  effort: "max",
  queries: ["fable 5", "claude-fable-5", "fable"],
};
const FABLE_MEDIUM: ChainStep = {
  family: "fable",
  effort: "medium",
  queries: ["fable 5", "claude-fable-5", "fable"],
};
const OPUS_MAX: ChainStep = {
  family: "opus",
  effort: "max",
  // Prefer Claude Opus 5 when catalog exposes it; keep generic fallbacks.
  queries: ["claude-opus-5", "opus 5", "opus", "claude-opus"],
};
const SONNET_HIGH: ChainStep = {
  family: "sonnet",
  effort: "high",
  queries: ["claude-sonnet-5", "sonnet 5", "sonnet", "claude-sonnet"],
};
const SONNET_MEDIUM: ChainStep = {
  family: "sonnet",
  effort: "medium",
  queries: ["claude-sonnet-5", "sonnet 5", "sonnet", "claude-sonnet"],
};
const GROK_HIGH: ChainStep = {
  family: "grok",
  effort: "high",
  queries: ["grok 4.5", "grok-4.5", "grok"],
};
const COMPOSER_HIGH: ChainStep = {
  family: "composer",
  effort: "high",
  queries: ["composer 2.5", "composer"],
};
const TERRA_XHIGH: ChainStep = {
  family: "terra",
  effort: "xhigh",
  queries: [
    "terra",
    "gpt-5.6-terra",
    "gpt-5.6-terra:xhigh",
    "gpt-5.6-terra:max",
    "5.6-terra",
  ],
};
const TERRA_MAX: ChainStep = {
  family: "terra",
  effort: "max",
  queries: [
    "terra",
    "gpt-5.6-terra",
    "gpt-5.6-terra:max",
    "gpt-5.6-terra:xhigh",
    "5.6-terra",
  ],
};
const SOL_XHIGH: ChainStep = {
  family: "sol",
  effort: "xhigh",
  queries: ["sol 5.6", "gpt-5.6-sol", "gpt-5.6-sol:xhigh", "sol"],
};
const OPUS_XHIGH: ChainStep = {
  family: "opus",
  effort: "xhigh",
  queries: ["claude-opus-5", "opus 5", "opus", "claude-opus"],
};

/**
 * /design PDR + ADR. OpenAI window: Opus → Grok → Terra/Sol tail.
 * After window: Opus → Terra → Sol → Grok.
 */
function designPdrAdrChain(nowMs?: number): ChainStep[] {
  if (isOpenAiDeprioritized(nowMs)) {
    return [OPUS_MAX, OPUS_XHIGH, GROK_HIGH, TERRA_MAX, TERRA_XHIGH, SOL_XHIGH];
  }
  return [OPUS_MAX, OPUS_XHIGH, TERRA_MAX, TERRA_XHIGH, SOL_XHIGH, GROK_HIGH];
}

/** /design Arc42: Grok → Composer 2.5 */
function designArc42Chain(): ChainStep[] {
  return [GROK_HIGH, COMPOSER_HIGH];
}

/** Spec / Plan / BiteSize writers + big-gate reviewers. */
function bigGateChain(nowMs?: number): ChainStep[] {
  if (isOpenAiDeprioritized(nowMs)) {
    return [FABLE_MAX, OPUS_MAX, SOL_ULTRA];
  }
  return [SOL_ULTRA, FABLE_MAX, OPUS_MAX];
}

/** Grok → Composer → …; Sol last while OpenAI demoted. */
function implementChain(nowMs?: number): ChainStep[] {
  if (isOpenAiDeprioritized(nowMs)) {
    return [GROK_HIGH, COMPOSER_HIGH, SONNET_HIGH, SOL_HIGH];
  }
  return [GROK_HIGH, COMPOSER_HIGH, SOL_HIGH, SONNET_HIGH];
}

/**
 * Research / scouts: Grok high first.
 * OpenAI window: Fable medium before Sol.
 */
function researchChain(nowMs?: number): ChainStep[] {
  if (isOpenAiDeprioritized(nowMs)) {
    return [GROK_HIGH, FABLE_MEDIUM, SOL_MEDIUM];
  }
  return [GROK_HIGH, SOL_MEDIUM];
}

/** PR: OpenAI window puts Terra after non-OpenAI; after window Terra mid-chain. */
function prChain(nowMs?: number): ChainStep[] {
  if (isOpenAiDeprioritized(nowMs)) {
    return [GROK_HIGH, SONNET_HIGH, TERRA_XHIGH];
  }
  return [GROK_HIGH, TERRA_XHIGH, SONNET_HIGH];
}

/** Milestone: OpenAI (Terra/Sol) last during window. */
function milestoneChain(nowMs?: number): ChainStep[] {
  if (isOpenAiDeprioritized(nowMs)) {
    return [FABLE_MAX, OPUS_MAX, TERRA_XHIGH, SOL_ULTRA];
  }
  return [TERRA_XHIGH, FABLE_MAX, SOL_ULTRA, OPUS_MAX];
}

function initChain(nowMs?: number): ChainStep[] {
  if (isOpenAiDeprioritized(nowMs)) {
    return [FABLE_MEDIUM, SONNET_MEDIUM, SOL_MEDIUM];
  }
  return [SOL_MEDIUM, SONNET_MEDIUM];
}

/** @internal exported for diagnostics / tests */
export function chainForPhase(
  phase: PhaseKind,
  nowMs?: number,
): ChainStep[] {
  switch (phase) {
    case "spec":
    case "plan":
    case "bitesize":
      return bigGateChain(nowMs);
    case "milestone":
      return milestoneChain(nowMs);
    case "implement":
      return implementChain(nowMs);
    case "research":
      return researchChain(nowMs);
    case "pr":
      return prChain(nowMs);
    case "design-pdr":
    case "design-adr":
      return designPdrAdrChain(nowMs);
    case "design-arc42":
      return designArc42Chain();
    case "init":
    default:
      return initChain(nowMs);
  }
}

/** Alias kept for resolveReviewerModel / tests that import BIG_GATE semantics. */
export function getBigGateChain(nowMs?: number): ChainStep[] {
  return bigGateChain(nowMs);
}

function pickFromChain(
  adapter: ModelRouterAdapter,
  chain: ChainStep[],
  skipIds: Set<string> = new Set(),
  startIndex = 0,
): { entry: ModelCatalogEntry; step: ChainStep; index: number } | null {
  for (let i = startIndex; i < chain.length; i++) {
    const step = chain[i];
    for (const q of step.queries) {
      const hit = adapter.resolve(q);
      if (!hit || !hit.available) continue;
      if (skipIds.has(hit.id)) continue;
      // Family sanity: avoid cross-family alias collisions
      const blob = hit.id + " " + hit.aliases.join(" ");
      if (step.family === "composer" && !/composer/i.test(blob)) continue;
      if (step.family === "grok" && !/grok/i.test(blob)) continue;
      if (step.family === "terra" && !/terra/i.test(blob)) continue;
      return { entry: hit, step, index: i };
    }
  }
  return null;
}

function makeInstanceKey(
  phase: PhaseKind,
  modelId: string,
  isolated: boolean,
  salt = "primary",
): string {
  return `${phase}::${modelId}::${isolated ? "iso" : "shared"}::${salt}`;
}

/**
 * Resolve model for a harness phase.
 * First available in the phase chain wins. Retries keep prior resolution.
 * invocationFailure advances past the failed model for this call only when
 * that model is no longer available or skip is forced.
 */
export type ResolveModelRouteOptions = ResolveOptions & {
  /** Override clock (tests / freeze demote window). */
  nowMs?: number;
};

export function resolveModelRoute(
  adapter: ModelRouterAdapter,
  phase: PhaseKind,
  opts: ResolveModelRouteOptions = {},
): ResolvedModel {
  const chain = chainForPhase(phase, opts.nowMs);
  const fallbackChain = chain.map((s) => ({
    family: s.family,
    effort: s.effort,
  }));

  if (opts.retry && opts.priorResolved && opts.priorResolved.phase === phase) {
    return { ...opts.priorResolved, fallbackChain };
  }

  let startIndex = 0;
  const skipIds = new Set<string>();

  if (opts.invocationFailure && opts.priorResolved) {
    // Advance past prior model for this invocation when failure reported
    skipIds.add(opts.priorResolved.providerModelId);
    const priorFamily = opts.priorResolved.family;
    const idx = chain.findIndex((s) => s.family === priorFamily);
    if (idx >= 0) startIndex = idx + 1;
  }

  const picked = pickFromChain(adapter, chain, skipIds, startIndex);
  if (!picked) {
    // last resort: any available model with first chain effort
    const any = adapter.list()[0];
    if (!any) {
      throw new Error(`model-router: no available models for phase ${phase}`);
    }
    return {
      providerModelId: any.id,
      provider: any.provider,
      family: chain[0]?.family ?? "fable",
      effort: chain[0]?.effort ?? "medium",
      phase,
      instanceKey: makeInstanceKey(phase, any.id, false, "fallback"),
      degradedIndependence: true,
      isolatedInstance: false,
      fallbackChain,
    };
  }

  // Grok always high — never silently lower
  let effort = picked.step.effort;
  if (picked.step.family === "grok") {
    effort = "high";
  }

  return {
    providerModelId: picked.entry.id,
    provider: picked.entry.provider,
    family: picked.step.family,
    effort,
    phase,
    instanceKey: makeInstanceKey(phase, picked.entry.id, false),
    degradedIndependence: false,
    isolatedInstance: false,
    fallbackChain,
  };
}

/**
 * Reviewer must not use the same resolved provider/model ID as the producer
 * when an alternative exists. If only one model is available, return a fresh
 * isolated instance and mark degradedIndependence.
 */
export function resolveReviewerModel(
  adapter: ModelRouterAdapter,
  producer: ResolvedModel,
  nowMs?: number,
): ResolvedModel {
  // Prefer big-gate for implement reviewers; otherwise same phase chain without producer id.
  const reviewChain =
    producer.phase === "implement"
      ? bigGateChain(nowMs)
      : chainForPhase(producer.phase, nowMs);

  const skip = new Set([producer.providerModelId]);
  const picked = pickFromChain(adapter, reviewChain, skip, 0);

  if (picked) {
    return {
      providerModelId: picked.entry.id,
      provider: picked.entry.provider,
      family: picked.step.family,
      effort: picked.step.effort,
      phase: producer.phase,
      instanceKey: makeInstanceKey(
        producer.phase,
        picked.entry.id,
        false,
        "reviewer",
      ),
      degradedIndependence: false,
      isolatedInstance: false,
      fallbackChain: reviewChain.map((s) => ({
        family: s.family,
        effort: s.effort,
      })),
    };
  }

  // Single-model degraded independence
  return {
    providerModelId: producer.providerModelId,
    provider: producer.provider,
    family: producer.family,
    effort: producer.effort,
    phase: producer.phase,
    instanceKey: makeInstanceKey(
      producer.phase,
      producer.providerModelId,
      true,
      `reviewer-${Date.now()}`,
    ),
    degradedIndependence: true,
    isolatedInstance: true,
    fallbackChain: producer.fallbackChain,
  };
}

export type ProviderPreflightInput = {
  anthropicViaClaudeCode: boolean;
  anthropicViaOmp: boolean;
  codexCli: boolean;
  codexOauth: boolean;
  grokBuild: boolean;
  xaiApi: boolean;
  xaiOauth: boolean;
};

export type ProviderPreflightReport = {
  anthropic: { available: boolean; routes: string[] };
  codex: { available: boolean; routes: string[] };
  grok: { available: boolean; routes: string[]; notes: string };
};

/**
 * Report auth/route availability without reading secret values.
 * xAI API key is not assumed to consume Grok Build subscription quota.
 */
export function reportProviderPreflight(
  input: ProviderPreflightInput,
): ProviderPreflightReport {
  const anthropicRoutes: string[] = [];
  if (input.anthropicViaClaudeCode) anthropicRoutes.push("claude-code");
  if (input.anthropicViaOmp) anthropicRoutes.push("omp-anthropic");

  const codexRoutes: string[] = [];
  if (input.codexCli) codexRoutes.push("codex-cli");
  if (input.codexOauth) codexRoutes.push("codex-oauth");

  const grokRoutes: string[] = [];
  if (input.grokBuild) grokRoutes.push("grok-build");
  if (input.xaiOauth) grokRoutes.push("xai-oauth");
  if (input.xaiApi) grokRoutes.push("xai-api");

  return {
    anthropic: {
      available: anthropicRoutes.length > 0,
      routes: anthropicRoutes,
    },
    codex: {
      available: codexRoutes.length > 0,
      routes: codexRoutes,
    },
    grok: {
      available: grokRoutes.length > 0,
      routes: grokRoutes,
      notes:
        "Grok Build subscription availability is separate from xAI API keys; an API key is not assumed to consume Grok Build quota.",
    },
  };
}

/** Build adapter from OMP ctx.models surface when present. */
export function adapterFromOmpModels(models: {
  list: () => Array<{ id: string; provider?: string; name?: string }>;
  resolve?: (q: string) => { id: string; provider?: string } | null;
}): ModelRouterAdapter {
  const toEntry = (m: {
    id: string;
    provider?: string;
    name?: string;
  }): ModelCatalogEntry => ({
    id: m.id,
    provider: m.provider ?? m.id.split("/")[0] ?? "unknown",
    aliases: [m.id, m.name ?? "", m.id.split("/").pop() ?? ""].filter(Boolean),
    available: true,
  });

  return {
    list: () => models.list().map(toEntry),
    resolve: (query: string) => {
      if (models.resolve) {
        const hit = models.resolve(query);
        if (hit) return toEntry({ ...hit, name: query });
      }
      const q = query.toLowerCase();
      for (const m of models.list()) {
        const e = toEntry(m);
        if (
          e.id.toLowerCase().includes(q) ||
          e.aliases.some((a) => a.toLowerCase().includes(q))
        ) {
          return e;
        }
      }
      return null;
    },
  };
}
