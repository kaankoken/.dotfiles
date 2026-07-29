/**
 * Gate revision policy: rewrites are optional, not a quota.
 *
 * maxAttempts / GATE_BUDGETS are **ceilings** (stop-fail after N tries).
 * A producer rewrite runs **only** when the reviewer returns ok:false
 * (or non-empty blocking findings). First PASS ends the gate immediately —
 * never spawn free-standing "Revision1/2" agents just because budget remains.
 */

export type ReviewLike = {
  ok: boolean;
  feedback?: string;
  blocking?: string[];
};

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
