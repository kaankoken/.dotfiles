import { createHash } from "node:crypto";
import {
  WF7_ROLE_SPECS,
  WF7_TASK_SLOTS,
  type CompletedCapture,
  type ImmutableSnapshot,
  type NativeSingleResult,
  type PrReviewFailureCode,
  type PrReviewStage,
  type PrReviewTaskBinding,
  type ReceiptTaskEvidence,
  type SealedTaskResult,
  type SingleResultEvidence,
  type TaskSlotExpectation,
  type Wf7TaskName,
} from "./contracts";
import type { ReceiptJournal } from "./receipts";
import type { RoleMutationGuard } from "./role-integrity";
import {
  INITIAL_REVIEW_SCHEMA,
  INITIAL_REVIEW_SCHEMA_SHA256,
  JUDGE_RESULT_SCHEMA,
  JUDGE_RESULT_SCHEMA_SHA256,
  REBUTTAL_SCHEMA,
  REBUTTAL_SCHEMA_SHA256,
} from "./schemas";
import type { PrReviewStateStore } from "./state";
import {
  type InitialReview,
  type JudgeResult,
  type Rebuttal,
  validateInitialReview,
  validateJudgeResult,
  validateRebuttal,
} from "./validation";

export interface NativeTaskCallEvent {
  type: "tool_call";
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
  cwd?: string;
}

export interface NativeTaskResultEvent {
  type: "tool_result";
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
  content: unknown[];
  isError: boolean;
  details: unknown;
}

export interface CaptureRoleCheck {
  taskName: Wf7TaskName;
  task: {
    agent: string;
    schemaIdentity: string;
    schemaSha256: string;
  };
  settlement?: {
    agentSource: unknown;
    requestedModel: unknown;
    resolvedModel: unknown;
    resolvedModelIsFallback: unknown;
  };
}

export interface CaptureCoordinatorOptions {
  state: PrReviewStateStore;
  journal: ReceiptJournal;
  guard: RoleMutationGuard;
  snapshot: Readonly<ImmutableSnapshot>;
  callNonces: Readonly<Record<Wf7TaskName, string>>;
  verifyRole: (check: CaptureRoleCheck) => void;
  now?: () => string;
}

export interface CaptureCoordinator {
  readonly status: "active" | "completed" | "failed";
  readonly captureHandle?: string;
}

type StageOutput = InitialReview | Rebuttal | JudgeResult;

type ExpectedSlot = TaskSlotExpectation & {
  prompt: string;
  outputSchema: unknown;
  schemaIdentity: "InitialReview.v1" | "Rebuttal.v1" | "JudgeResult.v1";
};

type PendingCall = {
  toolCallId: string;
  inputDigest: string;
  slots: readonly ExpectedSlot[];
};

type CaptureState = {
  state: PrReviewStateStore;
  journal: ReceiptJournal;
  guard: RoleMutationGuard;
  snapshot: Readonly<ImmutableSnapshot>;
  callNonces: Readonly<Record<Wf7TaskName, string>>;
  verifyRole: CaptureCoordinatorOptions["verifyRole"];
  now: () => string;
  status: "active" | "completed" | "failed";
  captureHandle?: string;
  pending?: PendingCall;
  sealed: Map<Wf7TaskName, Readonly<SealedTaskResult>>;
  outputs: Map<Wf7TaskName, Readonly<StageOutput>>;
};

const PRIVATE = new WeakMap<CaptureCoordinator, CaptureState>();

const STAGE_CONTRACT = {
  initial: {
    context: "WF7 initial review batch v1",
    schema: INITIAL_REVIEW_SCHEMA,
    schemaSha256: INITIAL_REVIEW_SCHEMA_SHA256,
    schemaIdentity: "InitialReview.v1",
  },
  rebuttal: {
    context: "WF7 rebuttal batch v1",
    schema: REBUTTAL_SCHEMA,
    schemaSha256: REBUTTAL_SCHEMA_SHA256,
    schemaIdentity: "Rebuttal.v1",
  },
  judge: {
    context: "WF7 judgment v1",
    schema: JUDGE_RESULT_SCHEMA,
    schemaSha256: JUDGE_RESULT_SCHEMA_SHA256,
    schemaIdentity: "JudgeResult.v1",
  },
} as const;
const TASK_PROMPT_PREFIX = "Complete the assignment below, thoroughly:\n\n";

const REQUIRED_RESULT_KEYS = [
  "index",
  "id",
  "agent",
  "agentSource",
  "task",
  "assignment",
  "exitCode",
  "output",
  "stderr",
  "truncated",
  "durationMs",
  "tokens",
  "requests",
] as const;

const ALLOWED_RESULT_KEYS: Record<string, true> = {
  index: true,
  id: true,
  agent: true,
  agentSource: true,
  task: true,
  exitCode: true,
  output: true,
  stderr: true,
  truncated: true,
  durationMs: true,
  tokens: true,
  requests: true,
  assignment: true,
  description: true,
  lastIntent: true,
  structuredOutput: true,
  contextTokens: true,
  contextWindow: true,
  modelOverride: true,
  resolvedModel: true,
  resolvedModelIsFallback: true,
  error: true,
  aborted: true,
  abortReason: true,
  usage: true,
  outputPath: true,
  patchPath: true,
  branchName: true,
  branchBaseSha: true,
  nestedPatches: true,
  extractedToolData: true,
  retryFailure: true,
  outputMeta: true,
};

const ALLOWED_YIELD_KEYS: Record<string, true> = {
  data: true,
  status: true,
  error: true,
  type: true,
  useLastTurn: true,
  schemaOverridden: true,
};

function privateState(coordinator: CaptureCoordinator): CaptureState {
  const state = PRIVATE.get(coordinator);
  if (!state) throw new Error("unknown capture coordinator");
  return state;
}

function canonicalNormalized(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalNormalized).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalNormalized(object[key])}`
  ).join(",")}}`;
}

function canonicalJson(value: unknown): string {
  return canonicalNormalized(JSON.parse(JSON.stringify(value)));
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function copyAndFreeze<T extends object>(value: T): Readonly<T> {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== "object" || ArrayBuffer.isView(item) || Object.isFrozen(item)) return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
}

function reviewerFor(slot: Wf7TaskName): "fable" | "sol" {
  return slot.includes("fable") ? "fable" : "sol";
}

function stageFor(state: CaptureState): PrReviewStage {
  if (state.sealed.size < 2) return "initial";
  if (state.sealed.size < 4) return "rebuttal";
  return "judge";
}

function outputFor<T extends StageOutput>(state: CaptureState, slot: Wf7TaskName): Readonly<T> {
  const output = state.outputs.get(slot);
  if (!output) throw new Error(`missing sealed output for ${slot}`);
  return output as Readonly<T>;
}

function stageData(state: CaptureState, slot: Wf7TaskName): unknown {
  const stage = WF7_TASK_SLOTS.find((candidate) => candidate.name === slot)?.stage;
  if (stage === "initial") return { reviewer: reviewerFor(slot) };
  if (stage === "rebuttal") {
    const fable = outputFor<InitialReview>(state, "wf7-fable-initial");
    const sol = outputFor<InitialReview>(state, "wf7-sol-initial");
    return slot === "wf7-fable-rebuttal"
      ? { own_initial: fable, peer_initial: sol }
      : { own_initial: sol, peer_initial: fable };
  }
  return {
    initial_reviews: [
      outputFor<InitialReview>(state, "wf7-fable-initial"),
      outputFor<InitialReview>(state, "wf7-sol-initial"),
    ],
    rebuttals: [
      outputFor<Rebuttal>(state, "wf7-fable-rebuttal"),
      outputFor<Rebuttal>(state, "wf7-sol-rebuttal"),
    ],
  };
}

function expectedSlot(state: CaptureState, slotName: Wf7TaskName, toolCallId: string): ExpectedSlot {
  const slot = WF7_TASK_SLOTS.find((candidate) => candidate.name === slotName);
  if (!slot) throw new Error(`unknown task slot ${slotName}`);
  const contract = STAGE_CONTRACT[slot.stage];
  const callNonce = state.callNonces[slot.name];
  if (typeof callNonce !== "string") throw new Error(`missing call nonce for ${slot.name}`);
  const binding: PrReviewTaskBinding = {
    schema_version: 1,
    stage: slot.stage,
    run_nonce: state.snapshot.runNonce,
    snapshot_nonce: state.snapshot.snapshotNonce,
    call_nonce: callNonce,
    snapshot_handle: state.snapshot.snapshotHandle,
    head_sha: state.snapshot.headSha,
    diff_digest: state.snapshot.diffDigest,
    stage_data: stageData(state, slot.name),
  };
  return Object.freeze({
    slot: slot.name,
    stage: slot.stage,
    name: slot.name,
    agent: slot.agent,
    schemaSha256: contract.schemaSha256,
    runNonce: state.snapshot.runNonce,
    snapshotNonce: state.snapshot.snapshotNonce,
    callNonce,
    snapshotHandle: state.snapshot.snapshotHandle,
    headSha: state.snapshot.headSha,
    diffDigest: state.snapshot.diffDigest,
    nativeToolCallId: toolCallId,
    prompt: canonicalJson(binding),
    outputSchema: contract.schema,
    schemaIdentity: contract.schemaIdentity,
  });
}

function expectedInput(state: CaptureState, toolCallId = "pending"): Record<string, unknown> {
  const stage = stageFor(state);
  const names = WF7_TASK_SLOTS.filter((slot) => slot.stage === stage).map((slot) => slot.name);
  const slots = names.map((name) => expectedSlot(state, name, toolCallId));
  const items = slots.map((slot) => ({
    name: slot.name,
    agent: slot.agent,
    task: slot.prompt,
    outputSchema: slot.outputSchema,
    schemaMode: "strict" as const,
    isolated: true as const,
  }));
  return { context: STAGE_CONTRACT[stage].context, tasks: items };
}

function failureCode(error: unknown, fallback: PrReviewFailureCode): PrReviewFailureCode {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code as PrReviewFailureCode;
  }
  return fallback;
}

function failCapture(state: CaptureState, code: PrReviewFailureCode, message: string): void {
  if (state.status !== "active") return;
  state.status = "failed";
  state.pending = undefined;
  try {
    state.guard.stop();
  } catch {
    // A role-integrity or guard failure may already have made the receipt terminal.
  }
  try {
    state.journal.fail(code, message, { mutation_guard_active: false });
  } catch {
    // Preserve the first durable failure when a collaborator already receipted it.
  }
  try {
    state.state.cleanupRun(state.snapshot.runHandle);
  } catch {
    // Handle revocation is best effort only when state was already removed.
  }
}

function receiptEvidence(result: SealedTaskResult): ReceiptTaskEvidence {
  const role = WF7_ROLE_SPECS.find((candidate) => candidate.agent === result.agent)!;
  return {
    stage: result.stage,
    task: result.slot,
    agent: result.agent,
    nonceDigest: createHash("sha256").update(result.callNonce).digest("hex"),
    nativeToolCallId: result.nativeToolCallId,
    nativeResultId: result.nativeResultId,
    agentSource: "user",
    requestedModel: role.model,
    resolvedModel: role.model,
    resolvedModelIsFallback: false,
    schemaSha256: result.schemaSha256,
    structuredOutputSource: "caller",
    structuredOutputMode: "strict",
    structuredOutputStatus: "valid",
    outputDigest: result.outputDigest,
  };
}

function exactResultObject(value: unknown): value is NativeSingleResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    !REQUIRED_RESULT_KEYS.every((key) => key in record)
    || !keys.every((key) => Object.hasOwn(ALLOWED_RESULT_KEYS, key))
  ) {
    return false;
  }
  if (
    !Number.isSafeInteger(record.index)
    || typeof record.id !== "string"
    || record.id.length === 0
    || typeof record.agent !== "string"
    || typeof record.task !== "string"
    || typeof record.output !== "string"
    || typeof record.stderr !== "string"
    || typeof record.truncated !== "boolean"
    || !Number.isSafeInteger(record.exitCode)
    || typeof record.durationMs !== "number"
    || !Number.isFinite(record.durationMs)
    || record.durationMs < 0
    || !Number.isSafeInteger(record.tokens)
    || Number(record.tokens) < 0
    || !Number.isSafeInteger(record.requests)
    || Number(record.requests) < 0
    || (record.agentSource !== "bundled" && record.agentSource !== "user" && record.agentSource !== "project")
  ) return false;
  return true;
}

function hasAuthoritativeTerminalYield(result: NativeSingleResult, structuredData: unknown): boolean {
  const record = result as NativeSingleResult & Record<string, unknown>;
  const extracted = record.extractedToolData;
  if (!extracted || typeof extracted !== "object" || Array.isArray(extracted) || !(("yield") in extracted)) {
    return false;
  }
  const yields = extracted.yield;
  if (!Array.isArray(yields) || yields.length !== 1) return false;
  const terminal = yields[0];
  if (!terminal || typeof terminal !== "object" || Array.isArray(terminal)) return false;
  if (
    Object.keys(terminal).some((key) => !Object.hasOwn(ALLOWED_YIELD_KEYS, key))
    || terminal.status !== "success"
    || !(("data") in terminal)
    || !terminal.data
    || typeof terminal.data !== "object"
    || Array.isArray(terminal.data)
    || terminal.error != null
    || terminal.useLastTurn === true
    || terminal.schemaOverridden === true
    || (terminal.type !== undefined && typeof terminal.type !== "string")
  ) return false;
  try {
    return canonicalJson(terminal.data) === canonicalJson(structuredData);
  } catch {
    return false;
  }
}

function classifyResult(result: NativeSingleResult, slot: ExpectedSlot): PrReviewFailureCode | undefined {
  const idSuffix = result.id.slice(slot.name.length);
  if (
    !result.id.startsWith(slot.name)
    || (idSuffix !== "" && !/^-(?:[2-9]|[1-9]\d+)$/.test(idSuffix))
    || result.agent !== slot.agent
    || result.assignment !== slot.prompt
    || result.task !== `${TASK_PROMPT_PREFIX}${slot.prompt}`
  ) return "task_result_invalid";
  if (result.index !== WF7_TASK_SLOTS.filter((candidate) => candidate.stage === slot.stage).findIndex((candidate) => candidate.name === slot.name)) {
    return "task_result_invalid";
  }
  if (result.agentSource === "project") return "project_shadow";
  if (result.agentSource !== "user") return "route_mismatch";
  const role = WF7_ROLE_SPECS.find((candidate) => candidate.agent === slot.agent)!;
  if (result.resolvedModelIsFallback !== false) return "model_fallback";
  const record = result as NativeSingleResult & Record<string, unknown>;
  if (result.resolvedModel !== role.model || record.modelOverride != null) return "route_mismatch";
  if (result.aborted !== false) return "task_cancelled";
  if (record.retryFailure != null || result.exitCode !== 0 || result.error !== undefined || result.abortReason !== undefined) {
    return "task_failed";
  }
  if (result.stderr !== "") return "task_result_invalid";
  const structured = result.structuredOutput;
  if (
    !structured
    || typeof structured !== "object"
    || Array.isArray(structured)
    || structured.source !== "caller"
    || structured.mode !== "strict"
    || structured.status !== "valid"
    || !(("data") in structured)
    || !structured.data
    || typeof structured.data !== "object"
    || Array.isArray(structured.data)
    || Object.hasOwn(structured, "error")
    || !hasAuthoritativeTerminalYield(result, structured.data)
  ) return "structured_output_invalid";
  return undefined;
}

type OutputValidation =
  | { ok: true; value: StageOutput }
  | { ok: false; code: PrReviewFailureCode; reason: string };

function invalidOutput(reason: string): OutputValidation {
  if (
    /(?:schema_version|run_nonce|snapshot_nonce|call_nonce|head_sha|diff_digest|binding stage|reviewer mismatch)/.test(reason)
  ) return { ok: false, code: "binding_mismatch", reason };
  if (/(?:anchor|range|outside snapshot)/.test(reason)) {
    return { ok: false, code: "anchor_invalid", reason };
  }
  return { ok: false, code: "structured_output_invalid", reason };
}

function validateOutput(state: CaptureState, slot: ExpectedSlot, data: unknown): OutputValidation {
  const binding = JSON.parse(slot.prompt) as PrReviewTaskBinding;
  if (slot.stage === "initial") {
    const validated = validateInitialReview(data, {
      binding,
      reviewer: reviewerFor(slot.name),
      reviewableAnchors: state.snapshot.lineMap,
    });
    return validated.ok ? validated : invalidOutput(validated.reason);
  }
  if (slot.stage === "rebuttal") {
    const reviewer = reviewerFor(slot.name);
    const validated = validateRebuttal(data, {
      binding,
      reviewer,
      reviewableAnchors: state.snapshot.lineMap,
      ownInitial: reviewer === "fable"
        ? outputFor<InitialReview>(state, "wf7-fable-initial")
        : outputFor<InitialReview>(state, "wf7-sol-initial"),
      peerInitial: reviewer === "fable"
        ? outputFor<InitialReview>(state, "wf7-sol-initial")
        : outputFor<InitialReview>(state, "wf7-fable-initial"),
    });
    return validated.ok ? validated : invalidOutput(validated.reason);
  }
  const validated = validateJudgeResult(data, {
    binding,
    reviewableAnchors: state.snapshot.lineMap,
    initialReviews: [
      outputFor<InitialReview>(state, "wf7-fable-initial"),
      outputFor<InitialReview>(state, "wf7-sol-initial"),
    ],
  });
  return validated.ok ? validated : invalidOutput(validated.reason);
}

export function createCaptureCoordinator(options: CaptureCoordinatorOptions): CaptureCoordinator {
  const expectedNames = new Set(WF7_TASK_SLOTS.map((slot) => slot.name));
  const nonceNames = Object.keys(options.callNonces);
  if (
    nonceNames.length !== expectedNames.size
    || nonceNames.some((name) => !expectedNames.has(name as Wf7TaskName))
    || WF7_TASK_SLOTS.some((slot) => typeof options.callNonces[slot.name] !== "string")
  ) throw new Error("capture requires exactly five registered call nonces");
  if (options.state.getRunStatus(options.snapshot.runHandle).stage !== "snapshotted") {
    throw new Error("capture must register at snapshot creation");
  }
  const state: CaptureState = {
    state: options.state,
    journal: options.journal,
    guard: options.guard,
    snapshot: options.snapshot,
    callNonces: Object.freeze({ ...options.callNonces }),
    verifyRole: options.verifyRole,
    now: options.now ?? (() => new Date().toISOString()),
    status: "active",
    sealed: new Map(),
    outputs: new Map(),
  };
  const coordinator: CaptureCoordinator = Object.freeze({
    get status() {
      return state.status;
    },
    get captureHandle() {
      return state.captureHandle;
    },
  });
  PRIVATE.set(coordinator, state);
  return coordinator;
}

export function expectedTaskInput(coordinator: CaptureCoordinator): Readonly<Record<string, unknown>> {
  const state = privateState(coordinator);
  if (state.status !== "active" || state.pending) throw new Error("capture has no next task call");
  return copyAndFreeze(expectedInput(state));
}

export function observeTaskCall(
  coordinator: CaptureCoordinator,
  event: NativeTaskCallEvent,
): void | { block: true; reason: string } {
  const state = privateState(coordinator);
  if (state.status !== "active") return { block: true, reason: "WF7 capture is terminal" };

  const guardResult = state.guard.handleToolCall({
    toolName: event.toolName,
    input: event.input,
    cwd: event.cwd,
  });
  if (guardResult) {
    failCapture(state, "role_mutation_denied", guardResult.reason);
    return guardResult;
  }
  if (event.toolName !== "task") return undefined;
  if (state.pending || !event.toolCallId) {
    failCapture(state, "task_envelope_invalid", "duplicate or unidentifiable WF7 task call");
    return { block: true, reason: "Invalid WF7 task envelope" };
  }

  const expected = expectedInput(state, event.toolCallId);
  if (canonicalJson(event.input) !== canonicalJson(expected)) {
    failCapture(state, "task_envelope_invalid", "WF7 task batch, order, prompt, schema, or override mismatch");
    return { block: true, reason: "Invalid WF7 task envelope" };
  }
  const stage = stageFor(state);
  const names = WF7_TASK_SLOTS.filter((slot) => slot.stage === stage).map((slot) => slot.name);
  const slots = names.map((name) => expectedSlot(state, name, event.toolCallId));
  try {
    for (const slot of slots) {
      state.verifyRole({
        taskName: slot.name,
        task: {
          agent: slot.agent,
          schemaIdentity: slot.schemaIdentity,
          schemaSha256: slot.schemaSha256,
        },
      });
    }
  } catch (error) {
    failCapture(state, failureCode(error, "role_integrity_drift"), error instanceof Error ? error.message : "role check failed");
    return { block: true, reason: "WF7 role integrity check failed" };
  }

  state.state.transitionRun(state.snapshot.runHandle, stage);
  state.pending = Object.freeze({
    toolCallId: event.toolCallId,
    inputDigest: digest(event.input),
    slots: Object.freeze(slots),
  });
  return undefined;
}

export function sealSlot(
  coordinator: CaptureCoordinator,
  slot: ExpectedSlot,
  result: NativeSingleResult,
  output: StageOutput,
): Readonly<SealedTaskResult> | undefined {
  const state = privateState(coordinator);
  if (state.status !== "active" || state.sealed.has(slot.name)) {
    failCapture(state, "task_result_invalid", `duplicate result for ${slot.name}`);
    return undefined;
  }
  const role = WF7_ROLE_SPECS.find((candidate) => candidate.agent === slot.agent)!;
  const evidence: SingleResultEvidence = {
    task: slot.name,
    agent: slot.agent,
    agentSource: "user",
    resolvedModel: role.model,
    resolvedModelIsFallback: false,
    exitCode: 0,
    aborted: false,
    structuredOutput: {
      source: "caller",
      mode: "strict",
      status: "valid",
      data: structuredClone(output),
    },
    schemaValid: true,
  };
  const sealed = copyAndFreeze({
    slot: slot.slot,
    stage: slot.stage,
    name: slot.name,
    agent: slot.agent,
    schemaSha256: slot.schemaSha256,
    runNonce: slot.runNonce,
    snapshotNonce: slot.snapshotNonce,
    callNonce: slot.callNonce,
    snapshotHandle: slot.snapshotHandle,
    headSha: slot.headSha,
    diffDigest: slot.diffDigest,
    nativeToolCallId: slot.nativeToolCallId,
    nativeResultId: result.id,
    result: structuredClone(result),
    evidence,
    outputDigest: digest(result),
  } satisfies SealedTaskResult);
  state.sealed.set(slot.name, sealed);
  state.outputs.set(slot.name, copyAndFreeze(output));
  state.journal.prepare({
    tasks: WF7_TASK_SLOTS.flatMap((candidate) => {
      const captured = state.sealed.get(candidate.name);
      return captured ? [receiptEvidence(captured)] : [];
    }),
  });
  return sealed;
}

export function completeCapture(coordinator: CaptureCoordinator): Readonly<CompletedCapture> | undefined {
  const state = privateState(coordinator);
  if (state.status !== "active" || state.sealed.size !== WF7_TASK_SLOTS.length || state.pending) {
    failCapture(state, "task_result_invalid", "capture completed without exactly five ordered results");
    return undefined;
  }
  const ordered = WF7_TASK_SLOTS.map((slot) => state.sealed.get(slot.name)!);
  try {
    const capture = state.state.completeCapture(state.snapshot.runHandle, ordered, state.now());
    state.guard.stop();
    state.journal.prepare({
      tasks: ordered.map(receiptEvidence),
      mutation_guard_active: false,
      completed_capture_digest: createHash("sha256").update(capture.captureHandle).digest("hex"),
    });
    state.captureHandle = capture.captureHandle;
    state.status = "completed";
    return capture;
  } catch (error) {
    failCapture(state, "internal_error", error instanceof Error ? error.message : "capture completion failed");
    return undefined;
  }
}

export function observeTaskResult(coordinator: CaptureCoordinator, event: NativeTaskResultEvent): void {
  const state = privateState(coordinator);
  if (event.toolName !== "task") return;
  if (state.status !== "active" || !state.pending) {
    failCapture(state, "task_result_invalid", "unexpected or duplicate WF7 task result");
    return;
  }
  const pending = state.pending;
  if (
    event.toolCallId !== pending.toolCallId
    || event.isError
    || digest(event.input) !== pending.inputDigest
    || !event.details
    || typeof event.details !== "object"
    || !("results" in event.details)
    || !Array.isArray(event.details.results)
    || event.details.results.length !== pending.slots.length
  ) {
    failCapture(state, event.isError ? "task_failed" : "task_result_invalid", "WF7 native task result envelope mismatch");
    return;
  }
  const results = event.details.results;
  const ids = new Set<string>();
  const sealedIds = new Set([...state.sealed.values()].map((result) => result.nativeResultId));
  const validated: Array<{ slot: ExpectedSlot; result: NativeSingleResult; output: StageOutput }> = [];
  for (let index = 0; index < pending.slots.length; index += 1) {
    const slot = pending.slots[index]!;
    const raw = results[index];
    if (!exactResultObject(raw) || ids.has(raw.id) || sealedIds.has(raw.id)) {
      failCapture(state, "task_result_invalid", "WF7 task result is malformed, reordered, or duplicated");
      return;
    }
    ids.add(raw.id);
    const invalid = classifyResult(raw, slot);
    if (invalid) {
      failCapture(state, invalid, `WF7 task result contract failed for ${slot.name}`);
      return;
    }
    try {
      const role = WF7_ROLE_SPECS.find((candidate) => candidate.agent === slot.agent)!;
      state.verifyRole({
        taskName: slot.name,
        task: {
          agent: slot.agent,
          schemaIdentity: slot.schemaIdentity,
          schemaSha256: slot.schemaSha256,
        },
        settlement: {
          agentSource: raw.agentSource,
          requestedModel: role.model,
          resolvedModel: raw.resolvedModel,
          resolvedModelIsFallback: raw.resolvedModelIsFallback,
        },
      });
    } catch (error) {
      failCapture(state, failureCode(error, "route_mismatch"), error instanceof Error ? error.message : "role settlement failed");
      return;
    }
    const output = validateOutput(state, slot, raw.structuredOutput!.data);
    if (!output.ok) {
      failCapture(state, output.code, `WF7 structured output failed validation for ${slot.name}: ${output.reason}`);
      return;
    }
    validated.push({ slot, result: raw, output: output.value });
  }

  state.pending = undefined;
  for (const item of validated) {
    if (!sealSlot(coordinator, item.slot, item.result, item.output)) return;
  }
  if (state.sealed.size === WF7_TASK_SLOTS.length) completeCapture(coordinator);
}
