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
  | "pr";

export type Effort = "low" | "medium" | "high" | "max" | "ultra";

export type ModelFamily =
  | "sol"
  | "fable"
  | "opus"
  | "grok"
  | "composer"
  | "sonnet";

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

const BIG_GATE_CHAIN: ChainStep[] = [
  {
    family: "sol",
    effort: "ultra",
    queries: ["sol 5.6", "gpt-5.6-sol", "sol"],
  },
  {
    family: "fable",
    effort: "max",
    queries: ["fable 5", "claude-fable-5", "fable"],
  },
  {
    family: "opus",
    effort: "max",
    // Prefer Claude Opus 5 when catalog exposes it; keep generic fallbacks.
    queries: ["claude-opus-5", "opus 5", "opus", "claude-opus"],
  },
];

/** Grok → Composer (Grok-unavailable only) → Sol high → Sonnet */
const IMPLEMENT_CHAIN: ChainStep[] = [
  {
    family: "grok",
    effort: "high",
    queries: ["grok 4.5", "grok-4.5", "grok"],
  },
  {
    family: "composer",
    effort: "high",
    queries: ["composer 2.5", "composer"],
  },
  {
    family: "sol",
    effort: "high",
    queries: ["sol 5.6", "gpt-5.6-sol", "sol"],
  },
  {
    family: "sonnet",
    effort: "high",
    // Prefer Claude Sonnet 5 when catalog exposes it; keep generic fallbacks.
    queries: ["claude-sonnet-5", "sonnet 5", "sonnet", "claude-sonnet"],
  },
];

const RESEARCH_CHAIN: ChainStep[] = [
  {
    family: "sol",
    effort: "medium",
    queries: ["sol", "gpt-5.6-sol"],
  },
  {
    family: "grok",
    effort: "high",
    queries: ["grok 4.5", "grok"],
  },
];

function chainForPhase(phase: PhaseKind): ChainStep[] {
  switch (phase) {
    case "spec":
    case "plan":
    case "bitesize":
    case "milestone":
      return BIG_GATE_CHAIN;
    case "implement":
      return IMPLEMENT_CHAIN;
    case "research":
      return RESEARCH_CHAIN;
    case "init":
    case "pr":
    default:
      return [
        {
          family: "sol",
          effort: "medium",
          queries: ["sol", "gpt-5.6-sol"],
        },
        {
          family: "sonnet",
          effort: "medium",
          queries: ["claude-sonnet-5", "sonnet 5", "sonnet", "claude-sonnet"],
        },
      ];
  }
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
      // Family sanity: avoid Composer matching unrelated aliases
      if (step.family === "composer" && !/composer/i.test(hit.id + hit.aliases.join(" ")))
        continue;
      if (step.family === "grok" && !/grok/i.test(hit.id + hit.aliases.join(" ")))
        continue;
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
export function resolveModelRoute(
  adapter: ModelRouterAdapter,
  phase: PhaseKind,
  opts: ResolveOptions = {},
): ResolvedModel {
  const chain = chainForPhase(phase);
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
      family: chain[0]?.family ?? "sol",
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
): ResolvedModel {
  const chain = chainForPhase(
    producer.phase === "implement" ? "milestone" : producer.phase,
  );
  // Prefer big-gate chain for reviewers of producer work
  const reviewChain =
    producer.phase === "implement" ? BIG_GATE_CHAIN : chain;

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
