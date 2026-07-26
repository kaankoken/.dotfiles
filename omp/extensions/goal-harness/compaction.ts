/**
 * Beads-safe compaction policy for the OMP goal harness.
 *
 * Global strategy is always configured `shake` (config.yml).
 * Selective `snapcompact` only for long-running coordinator + vision model +
 * Beads-synced durable state. Never global snapcompact. Never one-off "shake"
 * or "handoff" modes on ctx.compact().
 *
 * Resume always reconstructs from Beads + repository — not compaction prose.
 */

/** Contract from compatibility.json compactModes */
export type CompactMode = "soft" | "remote" | "snapcompact";

/** Global config strategies allowed in config.yml */
export type CompactionStrategy =
  | "shake"
  | "snapcompact"
  | "context-full"
  | "handoff"
  | "off";

export type CompactCall =
  | { kind: "global-shake" }
  | { kind: "selective"; mode: CompactMode };

export class CompactionPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompactionPolicyError";
  }
}

export type ModelCapabilities = {
  /** Provider model id */
  id: string;
  vision?: boolean;
  multimodal?: boolean;
};

export type DurableCompactionState = {
  runId: string;
  phase: string;
  /** Evidence already written to Beads for this phase */
  evidenceWritten: boolean;
  /** Next action already written to Beads */
  nextActionWritten: boolean;
  /** Beads sync completed (no pending unsynced mutations) */
  beadsSynced: boolean;
  /** Optional: content that was re-read from Beads after write */
  beadsRereadOk?: boolean;
};

export type CompactionActor =
  | "long-running-coordinator"
  | "lane-implementer"
  | "scout"
  | "reviewer"
  | "parent-orchestrator"
  | "other";

export type CompactionConfig = {
  enabled: boolean;
  /** Must always be shake for harness */
  strategy: CompactionStrategy;
};

export const GLOBAL_STRATEGY = "shake" as const;
export const ALLOWED_COMPACT_MODES: readonly CompactMode[] = [
  "soft",
  "remote",
  "snapcompact",
] as const;

/** Forbidden as one-off mode args to ctx.compact() */
export const FORBIDDEN_ONE_OFF_MODES = ["shake", "handoff"] as const;

/**
 * Validate lean config: global strategy must be shake; snapcompact not global.
 */
export function assertGlobalShakeConfig(config: CompactionConfig): void {
  if (!config.enabled) {
    throw new CompactionPolicyError("compaction must stay enabled for harness");
  }
  if (config.strategy !== "shake") {
    throw new CompactionPolicyError(
      `global compaction.strategy must be shake, got ${config.strategy}`,
    );
  }
}

/**
 * Build the call for ordinary phase-boundary compaction.
 * Uses configured global shake — no model-selected cut point required.
 */
export function planGlobalShake(): CompactCall {
  return { kind: "global-shake" };
}

/**
 * Whether selective snapcompact is eligible for this actor/model/state.
 * Failures stay rejections — no silent reinterpretation as shake.
 */
export function evaluateSnapcompactEligibility(input: {
  actor: CompactionActor;
  model: ModelCapabilities;
  durable: DurableCompactionState;
}): { ok: true } | { ok: false; reason: string } {
  if (input.actor !== "long-running-coordinator") {
    return {
      ok: false,
      reason: `snapcompact only for long-running-coordinator, got ${input.actor}`,
    };
  }
  const vision = Boolean(input.model.vision || input.model.multimodal);
  if (!vision) {
    return {
      ok: false,
      reason: "snapcompact requires vision-capable model (text-only rejected)",
    };
  }
  if (!input.durable.evidenceWritten) {
    return {
      ok: false,
      reason: "phase evidence must be written to Beads before snapcompact",
    };
  }
  if (!input.durable.nextActionWritten) {
    return {
      ok: false,
      reason: "next action must be written to Beads before snapcompact",
    };
  }
  if (!input.durable.beadsSynced) {
    return {
      ok: false,
      reason: "unsynced Beads state rejects snapcompact",
    };
  }
  if (input.durable.beadsRereadOk === false) {
    return {
      ok: false,
      reason: "Beads re-read verification failed; refuse snapcompact",
    };
  }
  return { ok: true };
}

/**
 * Plan selective snapcompact — throws on ineligibility (no silent fallback).
 */
export function planSnapcompact(input: {
  actor: CompactionActor;
  model: ModelCapabilities;
  durable: DurableCompactionState;
}): CompactCall {
  const elig = evaluateSnapcompactEligibility(input);
  if (!elig.ok) {
    throw new CompactionPolicyError(elig.reason);
  }
  return { kind: "selective", mode: "snapcompact" };
}

/**
 * Validate one-off compact() mode argument against Task 1 contract.
 * CompactMode is exactly soft | remote | snapcompact.
 * Never pass "shake" or "handoff" as a one-off mode.
 */
export function validateCompactModeArg(
  mode: string | undefined,
): CompactMode | "global-default" {
  if (mode === undefined) return "global-default";
  if ((FORBIDDEN_ONE_OFF_MODES as readonly string[]).includes(mode)) {
    throw new CompactionPolicyError(
      `forbidden one-off compact mode "${mode}" — use ctx.compact() for global shake, or mode snapcompact when eligible`,
    );
  }
  if (!(ALLOWED_COMPACT_MODES as readonly string[]).includes(mode)) {
    throw new CompactionPolicyError(
      `invalid CompactMode "${mode}" (allowed: soft|remote|snapcompact)`,
    );
  }
  return mode as CompactMode;
}

export type CompactContext = {
  /** Injected OMP ctx.compact */
  compact: (opts?: { mode?: string }) => Promise<unknown> | unknown;
};

export type CompactResult = {
  call: CompactCall;
  /** What was actually invoked */
  invoked: "ctx.compact()" | 'ctx.compact({ mode: "snapcompact" })' | string;
  ok: boolean;
  /** Never success if policy rejected */
  policyRejected?: boolean;
  reason?: string;
};

/**
 * Invoke global shake via ctx.compact() with no mode (configured strategy).
 */
export async function runGlobalShake(
  ctx: CompactContext,
): Promise<CompactResult> {
  const call = planGlobalShake();
  await ctx.compact();
  return {
    call,
    invoked: "ctx.compact()",
    ok: true,
  };
}

/**
 * Invoke selective snapcompact only when eligible.
 * On policy reject: do not call ctx.compact; do not reinterpret as shake.
 */
export async function runSelectiveSnapcompact(
  ctx: CompactContext,
  input: {
    actor: CompactionActor;
    model: ModelCapabilities;
    durable: DurableCompactionState;
  },
): Promise<CompactResult> {
  const elig = evaluateSnapcompactEligibility(input);
  if (!elig.ok) {
    return {
      call: { kind: "selective", mode: "snapcompact" },
      invoked: "none",
      ok: false,
      policyRejected: true,
      reason: elig.reason,
    };
  }
  validateCompactModeArg("snapcompact");
  await ctx.compact({ mode: "snapcompact" });
  return {
    call: { kind: "selective", mode: "snapcompact" },
    invoked: 'ctx.compact({ mode: "snapcompact" })',
    ok: true,
  };
}

/**
 * context-full recovery path is separate and cannot launder a rejected snapcompact.
 */
export function contextFullRecovery(input: {
  priorSnapcompactRejected: boolean;
  reason?: string;
}): { ok: boolean; strategy: "context-full"; cannotOverrideSnapcompact: true } {
  return {
    ok: true,
    strategy: "context-full",
    cannotOverrideSnapcompact: true,
  };
}

/**
 * After any compaction, resume source of truth is Beads + repository —
 * never compaction prose/summary alone.
 */
export type ResumeSource = {
  fromBeads: boolean;
  fromRepository: boolean;
  fromCompactionProse: boolean;
};

export function validateResumeSource(source: ResumeSource): void {
  if (source.fromCompactionProse && !source.fromBeads) {
    throw new CompactionPolicyError(
      "resume must reconstruct from Beads/repository, not compaction prose alone",
    );
  }
  if (!source.fromBeads && !source.fromRepository) {
    throw new CompactionPolicyError(
      "resume requires Beads and/or repository durable state",
    );
  }
}

/**
 * Ordered phase-boundary protocol:
 * finish phase → write Beads → verify Beads → compact → resume from Beads/repo
 */
export async function phaseBoundaryCompact(input: {
  config: CompactionConfig;
  ctx: CompactContext;
  durable: DurableCompactionState;
  /** Prefer selective snapcompact when coordinator+vision+eligible */
  preferSnapcompact?: boolean;
  actor: CompactionActor;
  model: ModelCapabilities;
  /** Injected: write then re-read Beads */
  writeAndVerifyBeads: () => Promise<{
    written: boolean;
    rereadOk: boolean;
    synced: boolean;
  }>;
  resume: ResumeSource;
}): Promise<CompactResult> {
  assertGlobalShakeConfig(input.config);

  // finish phase already done by caller; write + verify Beads first
  const beads = await input.writeAndVerifyBeads();
  if (!beads.written || !beads.rereadOk || !beads.synced) {
    throw new CompactionPolicyError(
      "Beads write/verify/sync failed before compaction",
    );
  }

  const durable: DurableCompactionState = {
    ...input.durable,
    evidenceWritten: true,
    nextActionWritten: true,
    beadsSynced: true,
    beadsRereadOk: true,
  };

  let result: CompactResult;
  if (input.preferSnapcompact) {
    result = await runSelectiveSnapcompact(input.ctx, {
      actor: input.actor,
      model: input.model,
      durable,
    });
    // If snapcompact rejected, fall through to global shake only when
    // preferSnapcompact was opportunistic — still must not claim snapcompact ok
    if (!result.ok && result.policyRejected) {
      // Explicit: use shake as separate step, not as silent snapcompact success
      result = await runGlobalShake(input.ctx);
      result.reason = `snapcompact rejected (${result.reason ?? "policy"}); ran global shake separately`;
    }
  } else {
    result = await runGlobalShake(input.ctx);
  }

  validateResumeSource(input.resume);
  return result;
}

/**
 * Parse compaction section from config object (yaml already parsed).
 */
export function parseCompactionConfig(
  raw: Record<string, unknown>,
): CompactionConfig {
  const c = raw.compaction as Record<string, unknown> | undefined;
  if (!c) {
    throw new CompactionPolicyError("config.compaction missing");
  }
  return {
    enabled: Boolean(c.enabled),
    strategy: String(c.strategy) as CompactionStrategy,
  };
}
