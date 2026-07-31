import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCaptureCoordinator,
  expectedTaskInput,
  observeTaskCall,
  observeTaskResult,
  type CaptureCoordinator,
  type NativeTaskCallEvent,
  type NativeTaskResultEvent,
} from "../extensions/pr-review/capture";
import {
  WF7_TASK_SLOTS,
  type NativeSingleResult,
  type PrReviewFailureCode,
  type PrReviewTaskBinding,
  type Wf7TaskName,
} from "../extensions/pr-review/contracts";
import { ReceiptJournal } from "../extensions/pr-review/receipts";
import type { RoleMutationGuard } from "../extensions/pr-review/role-integrity";
import { PrReviewStateStore } from "../extensions/pr-review/state";

const HEAD = "a".repeat(40);
const DIFF = "b".repeat(64);
const ROLE_DIGEST = "c".repeat(64);
const NOW = "2026-07-31T12:00:00.000Z";
const TASK_WRAPPER = "Complete the assignment below, thoroughly:\n\n";

type Harness = {
  coordinator: CaptureCoordinator;
  state: PrReviewStateStore;
  runHandle: string;
  guard: RoleMutationGuard;
  journal: ReceiptJournal;
};
type NativeYield = {
  data?: unknown;
  status?: "success" | "aborted";
  error?: string;
  type?: string | string[];
  useLastTurn?: boolean;
  schemaOverridden?: boolean;
};

type CaptureResult = NativeSingleResult & {
  extractedToolData?: Record<string, unknown[]>;
  retryFailure?: { attempt: number; errorMessage: string };
};


function harness(options: { mutationBlocked?: boolean } = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), "wf7-capture-"));
  const state = new PrReviewStateStore({ rootDir: join(root, "runs") });
  const run = state.startRun();
  const snapshot = state.storeSnapshot(run.runHandle, {
    owner: "acme",
    repo: "widgets",
    pullNumber: 42,
    repositoryNodeId: "R_widget",
    baseSha: "d".repeat(40),
    headSha: HEAD,
    diffBytes: new TextEncoder().encode("@@ -1 +1 @@\n-old\n+new\n"),
    changedFiles: [{ path: "src/a.ts", status: "modified", patchComplete: true, reviewable: true }],
    lineMap: [
      { path: "src/a.ts", line: 1, side: "LEFT", hunk: 0 },
      { path: "src/a.ts", line: 1, side: "RIGHT", hunk: 0 },
    ],
    nonreviewableEntries: [],
  });
  const callNonces = Object.fromEntries(
    WF7_TASK_SLOTS.map((slot) => [slot.name, state.mintCallNonce(run.runHandle, slot.name)]),
  ) as Record<Wf7TaskName, string>;
  const journal = ReceiptJournal.start({
    rootDir: join(root, "receipts"),
    provisionalId: "capture",
    owner: "acme",
    repo: "widgets",
    pullNumber: 42,
    roleManifestDigest: ROLE_DIGEST,
    now: () => NOW,
  });
  journal.promoteToHead({ head_sha: HEAD, repositoryNodeId: "R_widget" });
  let active = true;
  const guard: RoleMutationGuard = {
    get active() {
      return active;
    },
    handleToolCall(event) {
      if (active && options.mutationBlocked && event.toolName === "write") {
        active = false;
        return { block: true, reason: "WF7 role mutation denied" };
      }
      return undefined;
    },
    stop() {
      active = false;
    },
  };
  const coordinator = createCaptureCoordinator({
    state,
    journal,
    guard,
    snapshot,
    callNonces,
    verifyRole: () => undefined,
    now: () => NOW,
  });
  return { coordinator, state, runHandle: run.runHandle, guard, journal };
}

function taskCall(coordinator: CaptureCoordinator, id: string): NativeTaskCallEvent {
  return {
    type: "tool_call",
    toolName: "task",
    toolCallId: id,
    input: structuredClone(expectedTaskInput(coordinator)),
  };
}

function itemBindings(event: NativeTaskCallEvent): PrReviewTaskBinding[] {
  const input = event.input as Record<string, unknown>;
  const items = Array.isArray(input.tasks) ? input.tasks : [input];
  return items.map((item) => JSON.parse((item as { task: string }).task) as PrReviewTaskBinding);
}

function initialData(binding: PrReviewTaskBinding, reviewer: "fable" | "sol") {
  return {
    schema_version: 1,
    reviewer,
    run_nonce: binding.run_nonce,
    snapshot_nonce: binding.snapshot_nonce,
    call_nonce: binding.call_nonce,
    head_sha: binding.head_sha,
    diff_digest: binding.diff_digest,
    findings: [{
      id: `${reviewer}-1`,
      path: "src/a.ts",
      line: 1,
      side: "RIGHT",
      severity: reviewer === "fable" ? "blocking" : "nonblocking",
      title: `${reviewer} finding`,
      body: `${reviewer} body`,
      evidence: `${reviewer} evidence`,
    }],
  };
}

function rebuttalData(binding: PrReviewTaskBinding, reviewer: "fable" | "sol") {
  const peer = reviewer === "fable" ? "sol:sol-1" : "fable:fable-1";
  return {
    schema_version: 1,
    reviewer,
    run_nonce: binding.run_nonce,
    snapshot_nonce: binding.snapshot_nonce,
    call_nonce: binding.call_nonce,
    head_sha: binding.head_sha,
    diff_digest: binding.diff_digest,
    responses: [{ peer_finding_id: peer, stance: "support", rationale: "confirmed" }],
    withdrawn_own_ids: [],
  };
}

function judgeData(binding: PrReviewTaskBinding) {
  return {
    schema_version: 1,
    run_nonce: binding.run_nonce,
    snapshot_nonce: binding.snapshot_nonce,
    call_nonce: binding.call_nonce,
    head_sha: binding.head_sha,
    diff_digest: binding.diff_digest,
    adjudications: [
      {
        source_finding_ids: ["fable:fable-1"],
        decision: "request_changes",
        rationale: "blocking",
        anchor_source_finding_id: "fable:fable-1",
        body: "fix this",
      },
      {
        source_finding_ids: ["sol:sol-1"],
        decision: "accept",
        rationale: "useful",
        anchor_source_finding_id: "sol:sol-1",
        body: "consider this",
      },
    ],
    overall_rationale: "complete partition",
  };
}

function validResults(event: NativeTaskCallEvent): CaptureResult[] {
  const input = event.input as Record<string, unknown>;
  const items = (Array.isArray(input.tasks) ? input.tasks : [input]) as Array<Record<string, unknown>>;
  const bindings = itemBindings(event);
  return items.map((item, index) => {
    const name = item.name as Wf7TaskName;
    const binding = bindings[index]!;
    const data = binding.stage === "initial"
      ? initialData(binding, name.includes("fable") ? "fable" : "sol")
      : binding.stage === "rebuttal"
      ? rebuttalData(binding, name.includes("fable") ? "fable" : "sol")
      : judgeData(binding);
    const model = name.includes("fable")
      ? "anthropic/claude-fable-5:max"
      : name.includes("sol")
      ? "openai-codex/gpt-5.6-sol:xhigh"
      : "xai-oauth/grok-4.5:xhigh";
    return {
      index,
      id: `${name}-2`,
      agent: item.agent as string,
      agentSource: "user",
      assignment: item.task as string,
      task: `${TASK_WRAPPER}${item.task as string}`,
      exitCode: 0,
      output: "presentation text is not capture authority",
      stderr: "",
      truncated: true,
      durationMs: 1,
      tokens: 1,
      requests: 1,
      modelOverride: undefined,
      resolvedModel: model,
      resolvedModelIsFallback: false,
      retryFailure: undefined,
      aborted: false,
      structuredOutput: { source: "caller", mode: "strict", status: "valid", data },
      extractedToolData: {
        yield: [{ status: "success", type: "result", data, error: undefined }] satisfies NativeYield[],
      },
    };
  });
}

function taskResult(call: NativeTaskCallEvent, results = validResults(call)): NativeTaskResultEvent {
  return {
    type: "tool_result",
    toolName: "task",
    toolCallId: call.toolCallId,
    input: structuredClone(call.input),
    content: [],
    isError: false,
    details: { results, totalDurationMs: 1 },
  };
}

function settleNext(coordinator: CaptureCoordinator, id: string): NativeTaskCallEvent {
  const call = taskCall(coordinator, id);
  expect(observeTaskCall(coordinator, call)).toBeUndefined();
  observeTaskResult(coordinator, taskResult(call));
  return call;
}

function failedReceipt(journal: ReceiptJournal, code?: PrReviewFailureCode) {
  const receipt = JSON.parse(readFileSync(journal.receiptPath, "utf8"));
  expect(receipt.status).toBe("failed");
  if (code) expect(receipt.failure_code).toBe(code);
  expect(receipt.completed_capture_digest).toBeUndefined();
  return receipt;
}

function expectFailed(h: Harness, code?: PrReviewFailureCode) {
  failedReceipt(h.journal, code);
  expect(h.guard.active).toBe(false);
  expect(() => h.state.getRunStatus(h.runHandle)).toThrow("unknown run handle");
  expect(h.coordinator.status).toBe("failed");
  expect(h.coordinator.captureHandle).toBeUndefined();
}

describe("exact five-result capture", () => {
  test("seals two initial, two rebuttal, and one judge result before exposing completed status", () => {
    const h = harness();
    settleNext(h.coordinator, "call-initial");
    settleNext(h.coordinator, "call-rebuttal");
    const judgeInput = expectedTaskInput(h.coordinator);
    expect(Object.keys(judgeInput).sort()).toEqual(["context", "tasks"]);
    expect(judgeInput.tasks).toHaveLength(1);
    settleNext(h.coordinator, "call-judge");

    expect(h.coordinator.status).toBe("completed");
    expect(h.coordinator.captureHandle).toHaveLength(43);
    expect(h.guard.active).toBe(false);
    expect(h.state.getRunStatus(h.runHandle)).toEqual({
      stage: "captured",
      captureHandle: h.coordinator.captureHandle,
    });
    const capture = h.state.lookupCapture(h.coordinator.captureHandle!);
    expect(capture.results.map((result) => result.slot)).toEqual(WF7_TASK_SLOTS.map((slot) => slot.name));
    expect(capture.results.map((result) => result.nativeToolCallId)).toEqual([
      "call-initial",
      "call-initial",
      "call-rebuttal",
      "call-rebuttal",
      "call-judge",
    ]);
    expect(capture.results.map((result) => result.nativeResultId)).toEqual(
      WF7_TASK_SLOTS.map((slot) => `${slot.name}-2`),
    );
    const receipt = JSON.parse(readFileSync(h.journal.receiptPath, "utf8"));
    expect(receipt.status).toBe("prepared");
    expect(receipt.tasks).toHaveLength(5);
    expect(receipt.completed_capture_digest).toBe(
      createHash("sha256").update(h.coordinator.captureHandle!).digest("hex"),
    );
  });

  test("ignores presentation output and truncation when terminal yield is authoritative", () => {
    const h = harness();
    const call = taskCall(h.coordinator, "presentation");
    expect(observeTaskCall(h.coordinator, call)).toBeUndefined();
    const results = validResults(call);
    results[0]!.output = "arbitrary prose";
    results[0]!.truncated = true;
    observeTaskResult(h.coordinator, taskResult(call, results));
    expect(h.coordinator.status).toBe("active");
    expect(h.state.getRunStatus(h.runHandle)).toEqual({ stage: "initial" });
  });

  test.each([
    ["missing initial peer", (event: NativeTaskCallEvent) => {
      (event.input as { tasks: unknown[] }).tasks.pop();
    }],
    ["extra initial peer", (event: NativeTaskCallEvent) => {
      const tasks = (event.input as { tasks: unknown[] }).tasks;
      tasks.push(structuredClone(tasks[0]));
    }],
    ["wrong name", (event: NativeTaskCallEvent) => {
      ((event.input as { tasks: Array<Record<string, unknown>> }).tasks[0]!).name = "wf7-renamed";
    }],
    ["wrong role", (event: NativeTaskCallEvent) => {
      ((event.input as { tasks: Array<Record<string, unknown>> }).tasks[0]!).agent = "wf7-sol-reviewer";
    }],
    ["wrong schema", (event: NativeTaskCallEvent) => {
      ((event.input as { tasks: Array<Record<string, unknown>> }).tasks[0]!).outputSchema = { type: "object" };
    }],
    ["wrong prompt nonce", (event: NativeTaskCallEvent) => {
      const item = (event.input as { tasks: Array<Record<string, unknown>> }).tasks[0]!;
      const binding = JSON.parse(item.task as string);
      binding.call_nonce = "x".repeat(43);
      item.task = JSON.stringify(binding);
    }],
    ["peer output in initial prompt", (event: NativeTaskCallEvent) => {
      const item = (event.input as { tasks: Array<Record<string, unknown>> }).tasks[0]!;
      const binding = JSON.parse(item.task as string);
      binding.stage_data.peer_initial = { injected: true };
      item.task = JSON.stringify(binding);
    }],
    ["caller effort override", (event: NativeTaskCallEvent) => {
      ((event.input as { tasks: Array<Record<string, unknown>> }).tasks[0]!).effort = "hi";
    }],
    ["caller model override", (event: NativeTaskCallEvent) => {
      ((event.input as { tasks: Array<Record<string, unknown>> }).tasks[0]!).model = "other/model";
    }],
    ["extra envelope field", (event: NativeTaskCallEvent) => {
      (event.input as Record<string, unknown>).extra = true;
    }],
  ])("fails closed on %s", (_name, mutate) => {
    const h = harness();
    const call = taskCall(h.coordinator, "bad-call");
    mutate(call);
    expect(observeTaskCall(h.coordinator, call)).toEqual({ block: true, reason: expect.any(String) });
    expectFailed(h, "task_envelope_invalid");
  });

  test("rejects out-of-order and duplicate task calls", () => {
    const outOfOrder = harness();
    const initial = taskCall(outOfOrder.coordinator, "wrong-stage");
    const flat = (initial.input as { tasks: unknown[] }).tasks[0] as Record<string, unknown>;
    initial.input = flat;
    expect(observeTaskCall(outOfOrder.coordinator, initial)).toEqual({ block: true, reason: expect.any(String) });
    expectFailed(outOfOrder, "task_envelope_invalid");

    const duplicate = harness();
    const call = taskCall(duplicate.coordinator, "duplicate-call");
    expect(observeTaskCall(duplicate.coordinator, call)).toBeUndefined();
    expect(observeTaskCall(duplicate.coordinator, call)).toEqual({ block: true, reason: expect.any(String) });
    expectFailed(duplicate, "task_envelope_invalid");
  });

  test.each([
    ["wrong result id", (results: CaptureResult[]) => { results[0]!.id = "wrong-id"; }, "task_result_invalid"],
    ["wrong task prompt", (results: CaptureResult[]) => { results[0]!.task += " prose"; }, "task_result_invalid"],
    ["wrong raw assignment", (results: CaptureResult[]) => { results[0]!.assignment += " prose"; }, "task_result_invalid"],
    ["wrong result nonce", (results: CaptureResult[]) => {
      const structured = results[0]!.structuredOutput;
      if (!structured || !structured.data || typeof structured.data !== "object") throw new Error("missing test output");
      structured.data.call_nonce = "x".repeat(43);
    }, "binding_mismatch"],
    ["invalid result anchor", (results: CaptureResult[]) => {
      const structured = results[0]!.structuredOutput;
      if (!structured || !structured.data || typeof structured.data !== "object" || !("findings" in structured.data)) {
        throw new Error("missing test findings");
      }
      const findings = structured.data.findings;
      if (!Array.isArray(findings) || !findings[0] || typeof findings[0] !== "object") throw new Error("missing test finding");
      findings[0].line = 99;
    }, "anchor_invalid"],
    ["project shadow", (results: CaptureResult[]) => { results[0]!.agentSource = "project"; }, "project_shadow"],
    ["wrong source", (results: CaptureResult[]) => { results[0]!.agentSource = "bundled"; }, "route_mismatch"],
    ["wrong route", (results: CaptureResult[]) => { results[0]!.resolvedModel = "anthropic/claude-fable-5:high"; }, "route_mismatch"],
    ["model fallback", (results: CaptureResult[]) => { results[0]!.resolvedModelIsFallback = true; }, "model_fallback"],
    ["abort", (results: CaptureResult[]) => { results[0]!.aborted = true; results[0]!.abortReason = "cancelled"; }, "task_cancelled"],
    ["nonzero exit", (results: CaptureResult[]) => { results[0]!.exitCode = 1; results[0]!.error = "failed"; }, "task_failed"],
    ["defined model override", (results: CaptureResult[]) => {
      results[0]!.modelOverride = "other/model";
    }, "route_mismatch"],
    ["retry failure", (results: CaptureResult[]) => {
      results[0]!.retryFailure = { attempt: 3, errorMessage: "retry exhausted" };
    }, "task_failed"],
    ["malformed result field", (results: CaptureResult[]) => { results[0]!.tokens = -1; }, "task_result_invalid"],
    ["agent schema source", (results: CaptureResult[]) => { results[0]!.structuredOutput!.source = "agent"; }, "structured_output_invalid"],
    ["invalid structured output", (results: CaptureResult[]) => { results[0]!.structuredOutput!.status = "invalid"; }, "structured_output_invalid"],
    ["partial structured output", (results: CaptureResult[]) => { delete results[0]!.structuredOutput!.data; }, "structured_output_invalid"],
    ["prose-only output", (results: CaptureResult[]) => { results[0]!.output = "looks good"; delete results[0]!.structuredOutput; }, "structured_output_invalid"],
    ["missing terminal yield", (results: CaptureResult[]) => { delete results[0]!.extractedToolData; }, "structured_output_invalid"],
    ["incremental yield", (results: CaptureResult[]) => {
      const yields = results[0]!.extractedToolData!.yield as NativeYield[];
      yields[0]!.type = ["section"];
    }, "structured_output_invalid"],
    ["yield fallback to prose", (results: CaptureResult[]) => {
      const yields = results[0]!.extractedToolData!.yield as NativeYield[];
      yields[0]!.useLastTurn = true;
    }, "structured_output_invalid"],
    ["schema-overridden yield", (results: CaptureResult[]) => {
      const yields = results[0]!.extractedToolData!.yield as NativeYield[];
      yields[0]!.schemaOverridden = true;
    }, "structured_output_invalid"],
    ["aborted yield", (results: CaptureResult[]) => {
      const yields = results[0]!.extractedToolData!.yield as NativeYield[];
      yields[0]!.status = "aborted";
    }, "structured_output_invalid"],
    ["mismatched yield data", (results: CaptureResult[]) => {
      const yields = results[0]!.extractedToolData!.yield as NativeYield[];
      yields[0]!.data = {};
    }, "structured_output_invalid"],
    ["yield error", (results: CaptureResult[]) => {
      const yields = results[0]!.extractedToolData!.yield as NativeYield[];
      yields[0]!.error = "failed";
    }, "structured_output_invalid"],
    ["duplicate terminal yields", (results: CaptureResult[]) => {
      const yields = results[0]!.extractedToolData!.yield as NativeYield[];
      yields.push(structuredClone(yields[0]!));
    }, "structured_output_invalid"],
    ["duplicate result ids", (results: CaptureResult[]) => { results[1]!.id = results[0]!.id; }, "task_result_invalid"],
  ] as const)("fails closed on %s", (_name, mutate, code) => {
    const h = harness();
    const call = taskCall(h.coordinator, "bad-result");
    expect(observeTaskCall(h.coordinator, call)).toBeUndefined();
    const results = validResults(call);
    mutate(results);
    observeTaskResult(h.coordinator, taskResult(call, results));
    expectFailed(h, code);
  });

  test("rejects malformed, missing, mismatched, and duplicate result events", () => {
    for (const change of ["malformed", "missing", "wrong-tool-id"] as const) {
      const h = harness();
      const call = taskCall(h.coordinator, `call-${change}`);
      observeTaskCall(h.coordinator, call);
      const event = taskResult(call) as NativeTaskResultEvent;
      if (change === "malformed") event.details = { nope: true };
      if (change === "missing") (event.details as { results: NativeSingleResult[] }).results.pop();
      if (change === "wrong-tool-id") event.toolCallId = "other-call";
      observeTaskResult(h.coordinator, event);
      expectFailed(h, "task_result_invalid");
    }

    const duplicate = harness();
    const call = settleNext(duplicate.coordinator, "settled-initial");
    observeTaskResult(duplicate.coordinator, taskResult(call));
    expectFailed(duplicate, "task_result_invalid");
  });

  test.each(["new candidate", "reanchored candidate"])("rejects rebuttal %s", (kind) => {
    const h = harness();
    settleNext(h.coordinator, "initial");
    const call = taskCall(h.coordinator, "bad-rebuttal");
    observeTaskCall(h.coordinator, call);
    const results = validResults(call);
    const data = results[0]!.structuredOutput!.data as { responses: Array<Record<string, unknown>> };
    if (kind === "new candidate") data.responses[0]!.candidate_id = "fable:new";
    else data.responses[0]!.line = 99;
    observeTaskResult(h.coordinator, taskResult(call, results));
    expectFailed(h, "structured_output_invalid");
  });

  test("rejects a judge partition that omits a candidate", () => {
    const h = harness();
    settleNext(h.coordinator, "initial");
    settleNext(h.coordinator, "rebuttal");
    const call = taskCall(h.coordinator, "bad-judge");
    observeTaskCall(h.coordinator, call);
    const results = validResults(call);
    const data = results[0]!.structuredOutput!.data as { adjudications: unknown[] };
    data.adjudications.pop();
    observeTaskResult(h.coordinator, taskResult(call, results));
    expectFailed(h, "structured_output_invalid");
  });

  test("mutation guard failure revokes state and never mints a handle", () => {
    const h = harness({ mutationBlocked: true });
    expect(observeTaskCall(h.coordinator, {
      type: "tool_call",
      toolName: "write",
      toolCallId: "mutation",
      input: { path: "/protected/role.md", content: "drift" },
    })).toEqual({ block: true, reason: "WF7 role mutation denied" });
    expectFailed(h, "role_mutation_denied");
  });
});
