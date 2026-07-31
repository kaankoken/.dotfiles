import {
  PR_REVIEW_SCHEMA_VERSION,
  type PrReviewTaskBinding,
  type ReviewAnchor,
  type SnapshotReviewableLine,
} from "./contracts";

export type Reviewer = "fable" | "sol";
export type FindingSeverity = "blocking" | "nonblocking";

export interface InitialFinding extends ReviewAnchor {
  id: string;
  severity: FindingSeverity;
  title: string;
  body: string;
  evidence: string;
}

export interface InitialReview {
  schema_version: typeof PR_REVIEW_SCHEMA_VERSION;
  reviewer: Reviewer;
  run_nonce: string;
  snapshot_nonce: string;
  call_nonce: string;
  head_sha: string;
  diff_digest: string;
  findings: InitialFinding[];
}

export type RebuttalResponse =
  | {
      peer_finding_id: string;
      stance: "support" | "oppose";
      rationale: string;
      replacement_body?: never;
    }
  | {
      peer_finding_id: string;
      stance: "refine";
      rationale: string;
      replacement_body?: string;
    };

export interface Rebuttal {
  schema_version: typeof PR_REVIEW_SCHEMA_VERSION;
  reviewer: Reviewer;
  run_nonce: string;
  snapshot_nonce: string;
  call_nonce: string;
  head_sha: string;
  diff_digest: string;
  responses: RebuttalResponse[];
  withdrawn_own_ids: string[];
}

type JudgeAdjudicationBase = {
  source_finding_ids: string[];
  rationale: string;
};

export type JudgeAdjudication =
  | (JudgeAdjudicationBase & {
      decision: "accept" | "request_changes";
      anchor_source_finding_id: string;
      body: string;
    })
  | (JudgeAdjudicationBase & {
      decision: "reject";
      anchor_source_finding_id?: never;
      body?: never;
    });

export interface JudgeResult {
  schema_version: typeof PR_REVIEW_SCHEMA_VERSION;
  run_nonce: string;
  snapshot_nonce: string;
  call_nonce: string;
  head_sha: string;
  diff_digest: string;
  adjudications: JudgeAdjudication[];
  overall_rationale: string;
}

export type PrReviewValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export interface ReviewValidationContext {
  binding: PrReviewTaskBinding;
  reviewableAnchors: readonly SnapshotReviewableLine[];
}

export interface InitialReviewValidationContext extends ReviewValidationContext {
  reviewer: Reviewer;
}

export interface RebuttalValidationContext extends ReviewValidationContext {
  reviewer: Reviewer;
  ownInitial: InitialReview;
  peerInitial: InitialReview;
}

export interface JudgeValidationContext extends ReviewValidationContext {
  initialReviews: readonly [InitialReview, InitialReview];
}

const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CANONICAL_ID = /^(fable|sol):[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HEAD_SHA = /^[0-9a-f]{40}$/;
const DIFF_DIGEST = /^[0-9a-f]{64}$/;
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cf}]/u;
const HIDDEN_MARKER = /<!--|-->/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key));
}

function codePointLength(value: string): number {
  let length = 0;
  for (const _codePoint of value) length++;
  return length;
}

function isBoundedText(value: unknown, maximum: number): value is string {
  if (typeof value !== "string") return false;
  const length = codePointLength(value);
  return (
    length > 0 &&
    length <= maximum &&
    !DISALLOWED_CONTROL.test(value) &&
    !HIDDEN_MARKER.test(value)
  );
}

function isNonce(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const length = codePointLength(value);
  return length >= 32 && length <= 256;
}

function isLine(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 2_147_483_647
  );
}

function bindingError(
  value: Record<string, unknown>,
  context: ReviewValidationContext,
  stage: "initial" | "rebuttal" | "judge",
): string | undefined {
  const expected = context.binding;
  if (expected.stage !== stage) return `binding stage must be ${stage}`;
  if (value.schema_version !== PR_REVIEW_SCHEMA_VERSION) return "schema_version mismatch";
  if (!isNonce(value.run_nonce) || value.run_nonce !== expected.run_nonce) return "run_nonce mismatch";
  if (!isNonce(value.snapshot_nonce) || value.snapshot_nonce !== expected.snapshot_nonce) {
    return "snapshot_nonce mismatch";
  }
  if (!isNonce(value.call_nonce) || value.call_nonce !== expected.call_nonce) return "call_nonce mismatch";
  if (typeof value.head_sha !== "string" || !HEAD_SHA.test(value.head_sha) || value.head_sha !== expected.head_sha) {
    return "head_sha mismatch";
  }
  if (
    typeof value.diff_digest !== "string" ||
    !DIFF_DIGEST.test(value.diff_digest) ||
    value.diff_digest !== expected.diff_digest
  ) {
    return "diff_digest mismatch";
  }
  return undefined;
}

export function canonicalFindingId(reviewer: Reviewer, localId: string): string {
  return `${reviewer}:${localId}`;
}

function anchorPointKey(
  anchor: Pick<ReviewAnchor, "path" | "line" | "side">,
): string {
  return `${anchor.path}\u0000${anchor.line}\u0000${anchor.side}`;
}

function findingError(
  value: unknown,
  reviewer: Reviewer,
  reviewable: ReadonlyMap<string, SnapshotReviewableLine>,
): string | undefined {
  if (!isObject(value)) return "finding not an object";
  if (
    !hasExactKeys(
      value,
      ["id", "path", "line", "side", "severity", "title", "body", "evidence"],
      ["start_line", "start_side"],
    )
  ) {
    return "finding missing or extra fields";
  }
  if (typeof value.id !== "string" || !LOCAL_ID.test(value.id)) return "finding id invalid";
  if (!isBoundedText(value.path, 1024)) return "finding path invalid";
  if (!isLine(value.line)) return "finding line invalid";
  if (value.side !== "LEFT" && value.side !== "RIGHT") return "finding side invalid";
  const end = reviewable.get(
    anchorPointKey({ path: value.path, line: value.line, side: value.side }),
  );
  if (!end) return "finding anchor outside snapshot";
  const hasStartLine = "start_line" in value;
  const hasStartSide = "start_side" in value;
  if (hasStartLine !== hasStartSide) return "finding range fields must be paired";
  if (hasStartLine) {
    if (!isLine(value.start_line)) return "finding start_line invalid";
    if (value.start_side !== value.side) return "finding range must stay on one side";
    if (value.start_line >= value.line) return "finding range must advance";
    const start = reviewable.get(
      anchorPointKey({
        path: value.path,
        line: value.start_line,
        side: value.start_side,
      }),
    );
    if (!start) return "finding range start outside snapshot";
    if (start.hunk !== end.hunk) return "finding range must stay in one hunk";
  }
  if (value.severity !== "blocking" && value.severity !== "nonblocking") return "finding severity invalid";
  if (!isBoundedText(value.title, 256)) return "finding title invalid";
  if (!isBoundedText(value.body, 65_536)) return "finding body invalid";
  if (!isBoundedText(value.evidence, 8_192)) return "finding evidence invalid";
  const canonicalId = canonicalFindingId(reviewer, value.id);
  if (!CANONICAL_ID.test(canonicalId)) return "canonical finding id invalid";
  return undefined;
}

export function validateInitialReview(
  input: unknown,
  context: InitialReviewValidationContext,
): PrReviewValidationResult<InitialReview> {
  if (!isObject(input)) return { ok: false, reason: "initial review not an object" };
  if (
    !hasExactKeys(input, [
      "schema_version",
      "reviewer",
      "run_nonce",
      "snapshot_nonce",
      "call_nonce",
      "head_sha",
      "diff_digest",
      "findings",
    ])
  ) {
    return { ok: false, reason: "initial review missing or extra fields" };
  }
  const mismatch = bindingError(input, context, "initial");
  if (mismatch) return { ok: false, reason: mismatch };
  if (input.reviewer !== context.reviewer) return { ok: false, reason: "reviewer mismatch" };
  if (!Array.isArray(input.findings) || input.findings.length > 100) {
    return { ok: false, reason: "findings must contain 0-100 items" };
  }
  const reviewable = new Map(
    context.reviewableAnchors.map((anchor) => [anchorPointKey(anchor), anchor]),
  );
  const canonicalIds = new Set<string>();
  for (const finding of input.findings) {
    const reason = findingError(finding, context.reviewer, reviewable);
    if (reason) return { ok: false, reason };
    const id = canonicalFindingId(context.reviewer, finding.id as string);
    if (canonicalIds.has(id)) return { ok: false, reason: "duplicate canonical finding id" };
    canonicalIds.add(id);
  }
  return { ok: true, value: input as unknown as InitialReview };
}

function canonicalIds(review: InitialReview): Set<string> {
  return new Set(review.findings.map((finding) => canonicalFindingId(review.reviewer, finding.id)));
}

export function validateRebuttal(
  input: unknown,
  context: RebuttalValidationContext,
): PrReviewValidationResult<Rebuttal> {
  if (!isObject(input)) return { ok: false, reason: "rebuttal not an object" };
  if (
    !hasExactKeys(input, [
      "schema_version",
      "reviewer",
      "run_nonce",
      "snapshot_nonce",
      "call_nonce",
      "head_sha",
      "diff_digest",
      "responses",
      "withdrawn_own_ids",
    ])
  ) {
    return { ok: false, reason: "rebuttal missing or extra fields" };
  }
  const mismatch = bindingError(input, context, "rebuttal");
  if (mismatch) return { ok: false, reason: mismatch };
  if (
    input.reviewer !== context.reviewer ||
    context.ownInitial.reviewer !== context.reviewer ||
    context.peerInitial.reviewer === context.reviewer
  ) {
    return { ok: false, reason: "reviewer inputs mismatch" };
  }
  if (!Array.isArray(input.responses) || input.responses.length > 100) {
    return { ok: false, reason: "responses must contain 0-100 items" };
  }
  if (!Array.isArray(input.withdrawn_own_ids) || input.withdrawn_own_ids.length > 100) {
    return { ok: false, reason: "withdrawn_own_ids must contain 0-100 items" };
  }

  const expectedPeerIds = canonicalIds(context.peerInitial);
  const responseIds = new Set<string>();
  for (const response of input.responses) {
    if (!isObject(response)) return { ok: false, reason: "response not an object" };
    if (!hasExactKeys(response, ["peer_finding_id", "stance", "rationale"], ["replacement_body"])) {
      return { ok: false, reason: "response missing or extra fields" };
    }
    if (typeof response.peer_finding_id !== "string" || !CANONICAL_ID.test(response.peer_finding_id)) {
      return { ok: false, reason: "peer finding id invalid" };
    }
    if (!expectedPeerIds.has(response.peer_finding_id)) return { ok: false, reason: "unknown peer finding id" };
    if (responseIds.has(response.peer_finding_id)) return { ok: false, reason: "duplicate peer response" };
    responseIds.add(response.peer_finding_id);
    if (response.stance !== "support" && response.stance !== "oppose" && response.stance !== "refine") {
      return { ok: false, reason: "response stance invalid" };
    }
    if (!isBoundedText(response.rationale, 8_192)) return { ok: false, reason: "response rationale invalid" };
    if (response.stance !== "refine" && "replacement_body" in response) {
      return { ok: false, reason: "replacement_body requires refine" };
    }
    if ("replacement_body" in response && !isBoundedText(response.replacement_body, 65_536)) {
      return { ok: false, reason: "replacement_body invalid" };
    }
  }
  if (responseIds.size !== expectedPeerIds.size) return { ok: false, reason: "peer response coverage mismatch" };

  const ownIds = canonicalIds(context.ownInitial);
  const withdrawn = new Set<string>();
  for (const id of input.withdrawn_own_ids) {
    if (typeof id !== "string" || !CANONICAL_ID.test(id) || !ownIds.has(id)) {
      return { ok: false, reason: "withdrawn id is not an own finding" };
    }
    if (withdrawn.has(id)) return { ok: false, reason: "duplicate withdrawn id" };
    withdrawn.add(id);
  }
  return { ok: true, value: input as unknown as Rebuttal };
}

export function validateJudgeResult(
  input: unknown,
  context: JudgeValidationContext,
): PrReviewValidationResult<JudgeResult> {
  if (!isObject(input)) return { ok: false, reason: "judge result not an object" };
  if (
    !hasExactKeys(input, [
      "schema_version",
      "run_nonce",
      "snapshot_nonce",
      "call_nonce",
      "head_sha",
      "diff_digest",
      "adjudications",
      "overall_rationale",
    ])
  ) {
    return { ok: false, reason: "judge result missing or extra fields" };
  }
  const mismatch = bindingError(input, context, "judge");
  if (mismatch) return { ok: false, reason: mismatch };
  if (!isBoundedText(input.overall_rationale, 8_192)) {
    return { ok: false, reason: "overall rationale invalid" };
  }
  if (!Array.isArray(input.adjudications) || input.adjudications.length > 200) {
    return { ok: false, reason: "adjudications must contain 0-200 items" };
  }
  const [first, second] = context.initialReviews;
  if (first.reviewer === second.reviewer) return { ok: false, reason: "initial reviewers must be distinct" };
  const candidates = new Map<string, InitialFinding>();
  for (const review of context.initialReviews) {
    for (const finding of review.findings) {
      const id = canonicalFindingId(review.reviewer, finding.id);
      if (candidates.has(id)) return { ok: false, reason: "duplicate canonical candidate id" };
      candidates.set(id, finding);
    }
  }

  const partition = new Set<string>();
  for (const adjudication of input.adjudications) {
    if (!isObject(adjudication)) return { ok: false, reason: "adjudication not an object" };
    if (
      !hasExactKeys(
        adjudication,
        ["source_finding_ids", "decision", "rationale"],
        ["anchor_source_finding_id", "body"],
      )
    ) {
      return { ok: false, reason: "adjudication missing or extra fields" };
    }
    if (
      !Array.isArray(adjudication.source_finding_ids) ||
      adjudication.source_finding_ids.length === 0 ||
      adjudication.source_finding_ids.length > 200
    ) {
      return { ok: false, reason: "source finding group invalid" };
    }
    const group = new Set<string>();
    for (const id of adjudication.source_finding_ids) {
      if (typeof id !== "string" || !CANONICAL_ID.test(id) || !candidates.has(id)) {
        return { ok: false, reason: "source finding id unknown" };
      }
      if (group.has(id)) return { ok: false, reason: "duplicate source id in group" };
      if (partition.has(id)) return { ok: false, reason: "source id appears in multiple groups" };
      group.add(id);
      partition.add(id);
    }
    if (
      adjudication.decision !== "accept" &&
      adjudication.decision !== "reject" &&
      adjudication.decision !== "request_changes"
    ) {
      return { ok: false, reason: "decision invalid" };
    }
    if (!isBoundedText(adjudication.rationale, 8_192)) {
      return { ok: false, reason: "adjudication rationale invalid" };
    }
    if (adjudication.decision === "reject") {
      if ("anchor_source_finding_id" in adjudication || "body" in adjudication) {
        return { ok: false, reason: "reject must not contain anchor or body" };
      }
      continue;
    }
    if (
      typeof adjudication.anchor_source_finding_id !== "string" ||
      !group.has(adjudication.anchor_source_finding_id)
    ) {
      return { ok: false, reason: "anchor source must belong to source group" };
    }
    if (!isBoundedText(adjudication.body, 65_536)) {
      return { ok: false, reason: "publishable body invalid" };
    }
  }
  if (partition.size !== candidates.size) return { ok: false, reason: "source ids do not partition candidates" };
  return { ok: true, value: input as unknown as JudgeResult };
}
