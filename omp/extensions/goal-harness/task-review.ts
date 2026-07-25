/**
 * Per-task review sequence for a lane:
 * implement → self-review → Spec review → fix/re-review
 *           → quality review → fix/re-review → approved
 *
 * Spec reviewer and quality reviewer are separate instances from implementer.
 * HEAD_SHA change invalidates affected reviews and evidence.
 */

import {
  createStrictAgentCall,
  type Workflowz,
} from "./workflow-adapter";
import { reviewResultSchema } from "./schemas";
import { validateReviewResult } from "./validation";

export type ReviewKind = "self" | "spec" | "quality";

export type ReviewOutcome = {
  ok: boolean;
  feedback: string;
  blocking: string[];
  headShaAtReview: string;
  kind: ReviewKind;
  agentName: string;
};

export type LaneReviewState = {
  issueId: string;
  implementerAgent: string;
  headSha: string;
  baseSha: string;
  selfReview?: ReviewOutcome;
  specReview?: ReviewOutcome;
  qualityReview?: ReviewOutcome;
  status:
    | "implementing"
    | "self_review"
    | "spec_review"
    | "quality_review"
    | "fixing"
    | "approved"
    | "blocked";
};

export class TaskReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskReviewError";
  }
}

const SPEC_REVIEWER = "spec-compliance-reviewer";
const QUALITY_REVIEWER = "code-reviewer";
const IMPLEMENTER = "implementer";

export function createLaneReviewState(input: {
  issueId: string;
  baseSha: string;
  headSha: string;
}): LaneReviewState {
  return {
    issueId: input.issueId,
    implementerAgent: IMPLEMENTER,
    headSha: input.headSha,
    baseSha: input.baseSha,
    status: "implementing",
  };
}

/** HEAD_SHA change invalidates reviews that were bound to the old SHA. */
export function noteHeadChange(
  state: LaneReviewState,
  newHeadSha: string,
): LaneReviewState {
  if (newHeadSha === state.headSha) return state;
  return {
    ...state,
    headSha: newHeadSha,
    selfReview: undefined,
    specReview: undefined,
    qualityReview: undefined,
    status: "fixing",
  };
}

function assertSeparateFromImplementer(agentName: string): void {
  if (agentName === IMPLEMENTER) {
    throw new TaskReviewError(
      "Spec/quality reviewers must be separate instances from implementer",
    );
  }
}

export async function runSelfReview(
  wz: Workflowz,
  state: LaneReviewState,
  opts: { model: string },
): Promise<LaneReviewState> {
  const agentName = "implementer-self-review";
  const call = createStrictAgentCall({
    agentName,
    model: opts.model,
    effort: "medium",
    schema: reviewResultSchema,
    schemaMode: "strict",
  });
  const raw = await call(
    wz,
    `Self-review for ${state.issueId} at ${state.headSha}`,
  );
  const v = validateReviewResult(raw);
  if (!v.ok) throw new TaskReviewError(`self-review invalid: ${v.reason}`);
  const r = v.value as { ok: boolean; feedback: string; blocking: string[] };
  const outcome: ReviewOutcome = {
    ...r,
    headShaAtReview: state.headSha,
    kind: "self",
    agentName,
  };
  return {
    ...state,
    selfReview: outcome,
    status: outcome.ok ? "spec_review" : "fixing",
  };
}

export async function runSpecReview(
  wz: Workflowz,
  state: LaneReviewState,
  opts: { model: string; agentName?: string },
): Promise<LaneReviewState> {
  const agentName = opts.agentName ?? SPEC_REVIEWER;
  assertSeparateFromImplementer(agentName);
  if (agentName === state.implementerAgent) {
    throw new TaskReviewError("spec reviewer must not be the implementer");
  }
  const call = createStrictAgentCall({
    agentName,
    model: opts.model,
    effort: "max",
    schema: reviewResultSchema,
    schemaMode: "strict",
  });
  const raw = await call(
    wz,
    `Spec-compliance review for ${state.issueId} range ${state.baseSha}..${state.headSha}`,
  );
  const v = validateReviewResult(raw);
  if (!v.ok) throw new TaskReviewError(`spec-review invalid: ${v.reason}`);
  const r = v.value as { ok: boolean; feedback: string; blocking: string[] };
  const outcome: ReviewOutcome = {
    ...r,
    headShaAtReview: state.headSha,
    kind: "spec",
    agentName,
  };
  if (outcome.headShaAtReview !== state.headSha) {
    throw new TaskReviewError("spec review HEAD_SHA mismatch");
  }
  return {
    ...state,
    specReview: outcome,
    status: outcome.ok ? "quality_review" : "fixing",
  };
}

export async function runQualityReview(
  wz: Workflowz,
  state: LaneReviewState,
  opts: { model: string; agentName?: string },
): Promise<LaneReviewState> {
  const agentName = opts.agentName ?? QUALITY_REVIEWER;
  assertSeparateFromImplementer(agentName);
  if (
    agentName === state.implementerAgent ||
    agentName === state.specReview?.agentName
  ) {
    // quality must be distinct instance; same role name ok if different from implementer
  }
  if (agentName === IMPLEMENTER) {
    throw new TaskReviewError("quality reviewer must not be implementer");
  }
  const call = createStrictAgentCall({
    agentName,
    model: opts.model,
    effort: "max",
    schema: reviewResultSchema,
    schemaMode: "strict",
  });
  const raw = await call(
    wz,
    `Code-quality review for ${state.issueId} at ${state.headSha}`,
  );
  const v = validateReviewResult(raw);
  if (!v.ok) throw new TaskReviewError(`quality-review invalid: ${v.reason}`);
  const r = v.value as { ok: boolean; feedback: string; blocking: string[] };
  const outcome: ReviewOutcome = {
    ...r,
    headShaAtReview: state.headSha,
    kind: "quality",
    agentName,
  };
  return {
    ...state,
    qualityReview: outcome,
    status: outcome.ok ? "approved" : "fixing",
  };
}

/**
 * Full sequence with fix/re-review loops. maxAttempts per gate defaults to 3.
 */
export async function runTaskReviewSequence(
  wz: Workflowz,
  initial: LaneReviewState,
  opts: {
    model: string;
    maxAttempts?: number;
    /** Called when status is fixing — must return new headSha after implementer fix */
    applyFix?: (
      state: LaneReviewState,
      feedback: string,
    ) => Promise<{ headSha: string }>;
  },
): Promise<LaneReviewState> {
  const max = opts.maxAttempts ?? 3;
  let state = { ...initial, status: "self_review" as const };
  let attempts = 0;

  while (attempts < max) {
    attempts++;
    state = await runSelfReview(wz, state, { model: opts.model });
    if (state.status === "fixing") {
      if (!opts.applyFix) break;
      const fixed = await opts.applyFix(state, state.selfReview?.feedback ?? "");
      state = noteHeadChange(state, fixed.headSha);
      continue;
    }

    state = await runSpecReview(wz, state, { model: opts.model });
    if (state.status === "fixing") {
      if (!opts.applyFix) break;
      const fixed = await opts.applyFix(state, state.specReview?.feedback ?? "");
      state = noteHeadChange(state, fixed.headSha);
      continue;
    }

    state = await runQualityReview(wz, state, { model: opts.model });
    if (state.status === "approved") return state;
    if (state.status === "fixing") {
      if (!opts.applyFix) break;
      const fixed = await opts.applyFix(
        state,
        state.qualityReview?.feedback ?? "",
      );
      state = noteHeadChange(state, fixed.headSha);
      continue;
    }
  }

  if (state.status !== "approved") {
    return { ...state, status: "blocked" };
  }
  return state;
}

export function isLaneApproved(state: LaneReviewState): boolean {
  return (
    state.status === "approved" &&
    state.selfReview?.ok === true &&
    state.specReview?.ok === true &&
    state.qualityReview?.ok === true &&
    state.specReview.headShaAtReview === state.headSha &&
    state.qualityReview.headShaAtReview === state.headSha
  );
}
