/**
 * Design-flow orchestrator: PDR → Arc42 → ADR → Handoff.
 * Uses Workflowz adapter; no auto /harness.
 */

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createStrictAgentCall,
  type Workflowz,
} from "../goal-harness/workflow-adapter";
import { reviewResultSchema } from "../goal-harness/schemas";
import { validateReviewResult } from "../goal-harness/validation";
import {
  resolveModelRoute,
  resolveReviewerModel,
  type ModelRouterAdapter,
} from "../goal-harness/model-router";
import {
  adrAbsolutePath,
  assertAllowedAdrWritePath,
  nextAdrNumber,
  renderAdrMarkdown,
  ADR_DIR,
} from "./adr-paths";
import {
  applyDesignTransition,
  createInitialDesignSnapshot,
  DESIGN_GATE_BUDGETS,
  type DesignSnapshot,
} from "./phase-machine";
import {
  persistDesignArtifactsBestEffort,
  type BdRunner,
} from "./persist";

export type { BdRunner };
export { persistDesignArtifactsBestEffort };

const schemaDir = fileURLToPath(new URL("../../schemas/", import.meta.url));
const pdrOutputSchema = JSON.parse(
  readFileSync(join(schemaDir, "pdr.output.schema.json"), "utf8"),
);
const arc42OutputSchema = JSON.parse(
  readFileSync(join(schemaDir, "arc42.output.schema.json"), "utf8"),
);
const adrOutputSchema = JSON.parse(
  readFileSync(join(schemaDir, "adr.output.schema.json"), "utf8"),
);

export type DesignReview = {
  ok: boolean;
  feedback: string;
  blocking: string[];
};

export type DesignHandoff = {
  boundGoal: string;
  pdr: unknown;
  arc42: unknown;
  adrPaths: string[];
  nextStep: string;
  note: string;
};

export type RunDesignFlowResult = {
  snapshot: DesignSnapshot;
  handoff: DesignHandoff | null;
  error?: string;
  warnings?: string[];
};

function asReview(raw: unknown): DesignReview {
  const v = validateReviewResult(raw);
  if (!v.ok) {
    return {
      ok: false,
      feedback: v.reason ?? "invalid review",
      blocking: [v.reason ?? "invalid"],
    };
  }
  const r = v.value as DesignReview;
  return {
    ok: r.ok,
    feedback: r.feedback,
    blocking: r.blocking ?? [],
  };
}

async function runWriteReviewGate(
  wz: Workflowz,
  opts: {
    phaseLabel: string;
    writerAgent: string;
    reviewerAgent: string;
    writerPrompt: string;
    reviewerPrompt: (candidate: unknown) => string;
    writerModel: string;
    reviewerModel: string;
    writerEffort?: string;
    reviewerEffort?: string;
    maxAttempts: number;
    writerSchema: unknown;
  },
): Promise<{ candidate: unknown; review: DesignReview; attempts: number }> {
  let attempts = 0;
  let candidate: unknown = null;
  let review: DesignReview = {
    ok: false,
    feedback: "not run",
    blocking: ["not run"],
  };
  let lastFail = "";

  while (attempts < opts.maxAttempts) {
    attempts++;
    wz.phase(opts.phaseLabel);
    const writeCall = createStrictAgentCall({
      agentName: opts.writerAgent,
      model: opts.writerModel,
      effort: opts.writerEffort ?? "max",
      schema: opts.writerSchema,
      schemaMode: "strict",
    });
    const revision =
      review.ok === false && review.blocking.length > 0 && attempts > 1
        ? `\n\nPrior review FAIL (fix blocking only):\n${review.blocking.join("\n")}\n${review.feedback}`
        : "";
    candidate = await writeCall(wz, `${opts.writerPrompt}${revision}`);

    const reviewCall = createStrictAgentCall({
      agentName: opts.reviewerAgent,
      model: opts.reviewerModel,
      effort: opts.reviewerEffort ?? "high",
      schema: reviewResultSchema,
      schemaMode: "strict",
    });
    const raw = await reviewCall(wz, opts.reviewerPrompt(candidate));
    review = asReview(raw);
    if (review.ok) return { candidate, review, attempts };
    lastFail = review.feedback;
  }

  return {
    candidate,
    review: {
      ok: false,
      feedback: lastFail || "gate exhausted",
      blocking: review.blocking.length ? review.blocking : ["gate exhausted"],
    },
    attempts,
  };
}

/** Hardcoded heads when no modelRouter (degraded). */
const FALLBACK_MODELS = {
  pdr: "anthropic/claude-opus-5",
  pdrReviewer: "openai-codex/gpt-5.6-terra",
  arc42: "xai-oauth/grok-4.5",
  arc42Reviewer: "cursor/composer-2.5",
  adr: "anthropic/claude-opus-5",
} as const;

export type DesignModels = {
  pdr: string;
  pdrReviewer: string;
  pdrEffort: string;
  pdrReviewerEffort: string;
  arc42: string;
  arc42Reviewer: string;
  arc42Effort: string;
  arc42ReviewerEffort: string;
  adr: string;
  /** ADR producer always max (router head or explicit override path). */
  adrEffort: "max";
};

/**
 * Resolve design producer/reviewer models.
 * modelRouter → design-pdr / design-adr / design-arc42 + resolveReviewerModel.
 * opts.models overrides still win per slot. ADR effort is always max.
 */
export function resolveDesignModels(opts: {
  modelRouter?: ModelRouterAdapter;
  models?: {
    pdr?: string;
    pdrReviewer?: string;
    arc42?: string;
    arc42Reviewer?: string;
    adr?: string;
  };
  nowMs?: number;
}): DesignModels {
  const overrides = opts.models ?? {};
  const adapter = opts.modelRouter;

  if (!adapter) {
    return {
      pdr: overrides.pdr ?? FALLBACK_MODELS.pdr,
      pdrReviewer: overrides.pdrReviewer ?? FALLBACK_MODELS.pdrReviewer,
      pdrEffort: "max",
      pdrReviewerEffort: "high",
      arc42: overrides.arc42 ?? FALLBACK_MODELS.arc42,
      arc42Reviewer: overrides.arc42Reviewer ?? FALLBACK_MODELS.arc42Reviewer,
      arc42Effort: "high",
      arc42ReviewerEffort: "high",
      adr: overrides.adr ?? FALLBACK_MODELS.adr,
      adrEffort: "max",
    };
  }

  const pdr = resolveModelRoute(adapter, "design-pdr", { nowMs: opts.nowMs });
  const pdrReviewer = resolveReviewerModel(adapter, pdr, opts.nowMs);
  const arc42 = resolveModelRoute(adapter, "design-arc42", {
    nowMs: opts.nowMs,
  });
  const arc42Reviewer = resolveReviewerModel(adapter, arc42, opts.nowMs);
  const adr = resolveModelRoute(adapter, "design-adr", { nowMs: opts.nowMs });

  return {
    pdr: overrides.pdr ?? pdr.providerModelId,
    pdrReviewer: overrides.pdrReviewer ?? pdrReviewer.providerModelId,
    pdrEffort: pdr.effort,
    pdrReviewerEffort: pdrReviewer.effort,
    arc42: overrides.arc42 ?? arc42.providerModelId,
    arc42Reviewer: overrides.arc42Reviewer ?? arc42Reviewer.providerModelId,
    arc42Effort: arc42.effort,
    arc42ReviewerEffort: arc42Reviewer.effort,
    adr: overrides.adr ?? adr.providerModelId,
    adrEffort: "max",
  };
}

export async function runDesignFlow(
  wz: Workflowz,
  opts: {
    boundGoal: string;
    repoRoot: string;
    runId?: string;
    beadsIssue?: string;
    bdRunner?: BdRunner;
    modelRouter?: ModelRouterAdapter;
    models?: {
      pdr?: string;
      pdrReviewer?: string;
      arc42?: string;
      arc42Reviewer?: string;
      adr?: string;
    };
    /** Test seam: skip agent ADR write and use returned payload. */
    adrPayload?: {
      adrs: Array<{
        title: string;
        status: string;
        context: string;
        decision: string;
        consequences: string;
        date?: string;
      }>;
    };
  },
): Promise<RunDesignFlowResult> {
  const boundGoal = opts.boundGoal.trim();
  if (!boundGoal) {
    return {
      snapshot: createInitialDesignSnapshot("invalid", ""),
      handoff: null,
      error: "boundGoal required",
    };
  }

  const runId = opts.runId ?? `design-${Date.now()}`;
  let snap = createInitialDesignSnapshot(runId, boundGoal);
  const models = resolveDesignModels({
    modelRouter: opts.modelRouter,
    models: opts.models,
  });

  snap = applyDesignTransition(snap, { type: "begin", phase: "Intake" });
  wz.phase("Intake");
  // Intake is controller-side: goal locked; brainstorming skill named for agents.
  snap = applyDesignTransition(snap, { type: "complete", phase: "Intake" });

  snap = applyDesignTransition(snap, { type: "begin", phase: "Pdr" });
  const pdrGate = await runWriteReviewGate(wz, {
    phaseLabel: "Pdr",
    writerAgent: "pdr-writer",
    reviewerAgent: "pdr-reviewer",
    writerModel: models.pdr,
    reviewerModel: models.pdrReviewer,
    writerEffort: models.pdrEffort,
    reviewerEffort: models.pdrReviewerEffort,
    maxAttempts: DESIGN_GATE_BUDGETS.Pdr,
    writerSchema: pdrOutputSchema,
    writerPrompt: [
      "Write a PDR for this design goal (design only, no code).",
      "Load skill://brainstorming then produce strict PDR JSON.",
      `Goal:\n${boundGoal}`,
    ].join("\n"),
    reviewerPrompt: (c) =>
      `Review this PDR under REVIEW-POLICY (default PASS).\n${JSON.stringify(c)}`,
  });
  if (!pdrGate.review.ok) {
    snap = applyDesignTransition(snap, {
      type: "gate_fail",
      gate: "Pdr",
      feedback: pdrGate.review.feedback,
    });
    return { snapshot: snap, handoff: null, error: snap.lastError };
  }
  snap = applyDesignTransition(snap, { type: "gate_pass", gate: "Pdr" });

  snap = applyDesignTransition(snap, { type: "begin", phase: "Arc42" });
  const arcGate = await runWriteReviewGate(wz, {
    phaseLabel: "Arc42",
    writerAgent: "arc42-writer",
    reviewerAgent: "arc42-reviewer",
    writerModel: models.arc42,
    reviewerModel: models.arc42Reviewer,
    writerEffort: models.arc42Effort,
    reviewerEffort: models.arc42ReviewerEffort,
    maxAttempts: DESIGN_GATE_BUDGETS.Arc42,
    writerSchema: arc42OutputSchema,
    writerPrompt: [
      "Write Arc42 architecture JSON + at least one mermaid/structurizr diagram.",
      "Design only. Align with accepted PDR.",
      `Goal:\n${boundGoal}`,
      `PDR:\n${JSON.stringify(pdrGate.candidate)}`,
    ].join("\n"),
    reviewerPrompt: (c) =>
      `Review Arc42 vs PDR under REVIEW-POLICY.\nPDR:${JSON.stringify(pdrGate.candidate)}\nArc42:${JSON.stringify(c)}`,
  });
  if (!arcGate.review.ok) {
    snap = applyDesignTransition(snap, {
      type: "gate_fail",
      gate: "Arc42",
      feedback: arcGate.review.feedback,
    });
    return { snapshot: snap, handoff: null, error: snap.lastError };
  }
  snap = applyDesignTransition(snap, { type: "gate_pass", gate: "Arc42" });

  snap = applyDesignTransition(snap, { type: "begin", phase: "Adr" });
  wz.phase("Adr");
  let adrPayload = opts.adrPayload;
  if (!adrPayload) {
    const adrCall = createStrictAgentCall({
      agentName: "adr-writer",
      model: models.adr,
      effort: models.adrEffort,
      schema: adrOutputSchema,
      schemaMode: "strict",
    });
    const raw = await adrCall(
      wz,
      [
        "Emit ADRs as JSON { adrs: [...] } for decisive architecture choices.",
        "Controller will write docs/adr/NNNN-slug.md only.",
        `Goal:\n${boundGoal}`,
        `PDR:\n${JSON.stringify(pdrGate.candidate)}`,
        `Arc42:\n${JSON.stringify(arcGate.candidate)}`,
      ].join("\n"),
    );
    adrPayload = raw as typeof adrPayload;
  }
  if (!adrPayload?.adrs?.length) {
    snap = applyDesignTransition(snap, {
      type: "fail",
      reason: "adr-writer returned no adrs",
    });
    return { snapshot: snap, handoff: null, error: snap.lastError };
  }

  mkdirSync(join(opts.repoRoot, ADR_DIR), { recursive: true });
  const adrPaths: string[] = [];
  let nextId = nextAdrNumber(opts.repoRoot);
  for (const adr of adrPayload.adrs) {
    const abs = adrAbsolutePath(opts.repoRoot, nextId, adr.title);
    assertAllowedAdrWritePath(opts.repoRoot, abs);
    const body = renderAdrMarkdown({
      ...adr,
      id: nextId,
    });
    writeFileSync(abs, body, "utf8");
    adrPaths.push(abs);
    nextId += 1;
  }
  snap = applyDesignTransition(snap, { type: "complete", phase: "Adr" });

  snap = applyDesignTransition(snap, { type: "begin", phase: "Handoff" });
  wz.phase("Handoff");
  const handoff: DesignHandoff = {
    boundGoal,
    pdr: pdrGate.candidate,
    arc42: arcGate.candidate,
    adrPaths,
    nextStep: `/harness ${boundGoal}`,
    note: "Design complete. ADRs on disk. PDR/Arc42 in session/bd. Do not auto-start /harness.",
  };
  snap = applyDesignTransition(snap, { type: "complete", phase: "Handoff" });

  const warnings: string[] = [];
  const persist = persistDesignArtifactsBestEffort({
    cwd: opts.repoRoot,
    issueId: opts.beadsIssue,
    boundGoal,
    pdr: pdrGate.candidate,
    arc42: arcGate.candidate,
    adrPaths,
    bdRunner: opts.bdRunner,
  });
  if (!persist.ok && persist.warning && opts.beadsIssue) {
    warnings.push(persist.warning);
  }

  return {
    snapshot: snap,
    handoff,
    ...(warnings.length ? { warnings } : {}),
  };
}

