import { createHash } from "node:crypto";
import {
  PR_REVIEW_MARKER_NAMESPACE,
  PR_REVIEW_PROTOCOL_VERSION,
  PR_REVIEW_SCHEMA_VERSION,
  PR_REVIEW_SUMMARY_BODIES,
  WF7_ROLE_SPECS,
  WF7_TASK_SLOTS,
  type CompletedCapture,
  type PrReviewTaskBinding,
  type ReviewAnchor,
  type SealedTaskResult,
  type SnapshotReviewableLine,
} from "./contracts";
import { validateAnchor } from "./line-map";
import {
  INITIAL_REVIEW_SCHEMA_SHA256,
  JUDGE_RESULT_SCHEMA_SHA256,
  REBUTTAL_SCHEMA_SHA256,
} from "./schemas";
import {
  canonicalFindingId,
  validateInitialReview,
  validateJudgeResult,
  validateRebuttal,
  type InitialFinding,
  type InitialReview,
  type JudgeAdjudication,
  type JudgeResult,
  type Rebuttal,
} from "./validation";

export type ReviewEvent = keyof typeof PR_REVIEW_SUMMARY_BODIES;

export interface ReviewPlanComment extends ReviewAnchor {
  body: string;
}

export interface ReviewPayload {
  commit_id: string;
  event: ReviewEvent;
  body: string;
  comments: readonly ReviewPlanComment[];
}

export interface PlannedFinding {
  key: string;
  marker: string;
  decision: "accept" | "request_changes";
  sourceFindingIds: readonly string[];
}

export interface ReviewPlan {
  runKey: string;
  runMarker: string;
  event: ReviewEvent;
  findings: readonly PlannedFinding[];
  adjudicationCounts: Readonly<{
    accept: number;
    reject: number;
    request_changes: number;
  }>;
  payload: Readonly<ReviewPayload>;
  payloadDigest: string;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type PublishableAdjudication = Extract<JudgeAdjudication, { decision: "accept" | "request_changes" }>;

type BuiltFinding = PlannedFinding & {
  anchor: ReviewAnchor;
  body: string;
};

const HEAD_SHA = /^[0-9a-f]{40}$/;
const DIFF_DIGEST = /^[0-9a-f]{64}$/;
const MAX_GITHUB_BODY = 65_536;

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(",")}}`;
}

function sha256(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function codePointLength(value: string): number {
  let length = 0;
  for (const _codePoint of value) length += 1;
  return length;
}

function hasValidUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function isOpaque(value: unknown): value is string {
  return typeof value === "string" && codePointLength(value) >= 32 && codePointLength(value) <= 256;
}

function schemaHash(stage: SealedTaskResult["stage"]): string {
  if (stage === "initial") return INITIAL_REVIEW_SCHEMA_SHA256;
  if (stage === "rebuttal") return REBUTTAL_SCHEMA_SHA256;
  return JUDGE_RESULT_SCHEMA_SHA256;
}

function assertSnapshot(capture: CompletedCapture): void {
  const snapshot = capture.snapshot;
  if (
    !isOpaque(capture.captureHandle)
    || !snapshot
    || !isOpaque(snapshot.runHandle)
    || !isOpaque(snapshot.snapshotHandle)
    || !isOpaque(snapshot.runNonce)
    || !isOpaque(snapshot.snapshotNonce)
    || typeof snapshot.repositoryNodeId !== "string"
    || snapshot.repositoryNodeId.length === 0
    || !hasValidUnicode(snapshot.repositoryNodeId)
    || !Number.isInteger(snapshot.pullNumber)
    || snapshot.pullNumber < 1
    || !HEAD_SHA.test(snapshot.headSha)
    || !DIFF_DIGEST.test(snapshot.diffDigest)
    || !Array.isArray(snapshot.lineMap)
    || !Array.isArray(capture.results)
    || capture.results.length !== WF7_TASK_SLOTS.length
  ) throw new Error("completed capture is invalid");
}

function capturedOutput(
  capture: CompletedCapture,
  index: number,
  callNonces: Set<string>,
): unknown {
  const snapshot = capture.snapshot;
  const expected = WF7_TASK_SLOTS[index]!;
  const sealed = capture.results[index];
  const role = WF7_ROLE_SPECS.find((candidate) => candidate.agent === expected.agent)!;
  if (
    !sealed
    || sealed.slot !== expected.name
    || sealed.name !== expected.name
    || sealed.stage !== expected.stage
    || sealed.agent !== expected.agent
    || sealed.schemaSha256 !== schemaHash(expected.stage)
    || sealed.runNonce !== snapshot.runNonce
    || sealed.snapshotNonce !== snapshot.snapshotNonce
    || !isOpaque(sealed.callNonce)
    || callNonces.has(sealed.callNonce)
    || sealed.snapshotHandle !== snapshot.snapshotHandle
    || sealed.headSha !== snapshot.headSha
    || sealed.diffDigest !== snapshot.diffDigest
    || sealed.nativeResultId !== sealed.result?.id
    || sealed.result.agent !== expected.agent
    || sealed.result.agentSource !== "user"
    || sealed.result.resolvedModel !== role.model
    || sealed.result.resolvedModelIsFallback !== false
    || sealed.result.exitCode !== 0
    || sealed.result.aborted !== false
    || sealed.result.stderr !== ""
  ) throw new Error(`capture slot mismatch at ${expected.name}`);
  callNonces.add(sealed.callNonce);

  const evidence = sealed.evidence;
  const nativeStructured = sealed.result.structuredOutput;
  if (
    evidence?.task !== expected.name
    || evidence.agent !== expected.agent
    || evidence.agentSource !== "user"
    || evidence.resolvedModel !== role.model
    || evidence.resolvedModelIsFallback !== false
    || evidence.exitCode !== 0
    || evidence.aborted !== false
    || evidence.schemaValid !== true
    || evidence.structuredOutput?.source !== "caller"
    || evidence.structuredOutput.mode !== "strict"
    || evidence.structuredOutput.status !== "valid"
    || !("data" in evidence.structuredOutput)
    || nativeStructured?.source !== "caller"
    || nativeStructured.mode !== "strict"
    || nativeStructured.status !== "valid"
    || !("data" in nativeStructured)
  ) throw new Error(`capture evidence mismatch at ${expected.name}`);

  let evidenceData: string;
  let nativeData: string;
  try {
    evidenceData = canonicalJson(evidence.structuredOutput.data as JsonValue);
    nativeData = canonicalJson(nativeStructured.data as JsonValue);
  } catch {
    throw new Error(`capture output is not canonical JSON at ${expected.name}`);
  }
  if (evidenceData !== nativeData) throw new Error(`capture output mismatch at ${expected.name}`);
  return evidence.structuredOutput.data;
}

function binding(result: SealedTaskResult): PrReviewTaskBinding {
  return {
    schema_version: PR_REVIEW_SCHEMA_VERSION,
    stage: result.stage,
    run_nonce: result.runNonce,
    snapshot_nonce: result.snapshotNonce,
    call_nonce: result.callNonce,
    snapshot_handle: result.snapshotHandle,
    head_sha: result.headSha,
    diff_digest: result.diffDigest,
    stage_data: null,
  };
}

function validatedOutputs(capture: CompletedCapture): readonly [InitialReview, InitialReview, Rebuttal, Rebuttal, JudgeResult] {
  assertSnapshot(capture);
  const callNonces = new Set<string>();
  const outputs = WF7_TASK_SLOTS.map((_slot, index) => capturedOutput(capture, index, callNonces));
  const reviewableAnchors = capture.snapshot.lineMap;

  const fable = validateInitialReview(outputs[0], {
    binding: binding(capture.results[0]),
    reviewer: "fable",
    reviewableAnchors,
  });
  if (!fable.ok) throw new Error(fable.reason);
  const sol = validateInitialReview(outputs[1], {
    binding: binding(capture.results[1]),
    reviewer: "sol",
    reviewableAnchors,
  });
  if (!sol.ok) throw new Error(sol.reason);

  const fableRebuttal = validateRebuttal(outputs[2], {
    binding: binding(capture.results[2]),
    reviewer: "fable",
    reviewableAnchors,
    ownInitial: fable.value,
    peerInitial: sol.value,
  });
  if (!fableRebuttal.ok) throw new Error(fableRebuttal.reason);
  const solRebuttal = validateRebuttal(outputs[3], {
    binding: binding(capture.results[3]),
    reviewer: "sol",
    reviewableAnchors,
    ownInitial: sol.value,
    peerInitial: fable.value,
  });
  if (!solRebuttal.ok) throw new Error(solRebuttal.reason);

  const judge = validateJudgeResult(outputs[4], {
    binding: binding(capture.results[4]),
    reviewableAnchors,
    initialReviews: [fable.value, sol.value],
  });
  if (!judge.ok) throw new Error(judge.reason);
  return [fable.value, sol.value, fableRebuttal.value, solRebuttal.value, judge.value];
}

function exactAnchor(finding: InitialFinding, lineMap: readonly SnapshotReviewableLine[]): ReviewAnchor {
  const anchor: ReviewAnchor = {
    path: finding.path,
    line: finding.line,
    side: finding.side,
    ...(finding.start_line === undefined ? {} : {
      start_line: finding.start_line,
      start_side: finding.start_side,
    }),
  };
  if (!hasValidUnicode(anchor.path) || !validateAnchor(anchor, lineMap)) {
    throw new Error("selected anchor is invalid");
  }
  return anchor;
}

function normalizedBody(body: string): string {
  if (!hasValidUnicode(body)) throw new Error("publishable body has invalid Unicode");
  return body.replace(/\r\n?/g, "\n").normalize("NFC");
}

function findingPlan(
  runKey: string,
  adjudication: PublishableAdjudication,
  candidates: ReadonlyMap<string, InitialFinding>,
  lineMap: readonly SnapshotReviewableLine[],
): BuiltFinding {
  const source = candidates.get(adjudication.anchor_source_finding_id);
  if (!source) throw new Error("anchor source is missing from captured candidates");
  const anchor = exactAnchor(source, lineMap);
  const sourceFindingIds = Object.freeze([...adjudication.source_finding_ids].sort());
  const key = sha256([
    runKey,
    anchor as { [key: string]: JsonValue },
    normalizedBody(adjudication.body),
    sourceFindingIds as string[],
  ]);
  const marker = `<!-- ${PR_REVIEW_MARKER_NAMESPACE}:finding:${key} -->`;
  const body = `${adjudication.body}\n\n${marker}`;
  if (codePointLength(body) > MAX_GITHUB_BODY) {
    throw new Error("publishable body length exceeds GitHub limit after marker");
  }
  return Object.freeze({
    key,
    marker,
    decision: adjudication.decision,
    sourceFindingIds,
    anchor: Object.freeze(anchor),
    body,
  });
}


export function buildReviewPlanFromCapture(capture: CompletedCapture): Readonly<ReviewPlan> {
  const [fable, sol, _fableRebuttal, _solRebuttal, judge] = validatedOutputs(capture);
  const candidates = new Map<string, InitialFinding>();
  for (const review of [fable, sol]) {
    for (const finding of review.findings) candidates.set(canonicalFindingId(review.reviewer, finding.id), finding);
  }

  const runKey = sha256([
    PR_REVIEW_PROTOCOL_VERSION,
    capture.snapshot.repositoryNodeId,
    capture.snapshot.pullNumber,
    capture.snapshot.headSha,
  ]);
  const runMarker = `<!-- ${PR_REVIEW_MARKER_NAMESPACE}:run:${runKey} -->`;
  const counts = { accept: 0, reject: 0, request_changes: 0 };
  const built: BuiltFinding[] = [];
  for (const adjudication of judge.adjudications) {
    counts[adjudication.decision] += 1;
    if (adjudication.decision !== "reject") {
      built.push(findingPlan(runKey, adjudication, candidates, capture.snapshot.lineMap));
    }
  }
  built.sort((left, right) => left.key.localeCompare(right.key));
  const event: ReviewEvent = counts.request_changes > 0
    ? "REQUEST_CHANGES"
    : counts.accept > 0
    ? "COMMENT"
    : "APPROVE";
  const findings: readonly PlannedFinding[] = Object.freeze(built.map((item) => Object.freeze({
    key: item.key,
    marker: item.marker,
    decision: item.decision,
    sourceFindingIds: item.sourceFindingIds,
  })));
  const comments: readonly ReviewPlanComment[] = Object.freeze(built.map((item) => Object.freeze({
    ...item.anchor,
    body: item.body,
  })));
  const payload: Readonly<ReviewPayload> = Object.freeze({
    commit_id: capture.snapshot.headSha,
    event,
    body: `${PR_REVIEW_SUMMARY_BODIES[event]}\n\n${runMarker}`,
    comments,
  });
  const adjudicationCounts = Object.freeze(counts);

  return Object.freeze({
    runKey,
    runMarker,
    event,
    findings,
    adjudicationCounts,
    payload,
    payloadDigest: sha256(payload as unknown as { [key: string]: JsonValue }),
  });
}
