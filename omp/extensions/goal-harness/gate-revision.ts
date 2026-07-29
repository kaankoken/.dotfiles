/**
 * Gate revision policy: rewrites are optional, not a quota.
 *
 * maxAttempts / GATE_BUDGETS are **ceilings** (stop-fail after N tries).
 * A producer rewrite runs **only** when the reviewer returns ok:false
 * (or non-empty blocking findings). First PASS ends the gate immediately —
 * never spawn free-standing "Revision1/2" agents just because budget remains.
 *
 * Human/agent prompts: `agents/REVIEW-POLICY.md` — default PASS; blocking only
 * for wrong / impossible / unsafe / unverifiable-core / hard dep gap.
 * Thoroughness and early-evidence preferences are nits (ok:true, feedback only).
 */

export type ReviewLike = {
  ok: boolean;
  feedback?: string;
  blocking?: string[];
};

/** Classes that may appear in blocking[] (documentation + tests). */
export const BLOCKING_CLASSES = [
  "wrong-contradictory",
  "impossible-to-implement",
  "unsafe",
  "unverifiable-core",
  "hard-dependency-gap",
] as const;

/** Feedback-only categories — must never alone force ok:false. */
export const NIT_ONLY_CLASSES = [
  "early-exhaustive-evidence",
  "more-thoroughness",
  "style-docs",
  "process-theater",
  "task-count-aesthetics",
  "optional-tooling-polish",
  "deferred-follow-up",
] as const;

/**
 * True only when the producer must rewrite for this gate.
 * ok:true → no revision, even if feedback has nits.
 * ok:false → revision required (use blocking + feedback).
 */
export function reviewRequiresRevision(review: ReviewLike): boolean {
  if (review.ok === true) return false;
  return true;
}

/** Format reviewer failure for the next producer call (empty when no revision). */
export function formatRevisionFeedback(review: ReviewLike): string | undefined {
  if (!reviewRequiresRevision(review)) return undefined;
  const blocking = (review.blocking ?? []).filter(Boolean);
  const parts = [
    review.feedback?.trim(),
    blocking.length ? `blocking: ${blocking.join("; ")}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("\n") : "Reviewer returned ok:false (no details).";
}
