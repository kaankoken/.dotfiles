import { describe, expect, test } from "bun:test";
import {
  PR_REVIEW_SUMMARY_BODIES,
  WF7_ROLE_SPECS,
  WF7_TASK_SLOTS,
  type CompletedCapture,
  type NativeSingleResult,
  type SealedTaskResult,
  type Wf7TaskSlot,
} from "../extensions/pr-review/contracts";
import {
  INITIAL_REVIEW_SCHEMA_SHA256,
  JUDGE_RESULT_SCHEMA_SHA256,
  REBUTTAL_SCHEMA_SHA256,
} from "../extensions/pr-review/schemas";
import {
  buildReviewPlanFromCapture,
  type ReviewPlan,
} from "../extensions/pr-review/publisher";
import type {
  InitialFinding,
  InitialReview,
  JudgeAdjudication,
  JudgeResult,
  Rebuttal,
} from "../extensions/pr-review/validation";

const HEAD = "a".repeat(40);
const DIFF = "b".repeat(64);
const RUN_NONCE = "run-" + "r".repeat(32);
const SNAPSHOT_NONCE = "snapshot-" + "s".repeat(32);
const SNAPSHOT_HANDLE = "snapshot-handle-" + "h".repeat(32);
const CAPTURE_HANDLE = "capture-handle-" + "c".repeat(32);

interface MutableCaptureFixture {
  results: Array<{
    slot: string;
    evidence: { structuredOutput: { data: unknown } };
    result: { structuredOutput?: { data?: unknown } };
  }>;
}

const fableOne: InitialFinding = {
  id: "one",
  path: "src/a.ts",
  line: 11,
  side: "RIGHT",
  start_line: 10,
  start_side: "RIGHT",
  severity: "nonblocking",
  title: "Fable candidate",
  body: "FABLE_CANDIDATE_SECRET",
  evidence: "FABLE_EVIDENCE_SECRET",
};
const fableTwo: InitialFinding = {
  id: "two",
  path: "src/a.ts",
  line: 12,
  side: "RIGHT",
  severity: "blocking",
  title: "Rejected candidate",
  body: "REJECTED_CANDIDATE_SECRET",
  evidence: "REJECTED_EVIDENCE_SECRET",
};
const solOne: InitialFinding = {
  id: "one",
  path: "src/deleted.ts",
  line: 20,
  side: "LEFT",
  severity: "blocking",
  title: "Sol candidate",
  body: "SOL_CANDIDATE_SECRET",
  evidence: "SOL_EVIDENCE_SECRET",
};

type CaptureOptions = {
  fable?: InitialFinding[];
  sol?: InitialFinding[];
  adjudications?: JudgeAdjudication[];
  fableWithdrawn?: string[];
  solWithdrawn?: string[];
};

function binding(slot: Wf7TaskSlot, index: number) {
  return {
    schema_version: 1 as const,
    stage: slot.stage,
    run_nonce: RUN_NONCE,
    snapshot_nonce: SNAPSHOT_NONCE,
    call_nonce: `${slot.name}-${String(index).padStart(2, "0")}-${"n".repeat(32)}`,
    snapshot_handle: SNAPSHOT_HANDLE,
    head_sha: HEAD,
    diff_digest: DIFF,
    stage_data: null,
  };
}

function initial(slot: Wf7TaskSlot, index: number, reviewer: "fable" | "sol", findings: InitialFinding[]): InitialReview {
  const value = binding(slot, index);
  return {
    schema_version: 1,
    reviewer,
    run_nonce: value.run_nonce,
    snapshot_nonce: value.snapshot_nonce,
    call_nonce: value.call_nonce,
    head_sha: value.head_sha,
    diff_digest: value.diff_digest,
    findings,
  };
}

function rebuttal(
  slot: Wf7TaskSlot,
  index: number,
  reviewer: "fable" | "sol",
  peer: InitialReview,
  withdrawn: string[],
): Rebuttal {
  const value = binding(slot, index);
  return {
    schema_version: 1,
    reviewer,
    run_nonce: value.run_nonce,
    snapshot_nonce: value.snapshot_nonce,
    call_nonce: value.call_nonce,
    head_sha: value.head_sha,
    diff_digest: value.diff_digest,
    responses: peer.findings.map((finding) => ({
      peer_finding_id: `${peer.reviewer}:${finding.id}`,
      stance: "refine" as const,
      rationale: "REBUTTAL_RATIONALE_SECRET",
      replacement_body: "REBUTTAL_REPLACEMENT_SECRET",
    })),
    withdrawn_own_ids: withdrawn,
  };
}

function judge(slot: Wf7TaskSlot, index: number, adjudications: JudgeAdjudication[]): JudgeResult {
  const value = binding(slot, index);
  return {
    schema_version: 1,
    run_nonce: value.run_nonce,
    snapshot_nonce: value.snapshot_nonce,
    call_nonce: value.call_nonce,
    head_sha: value.head_sha,
    diff_digest: value.diff_digest,
    adjudications,
    overall_rationale: "JUDGE_OVERALL_SECRET",
  };
}

function schemaHash(slot: Wf7TaskSlot): string {
  if (slot.stage === "initial") return INITIAL_REVIEW_SCHEMA_SHA256;
  if (slot.stage === "rebuttal") return REBUTTAL_SCHEMA_SHA256;
  return JUDGE_RESULT_SCHEMA_SHA256;
}

function sealed(slot: Wf7TaskSlot, index: number, data: unknown): SealedTaskResult {
  const value = binding(slot, index);
  const role = WF7_ROLE_SPECS.find((candidate) => candidate.agent === slot.agent)!;
  const structuredOutput = {
    source: "caller" as const,
    mode: "strict" as const,
    status: "valid" as const,
    data: structuredClone(data),
  };
  const result: NativeSingleResult = {
    index,
    id: `${slot.name}-native-result`,
    agent: slot.agent,
    agentSource: "user",
    task: "MAIN_GUESSED_TASK_CONTENT",
    exitCode: 0,
    output: "MAIN_GUESSED_BODY_AND_EVENT",
    stderr: "",
    truncated: false,
    durationMs: 1,
    tokens: 1,
    requests: 1,
    structuredOutput,
    resolvedModel: role.model,
    resolvedModelIsFallback: false,
    aborted: false,
  };
  return {
    slot: slot.name,
    stage: slot.stage,
    name: slot.name,
    agent: slot.agent,
    schemaSha256: schemaHash(slot),
    runNonce: RUN_NONCE,
    snapshotNonce: SNAPSHOT_NONCE,
    callNonce: value.call_nonce,
    snapshotHandle: SNAPSHOT_HANDLE,
    headSha: HEAD,
    diffDigest: DIFF,
    nativeToolCallId: `tool-call-${slot.stage}`,
    nativeResultId: result.id,
    result,
    evidence: {
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
        data: structuredClone(data),
      },
      schemaValid: true,
    },
    outputDigest: "d".repeat(64),
  };
}

function capture(options: CaptureOptions = {}): CompletedCapture {
  const fable = initial(WF7_TASK_SLOTS[0], 0, "fable", options.fable ?? [structuredClone(fableOne), structuredClone(fableTwo)]);
  const sol = initial(WF7_TASK_SLOTS[1], 1, "sol", options.sol ?? [structuredClone(solOne)]);
  const fableRebuttal = rebuttal(WF7_TASK_SLOTS[2], 2, "fable", sol, options.fableWithdrawn ?? []);
  const solRebuttal = rebuttal(WF7_TASK_SLOTS[3], 3, "sol", fable, options.solWithdrawn ?? []);
  const adjudications = options.adjudications ?? [
    {
      source_finding_ids: ["fable:one"],
      decision: "accept",
      rationale: "ACCEPT_RATIONALE_SECRET",
      anchor_source_finding_id: "fable:one",
      body: "GROK_ACCEPT_BODY",
    },
    {
      source_finding_ids: ["fable:two"],
      decision: "reject",
      rationale: "REJECT_RATIONALE_SECRET",
    },
    {
      source_finding_ids: ["sol:one"],
      decision: "request_changes",
      rationale: "REQUEST_RATIONALE_SECRET",
      anchor_source_finding_id: "sol:one",
      body: "GROK_REQUEST_BODY",
    },
  ] satisfies JudgeAdjudication[];
  const outputs = [
    fable,
    sol,
    fableRebuttal,
    solRebuttal,
    judge(WF7_TASK_SLOTS[4], 4, adjudications),
  ] as const;
  return {
    captureHandle: CAPTURE_HANDLE,
    snapshot: {
      runHandle: "run-handle-" + "q".repeat(32),
      snapshotHandle: SNAPSHOT_HANDLE,
      runNonce: RUN_NONCE,
      snapshotNonce: SNAPSHOT_NONCE,
      owner: "acme",
      repo: "widgets",
      pullNumber: 42,
      repositoryNodeId: "R_widget",
      baseSha: "e".repeat(40),
      headSha: HEAD,
      diffDigest: DIFF,
      diffBytes: new TextEncoder().encode("captured diff"),
      changedFiles: [
        { path: "src/a.ts", status: "modified", patchComplete: true, reviewable: true },
        { path: "src/deleted.ts", status: "removed", patchComplete: true, reviewable: true },
      ],
      lineMap: [
        { path: "src/a.ts", line: 10, side: "RIGHT", hunk: 1 },
        { path: "src/a.ts", line: 11, side: "RIGHT", hunk: 1 },
        { path: "src/a.ts", line: 12, side: "RIGHT", hunk: 1 },
        { path: "src/deleted.ts", line: 20, side: "LEFT", hunk: 2 },
      ],
      nonreviewableEntries: [],
    },
    results: outputs.map((output, index) => sealed(WF7_TASK_SLOTS[index]!, index, output)) as CompletedCapture["results"],
    completedAt: "2026-07-31T12:00:00.000Z",
  };
}

function mutableCapture(source: CompletedCapture): MutableCaptureFixture {
  // Test fixtures are cloned before deliberate corruption.
  return structuredClone(source) as unknown as MutableCaptureFixture;
}

function replaceOutput<T>(source: CompletedCapture, index: number, change: (value: T) => void): CompletedCapture {
  const copy = mutableCapture(source);
  const result = copy.results[index]!;
  const value = structuredClone(result.evidence.structuredOutput.data) as unknown as T;
  change(value);
  result.evidence.structuredOutput.data = structuredClone(value);
  if (!result.result.structuredOutput) throw new Error("fixture lacks structured output");
  result.result.structuredOutput.data = structuredClone(value);
  return copy as unknown as CompletedCapture;
}

function publishable(decision: "accept" | "request_changes", id: string, body: string): JudgeAdjudication {
  return {
    source_finding_ids: [id],
    decision,
    rationale: `${decision} rationale`,
    anchor_source_finding_id: id,
    body,
  };
}

function reject(id: string): JudgeAdjudication {
  return { source_finding_ids: [id], decision: "reject", rationale: "internal rejection" };
}

describe("buildReviewPlanFromCapture", () => {
  test("maps every aggregate event, including all-reject and zero-candidate APPROVE", () => {
    const cases = [
      {
        value: capture(),
        event: "REQUEST_CHANGES",
        comments: 2,
      },
      {
        value: capture({ adjudications: [publishable("accept", "fable:one", "accepted"), reject("fable:two"), reject("sol:one")] }),
        event: "COMMENT",
        comments: 1,
      },
      {
        value: capture({ adjudications: [reject("fable:one"), reject("fable:two"), reject("sol:one")] }),
        event: "APPROVE",
        comments: 0,
      },
      {
        value: capture({ fable: [], sol: [], adjudications: [] }),
        event: "APPROVE",
        comments: 0,
      },
    ] as const;

    for (const expected of cases) {
      const plan = buildReviewPlanFromCapture(expected.value);
      expect(plan.event).toBe(expected.event);
      expect(plan.payload.event).toBe(expected.event);
      expect(plan.payload.commit_id).toBe(HEAD);
      expect(plan.payload.comments).toHaveLength(expected.comments);
      expect(plan.payload.body).toBe(`${PR_REVIEW_SUMMARY_BODIES[expected.event]}\n\n${plan.runMarker}`);
    }
  });

  test("uses source-only range anchors and Grok bodies while keeping all rejected and discussion text secret", () => {
    const value = capture({
      fableWithdrawn: ["fable:two"],
      adjudications: [
        {
          source_finding_ids: ["sol:one", "fable:one"],
          decision: "accept",
          rationale: "MERGED_RATIONALE_SECRET",
          anchor_source_finding_id: "fable:one",
          body: "GROK_MERGED_BODY",
        },
        reject("fable:two"),
      ],
    });

    const plan = buildReviewPlanFromCapture(value);
    expect(plan.event).toBe("COMMENT");
    expect(plan.payload.comments).toHaveLength(1);
    expect(plan.payload.comments[0]).toEqual({
      path: "src/a.ts",
      line: 11,
      side: "RIGHT",
      start_line: 10,
      start_side: "RIGHT",
      body: `GROK_MERGED_BODY\n\n${plan.findings[0]!.marker}`,
    });
    expect(plan.findings[0]!.sourceFindingIds).toEqual(["fable:one", "sol:one"]);
    expect(plan.payload.comments[0]).not.toHaveProperty("position");

    const published = JSON.stringify(plan.payload);
    for (const secret of [
      "FABLE_CANDIDATE_SECRET",
      "FABLE_EVIDENCE_SECRET",
      "REJECTED_CANDIDATE_SECRET",
      "REJECTED_EVIDENCE_SECRET",
      "SOL_CANDIDATE_SECRET",
      "SOL_EVIDENCE_SECRET",
      "REBUTTAL_RATIONALE_SECRET",
      "REBUTTAL_REPLACEMENT_SECRET",
      "MERGED_RATIONALE_SECRET",
      "REJECT_RATIONALE_SECRET",
      "JUDGE_OVERALL_SECRET",
      "MAIN_GUESSED_BODY_AND_EVENT",
      "MAIN_GUESSED_TASK_CONTENT",
    ]) expect(published).not.toContain(secret);
  });

  test("rejects duplicate slots, candidates, partition defects, missing rebuttals, and invalid source anchors", () => {
    const duplicateSlot = mutableCapture(capture());
    duplicateSlot.results[1]!.slot = "wf7-fable-initial";
    const duplicateSlotCapture = duplicateSlot as unknown as CompletedCapture;

    const failures: Array<[CompletedCapture, RegExp]> = [
      [duplicateSlotCapture, /capture slot mismatch/],
      [capture({ fable: [structuredClone(fableOne), structuredClone(fableOne)] }), /duplicate canonical finding id/],
      [capture({ adjudications: [publishable("accept", "fable:one", "accepted"), reject("fable:two")] }), /partition/],
      [capture({ adjudications: [publishable("accept", "fable:one", "accepted"), reject("fable:one"), reject("fable:two"), reject("sol:one")] }), /multiple groups/],
      [replaceOutput<Rebuttal>(capture(), 2, (value) => value.responses = []), /peer response coverage/],
      [replaceOutput<JudgeResult>(capture(), 4, (value) => {
        const adjudication = value.adjudications[0];
        if (!adjudication || adjudication.decision === "reject") throw new Error("fixture lacks publishable adjudication");
        adjudication.anchor_source_finding_id = "sol:one";
      }), /anchor source/],
      [capture({ fable: [{ ...structuredClone(fableOne), line: 999 }] }), /outside snapshot/],
    ];

    for (const [value, reason] of failures) expect(() => buildReviewPlanFromCapture(value)).toThrow(reason);
  });

  test("rejects hidden markers, controls, invalid Unicode, and bodies that overflow after publisher marker", () => {
    const invalidBodies = [
      "unsafe <!-- injected --> marker",
      "unsafe\u0000control",
      "unsafe\ud800unicode",
      "x".repeat(65_536),
    ];
    for (const body of invalidBodies) {
      const value = capture({
        adjudications: [publishable("accept", "fable:one", body), reject("fable:two"), reject("sol:one")],
      });
      expect(() => buildReviewPlanFromCapture(value)).toThrow(/body|Unicode|length/);
    }
  });

  test("canonicalizes source and adjudication order into stable keys, markers, and payload digest", () => {
    const first = capture({
      adjudications: [
        {
          source_finding_ids: ["sol:one", "fable:one"],
          decision: "request_changes",
          rationale: "merged",
          anchor_source_finding_id: "fable:one",
          body: "same\r\nbody",
        },
        reject("fable:two"),
      ],
    });
    const reordered = capture({
      adjudications: [
        reject("fable:two"),
        {
          source_finding_ids: ["fable:one", "sol:one"],
          decision: "request_changes",
          rationale: "different private rationale",
          anchor_source_finding_id: "fable:one",
          body: "same\r\nbody",
        },
      ],
    });

    const firstPlan = buildReviewPlanFromCapture(first);
    expect(buildReviewPlanFromCapture(structuredClone(first))).toEqual(firstPlan);
    expect(buildReviewPlanFromCapture(reordered)).toEqual(firstPlan);
    expect(firstPlan.runKey).toMatch(/^[a-f0-9]{64}$/);
    expect(firstPlan.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(firstPlan.runMarker).toMatch(/^<!-- dotfiles-wf7:run:[a-f0-9]{64} -->$/);
    expect(firstPlan.findings[0]!.key).toMatch(/^[a-f0-9]{64}$/);
    expect(firstPlan.findings[0]!.marker).toBe(`<!-- dotfiles-wf7:finding:${firstPlan.findings[0]!.key} -->`);

    const changed = capture({
      adjudications: [
        {
          source_finding_ids: ["fable:one", "sol:one"],
          decision: "request_changes",
          rationale: "merged",
          anchor_source_finding_id: "fable:one",
          body: "changed body",
        },
        reject("fable:two"),
      ],
    });
    expect(buildReviewPlanFromCapture(changed).findings[0]!.key).not.toBe(firstPlan.findings[0]!.key);
    expect(buildReviewPlanFromCapture(changed).payloadDigest).not.toBe(firstPlan.payloadDigest);
  });

  test("accepts one capture argument and ignores attempted caller body, event, route, or endpoint injection", () => {
    expect(buildReviewPlanFromCapture.length).toBe(1);
    const plan = (buildReviewPlanFromCapture as (...arguments_: unknown[]) => Readonly<ReviewPlan>)(
      capture({ adjudications: [reject("fable:one"), reject("fable:two"), reject("sol:one")] }),
      {
        body: "CALLER_INJECTED_BODY",
        event: "REQUEST_CHANGES",
        endpoint: "/issues/42/comments",
        results: [{ body: "CALLER_RESULT" }],
      },
    );

    expect(plan.event).toBe("APPROVE");
    expect(plan).not.toHaveProperty("endpoint");
    expect(plan.payload).not.toHaveProperty("endpoint");
    expect(JSON.stringify(plan)).not.toMatch(/CALLER_|issues\/42|position/);
  });
});
