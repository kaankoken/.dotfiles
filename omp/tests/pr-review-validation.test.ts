import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  INITIAL_REVIEW_SCHEMA,
  INITIAL_REVIEW_SCHEMA_CANONICAL,
  INITIAL_REVIEW_SCHEMA_SHA256,
  JUDGE_RESULT_SCHEMA,
  JUDGE_RESULT_SCHEMA_CANONICAL,
  JUDGE_RESULT_SCHEMA_SHA256,
  REBUTTAL_SCHEMA,
  REBUTTAL_SCHEMA_CANONICAL,
  REBUTTAL_SCHEMA_SHA256,
} from "../extensions/pr-review/schemas";
import {
  validateInitialReview,
  validateJudgeResult,
  validateRebuttal,
  type InitialReview,
  type InitialFinding,
  type ReviewValidationContext,
} from "../extensions/pr-review/validation";

const RUN_NONCE = "r".repeat(32);
const SNAPSHOT_NONCE = "s".repeat(32);
const INITIAL_CALL_NONCE = "i".repeat(32);
const REBUTTAL_CALL_NONCE = "b".repeat(32);
const JUDGE_CALL_NONCE = "j".repeat(32);
const HEAD_SHA = "a".repeat(40);
const DIFF_DIGEST = "d".repeat(64);

const reviewableAnchors = Array.from({ length: 101 }, (_, index) => ({
  path: "src/example.ts",
  line: index + 1,
  side: "RIGHT" as const,
  hunk: 1,
}));

function binding(stage: "initial" | "rebuttal" | "judge", call_nonce: string) {
  return {
    schema_version: 1 as const,
    stage,
    run_nonce: RUN_NONCE,
    snapshot_nonce: SNAPSHOT_NONCE,
    call_nonce,
    snapshot_handle: "h".repeat(32),
    head_sha: HEAD_SHA,
    diff_digest: DIFF_DIGEST,
    stage_data: null,
  };
}

function context(
  stage: "initial" | "rebuttal" | "judge",
  callNonce: string,
): ReviewValidationContext {
  return { binding: binding(stage, callNonce), reviewableAnchors };
}

function finding(id: string, line = 1): InitialFinding {
  return {
    id,
    path: "src/example.ts",
    line,
    side: "RIGHT",
    severity: "nonblocking",
    title: `Finding ${id}`,
    body: `Body ${id}`,
    evidence: `Evidence ${id}`,
  };
}

function initial(
  reviewer: "fable" | "sol",
  findings: InitialFinding[] = [],
): InitialReview {
  return {
    schema_version: 1,
    reviewer,
    run_nonce: RUN_NONCE,
    snapshot_nonce: SNAPSHOT_NONCE,
    call_nonce: INITIAL_CALL_NONCE,
    head_sha: HEAD_SHA,
    diff_digest: DIFF_DIGEST,
    findings,
  };
}

function rebuttal(reviewer: "fable" | "sol", responses: unknown[], withdrawn: string[] = []) {
  return {
    schema_version: 1,
    reviewer,
    run_nonce: RUN_NONCE,
    snapshot_nonce: SNAPSHOT_NONCE,
    call_nonce: REBUTTAL_CALL_NONCE,
    head_sha: HEAD_SHA,
    diff_digest: DIFF_DIGEST,
    responses,
    withdrawn_own_ids: withdrawn,
  };
}

function judge(adjudications: unknown[]) {
  return {
    schema_version: 1,
    run_nonce: RUN_NONCE,
    snapshot_nonce: SNAPSHOT_NONCE,
    call_nonce: JUDGE_CALL_NONCE,
    head_sha: HEAD_SHA,
    diff_digest: DIFF_DIGEST,
    adjudications,
    overall_rationale: "All candidates adjudicated.",
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("canonical PR review schemas", () => {
  test("pins one deterministic serialization and SHA-256 per closed v1 schema", () => {
    for (const [schema, canonical, digest] of [
      [INITIAL_REVIEW_SCHEMA, INITIAL_REVIEW_SCHEMA_CANONICAL, INITIAL_REVIEW_SCHEMA_SHA256],
      [REBUTTAL_SCHEMA, REBUTTAL_SCHEMA_CANONICAL, REBUTTAL_SCHEMA_SHA256],
      [JUDGE_RESULT_SCHEMA, JUDGE_RESULT_SCHEMA_CANONICAL, JUDGE_RESULT_SCHEMA_SHA256],
    ] as const) {
      expect(JSON.parse(canonical)).toEqual(schema);
      expect(canonical).not.toMatch(/\n|\s{2}/);
      expect(hash(canonical)).toBe(digest);
      expect(schema.additionalProperties).toBe(false);
    }
  });

  test("uses only provider-compatible closed object variants", () => {
    const itemSchemas = [
      INITIAL_REVIEW_SCHEMA.properties.findings.items,
      REBUTTAL_SCHEMA.properties.responses.items,
      JUDGE_RESULT_SCHEMA.properties.adjudications.items,
    ];
    const serialized = JSON.stringify(itemSchemas);
    for (const keyword of ["oneOf", "if", "then", "else", "not"]) {
      expect(serialized).not.toContain(`"${keyword}":`);
    }
    for (const itemSchema of itemSchemas) {
      expect(itemSchema.anyOf.length).toBeGreaterThanOrEqual(2);
      for (const variant of itemSchema.anyOf) {
        expect(variant.type).toBe("object");
        expect(variant.additionalProperties).toBe(false);
        expect([...variant.required].sort()).toEqual(
          Object.keys(variant.properties).sort(),
        );
      }
    }

    const initialVariants = INITIAL_REVIEW_SCHEMA.properties.findings.items.anyOf;
    expect(initialVariants[0].required).not.toContain("start_line");
    expect(initialVariants[1].required).toContain("start_line");

    const responseVariants = REBUTTAL_SCHEMA.properties.responses.items.anyOf;
    expect(responseVariants[0].properties.stance.enum).toEqual([
      "support",
      "oppose",
    ]);
    expect(responseVariants[1].properties.stance.const).toBe("refine");
    expect(responseVariants[1].required).toContain("replacement_body");
    expect(responseVariants[2].properties.stance.const).toBe("refine");
    expect(responseVariants[2].properties).not.toHaveProperty("replacement_body");
    expect(responseVariants[0].properties.peer_finding_id.maxLength).toBe(134);
    expect(REBUTTAL_SCHEMA.properties.withdrawn_own_ids.items.maxLength).toBe(134);

    const adjudicationVariants =
      JUDGE_RESULT_SCHEMA.properties.adjudications.items.anyOf;
    expect(adjudicationVariants[0].properties.decision.enum).toEqual([
      "accept",
      "request_changes",
    ]);
    expect(adjudicationVariants[1].properties.decision.const).toBe("reject");
    expect(adjudicationVariants[1].properties).not.toHaveProperty("body");
    expect(
      adjudicationVariants[0].properties.source_finding_ids.items.maxLength,
    ).toBe(134);
    expect(
      adjudicationVariants[0].properties.anchor_source_finding_id.maxLength,
    ).toBe(134);
  });
});

describe("validateInitialReview", () => {
  const initialContext = { ...context("initial", INITIAL_CALL_NONCE), reviewer: "fable" as const };

  test("accepts valid zero and 100 finding boundaries", () => {
    expect(validateInitialReview(initial("fable"), initialContext).ok).toBe(true);
    const findings = Array.from({ length: 100 }, (_, index) => finding(`f-${index}`, index + 1));
    expect(validateInitialReview(initial("fable", findings), initialContext).ok).toBe(true);
    expect(validateInitialReview(initial("fable", [...findings, finding("overflow", 101)]), initialContext).ok).toBe(false);
  });

  test("allows marker namespace as ordinary visible text", () => {
    expect(
      validateInitialReview(
        initial("fable", [
          { ...finding("visible"), body: "Discuss dotfiles-wf7 behavior." },
        ]),
        initialContext,
      ).ok,
    ).toBe(true);
  });

  test("counts astral text as Unicode code points", () => {
    expect(
      validateInitialReview(
        initial("fable", [
          { ...finding("astral"), body: "😀".repeat(65_536) },
        ]),
        initialContext,
      ).ok,
    ).toBe(true);
    expect(
      validateInitialReview(
        initial("fable", [
          { ...finding("astral-overflow"), body: "😀".repeat(65_537) },
        ]),
        initialContext,
      ).ok,
    ).toBe(false);
  });

  test("rejects extra fields and every binding mismatch", () => {
    expect(validateInitialReview({ ...initial("fable"), extra: true }, initialContext).ok).toBe(false);
    expect(
      validateInitialReview(
        { ...initial("fable"), findings: [{ ...finding("x"), extra: true }] },
        initialContext,
      ).ok,
    ).toBe(false);
    for (const [field, value] of [
      ["schema_version", 2],
      ["reviewer", "sol"],
      ["run_nonce", "x".repeat(32)],
      ["snapshot_nonce", "x".repeat(32)],
      ["call_nonce", "x".repeat(32)],
      ["head_sha", "b".repeat(40)],
      ["diff_digest", "e".repeat(64)],
    ] as const) {
      expect(validateInitialReview({ ...initial("fable"), [field]: value }, initialContext).ok).toBe(false);
    }
  });

  test("rejects duplicate/nonlocal IDs and bad or moved anchors", () => {
    expect(validateInitialReview(initial("fable", [finding("x"), finding("x")]), initialContext).ok).toBe(false);
    expect(validateInitialReview(initial("fable", [finding("sol:x")]), initialContext).ok).toBe(false);
    expect(
      validateInitialReview(
        initial("fable", [{ ...finding("range", 3), start_line: 2, start_side: "RIGHT" }]),
        initialContext,
      ).ok,
    ).toBe(true);
    expect(
      validateInitialReview(
        { ...initial("fable"), findings: [{ ...finding("half"), start_line: 1 }] },
        initialContext,
      ).ok,
    ).toBe(false);
    expect(
      validateInitialReview(
        initial("fable", [{ ...finding("reverse", 2), start_line: 3, start_side: "RIGHT" }]),
        initialContext,
      ).ok,
    ).toBe(false);
    expect(validateInitialReview(initial("fable", [finding("outside", 500)]), initialContext).ok).toBe(false);

  });

  test("rejects a multiline anchor spanning sides", () => {
    expect(
      validateInitialReview(
        initial("fable", [
          {
            ...finding("different-side", 3),
            start_line: 2,
            start_side: "LEFT",
          },
        ]),
        {
          ...initialContext,
          reviewableAnchors: [
            { path: "src/example.ts", line: 2, side: "LEFT", hunk: 1 },
            { path: "src/example.ts", line: 3, side: "RIGHT", hunk: 1 },
          ],
        },
      ).ok,
    ).toBe(false);
  });

  test("rejects a multiline anchor spanning hunks", () => {
    expect(
      validateInitialReview(
        initial("fable", [
          {
            ...finding("different-hunk", 3),
            start_line: 2,
            start_side: "RIGHT",
          },
        ]),
        {
          ...initialContext,
          reviewableAnchors: [
            { path: "src/example.ts", line: 2, side: "RIGHT", hunk: 1 },
            { path: "src/example.ts", line: 3, side: "RIGHT", hunk: 2 },
          ],
        },
      ).ok,
    ).toBe(false);
  });

  test("rejects empty/unbounded text and hidden or control markers", () => {
    expect(validateInitialReview(initial("fable", [{ ...finding("empty"), body: "" }]), initialContext).ok).toBe(false);
    expect(
      validateInitialReview(initial("fable", [{ ...finding("long"), body: "x".repeat(65_537) }]), initialContext).ok,
    ).toBe(false);
    expect(
      validateInitialReview(initial("fable", [{ ...finding("marker"), body: "<!-- dotfiles-wf7:finding -->" }]), initialContext).ok,
    ).toBe(false);
    expect(validateInitialReview(initial("fable", [{ ...finding("control"), evidence: "bad\u0000" }]), initialContext).ok).toBe(false);
    expect(
      validateInitialReview(
        initial("fable", [{ ...finding("format-control"), evidence: "bad\u202e" }]),
        initialContext,
      ).ok,
    ).toBe(false);
  });
});

describe("validateRebuttal", () => {
  const own = initial("fable", [finding("own-a"), finding("own-b", 2)]);
  const peer = initial("sol", [finding("peer-a", 3), finding("peer-b", 4)]);
  const rebuttalContext = {
    ...context("rebuttal", REBUTTAL_CALL_NONCE),
    reviewer: "fable" as const,
    ownInitial: own,
    peerInitial: peer,
  };
  const completeResponses = [
    { peer_finding_id: "sol:peer-a", stance: "support", rationale: "Supported." },
    {
      peer_finding_id: "sol:peer-b",
      stance: "refine",
      rationale: "Clearer wording.",
      replacement_body: "Replacement body.",
    },
  ];

  test("accepts exact peer coverage, refine, and own withdrawal subset", () => {
    expect(validateRebuttal(rebuttal("fable", completeResponses, ["fable:own-a"]), rebuttalContext).ok).toBe(true);
  });

  test("rejects missing, duplicate, unknown, or newly anchored peer responses", () => {
    expect(validateRebuttal(rebuttal("fable", completeResponses.slice(0, 1)), rebuttalContext).ok).toBe(false);
    expect(validateRebuttal(rebuttal("fable", [completeResponses[0], completeResponses[0]]), rebuttalContext).ok).toBe(false);
    expect(
      validateRebuttal(
        rebuttal("fable", [...completeResponses, { peer_finding_id: "sol:new", stance: "oppose", rationale: "No." }]),
        rebuttalContext,
      ).ok,
    ).toBe(false);
    expect(
      validateRebuttal(
        rebuttal("fable", [{ ...completeResponses[0], line: 99 }, completeResponses[1]]),
        rebuttalContext,
      ).ok,
    ).toBe(false);
  });

  test("accepts the longest canonical Fable ID", () => {
    const localId = "x".repeat(128);
    const longestPeer = initial("fable", [finding(localId, 3)]);
    expect(
      validateRebuttal(
        rebuttal("sol", [
          {
            peer_finding_id: `fable:${localId}`,
            stance: "support",
            rationale: "Supported.",
          },
        ]),
        {
          ...context("rebuttal", REBUTTAL_CALL_NONCE),
          reviewer: "sol",
          ownInitial: initial("sol"),
          peerInitial: longestPeer,
        },
      ).ok,
    ).toBe(true);
  });

  test("enforces refine-only replacement bodies and marker/length bounds", () => {
    expect(
      validateRebuttal(
        rebuttal("fable", [{ ...completeResponses[0], replacement_body: "Not a refine." }, completeResponses[1]]),
        rebuttalContext,
      ).ok,
    ).toBe(false);
    expect(
      validateRebuttal(
        rebuttal("fable", [completeResponses[0], { ...completeResponses[1], replacement_body: "<!-- hidden -->" }]),
        rebuttalContext,
      ).ok,
    ).toBe(false);
    expect(
      validateRebuttal(
        rebuttal("fable", [
          completeResponses[0],
          {
            peer_finding_id: "sol:peer-b",
            stance: "refine",
            rationale: "Clearer wording.",
          },
        ]),
        rebuttalContext,
      ).ok,
    ).toBe(true);
    expect(
      validateRebuttal(
        rebuttal("fable", [{ ...completeResponses[0], rationale: "x".repeat(8_193) }, completeResponses[1]]),
        rebuttalContext,
      ).ok,
    ).toBe(false);
  });

  test("requires unique withdrawn IDs from only the reviewer's initial candidates", () => {
    expect(validateRebuttal(rebuttal("fable", completeResponses, ["fable:own-a", "fable:own-a"]), rebuttalContext).ok).toBe(false);
    expect(validateRebuttal(rebuttal("fable", completeResponses, ["sol:peer-a"]), rebuttalContext).ok).toBe(false);
    expect(validateRebuttal(rebuttal("fable", completeResponses, ["fable:missing"]), rebuttalContext).ok).toBe(false);
  });

  test("rejects extra fields and binding mismatches", () => {
    expect(validateRebuttal({ ...rebuttal("fable", completeResponses), extra: true }, rebuttalContext).ok).toBe(false);
    expect(
      validateRebuttal({ ...rebuttal("fable", completeResponses), call_nonce: "x".repeat(32) }, rebuttalContext).ok,
    ).toBe(false);
  });
});

describe("validateJudgeResult", () => {
  const fable = initial("fable", [finding("a"), finding("b", 2)]);
  const sol = initial("sol", [finding("a", 3)]);
  const judgeContext = {
    ...context("judge", JUDGE_CALL_NONCE),
    initialReviews: [fable, sol] as const,
  };

  test("accepts zero candidates and exact merged partitions", () => {
    expect(
      validateJudgeResult(judge([]), {
        ...context("judge", JUDGE_CALL_NONCE),
        initialReviews: [initial("fable"), initial("sol")] as const,
      }).ok,
    ).toBe(true);
    expect(
      validateJudgeResult(
        judge([
          {
            source_finding_ids: ["fable:a", "sol:a"],
            decision: "accept",
            rationale: "Duplicate reports.",
            anchor_source_finding_id: "fable:a",
            body: "Merged publishable body.",
          },
          {
            source_finding_ids: ["fable:b"],
            decision: "reject",
            rationale: "Not actionable.",
          },
        ]),
        judgeContext,
      ).ok,
    ).toBe(true);
  });

  test("requires an exact source-ID partition with unique nonempty groups", () => {
    const validGroups = [
      {
        source_finding_ids: ["fable:a", "sol:a"],
        decision: "accept",
        rationale: "Valid.",
        anchor_source_finding_id: "fable:a",
        body: "Body.",
      },
      { source_finding_ids: ["fable:b"], decision: "reject", rationale: "Reject." },
    ];
    expect(validateJudgeResult(judge(validGroups.slice(0, 1)), judgeContext).ok).toBe(false);
    expect(
      validateJudgeResult(judge([{ ...validGroups[0], source_finding_ids: ["fable:a", "fable:a", "sol:a"] }, validGroups[1]]), judgeContext).ok,
    ).toBe(false);
    expect(
      validateJudgeResult(judge([validGroups[0], { ...validGroups[1], source_finding_ids: ["fable:b", "sol:new"] }]), judgeContext).ok,
    ).toBe(false);
    expect(validateJudgeResult(judge([{ ...validGroups[0], source_finding_ids: [] }, validGroups[1]]), judgeContext).ok).toBe(false);
  });

  test("requires publishable decisions to name an anchor source from their group", () => {
    const base = {
      source_finding_ids: ["fable:a", "sol:a"],
      decision: "request_changes",
      rationale: "Blocking.",
      anchor_source_finding_id: "fable:a",
      body: "Fix this.",
    };
    const rejectB = { source_finding_ids: ["fable:b"], decision: "reject", rationale: "Reject." };
    expect(validateJudgeResult(judge([{ ...base, anchor_source_finding_id: "fable:b" }, rejectB]), judgeContext).ok).toBe(false);
    const { body: _body, ...withoutBody } = base;
    expect(validateJudgeResult(judge([withoutBody, rejectB]), judgeContext).ok).toBe(false);
    const { anchor_source_finding_id: _anchor, ...withoutAnchor } = base;
    expect(validateJudgeResult(judge([withoutAnchor, rejectB]), judgeContext).ok).toBe(false);
  });

  test("forbids reject bodies/anchors and hidden, control, or oversized publishable bodies", () => {
    const accepted = {
      source_finding_ids: ["fable:a", "sol:a"],
      decision: "accept",
      rationale: "Accept.",
      anchor_source_finding_id: "fable:a",
      body: "Publish.",
    };
    expect(
      validateJudgeResult(
        judge([accepted, { source_finding_ids: ["fable:b"], decision: "reject", rationale: "No.", body: "secret" }]),
        judgeContext,
      ).ok,
    ).toBe(false);
    expect(
      validateJudgeResult(
        judge([accepted, { source_finding_ids: ["fable:b"], decision: "reject", rationale: "No.", anchor_source_finding_id: "fable:b" }]),
        judgeContext,
      ).ok,
    ).toBe(false);
    for (const body of ["<!-- dotfiles-wf7:control -->", "bad\u0000", "x".repeat(65_537)]) {
      expect(validateJudgeResult(judge([{ ...accepted, body }, { source_finding_ids: ["fable:b"], decision: "reject", rationale: "No." }]), judgeContext).ok).toBe(false);
    }
  });

  test("rejects extra fields and binding mismatch", () => {
    expect(validateJudgeResult({ ...judge([]), extra: true }, { ...context("judge", JUDGE_CALL_NONCE), initialReviews: [initial("fable"), initial("sol")] }).ok).toBe(false);
    expect(
      validateJudgeResult(
        { ...judge([]), head_sha: "b".repeat(40) },
        { ...context("judge", JUDGE_CALL_NONCE), initialReviews: [initial("fable"), initial("sol")] },
      ).ok,
    ).toBe(false);
  });
});
