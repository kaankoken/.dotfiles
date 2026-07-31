import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PR_REVIEW_PUBLISH_PARAMETERS_SCHEMA,
  WF7_ROLE_SPECS,
  WF7_TASK_SLOTS,
  type CompletedCapture,
  type NativeSingleResult,
  type RoleIntegrityObservation,
  type SealedTaskResult,
  type Wf7TaskSlot,
} from "../extensions/pr-review/contracts";
import type {
  PrReviewExec,
  PrReviewExecOptions,
  PrReviewExecResult,
} from "../extensions/pr-review/github";
import { buildReviewPlanFromCapture, type ReviewPlan } from "../extensions/pr-review/publisher";
import {
  createPrReviewPublishTool,
  PrReviewPublishError,
} from "../extensions/pr-review/publish-tool";
import { ReceiptJournal } from "../extensions/pr-review/receipts";
import type { LoadedRoleManifest } from "../extensions/pr-review/role-integrity";
import {
  INITIAL_REVIEW_SCHEMA_SHA256,
  JUDGE_RESULT_SCHEMA_SHA256,
  REBUTTAL_SCHEMA_SHA256,
} from "../extensions/pr-review/schemas";
import type { InitialReview, JudgeResult, Rebuttal } from "../extensions/pr-review/validation";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const DIFF = "d".repeat(64);
const CAPTURE_HANDLE = "capture-" + "c".repeat(32);
const SNAPSHOT_HANDLE = "snapshot-" + "s".repeat(32);
const RUN_NONCE = "run-" + "r".repeat(32);
const SNAPSHOT_NONCE = "snapshot-nonce-" + "n".repeat(32);
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function binding(slot: Wf7TaskSlot, index: number) {
  return {
    schema_version: 1 as const,
    stage: slot.stage,
    run_nonce: RUN_NONCE,
    snapshot_nonce: SNAPSHOT_NONCE,
    call_nonce: `${slot.name}-${index}-${"x".repeat(32)}`,
    snapshot_handle: SNAPSHOT_HANDLE,
    head_sha: HEAD,
    diff_digest: DIFF,
    stage_data: null,
  };
}

function sealed(slot: Wf7TaskSlot, index: number, data: unknown): SealedTaskResult {
  const role = WF7_ROLE_SPECS.find((candidate) => candidate.agent === slot.agent)!;
  const structuredOutput = {
    source: "caller" as const,
    mode: "strict" as const,
    status: "valid" as const,
    data: structuredClone(data),
  };
  const result: NativeSingleResult = {
    index,
    id: `${slot.name}-result`,
    agent: slot.agent,
    agentSource: "user",
    task: slot.name,
    exitCode: 0,
    output: "",
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
    schemaSha256: slot.stage === "initial"
      ? INITIAL_REVIEW_SCHEMA_SHA256
      : slot.stage === "rebuttal"
      ? REBUTTAL_SCHEMA_SHA256
      : JUDGE_RESULT_SCHEMA_SHA256,
    runNonce: RUN_NONCE,
    snapshotNonce: SNAPSHOT_NONCE,
    callNonce: binding(slot, index).call_nonce,
    snapshotHandle: SNAPSHOT_HANDLE,
    headSha: HEAD,
    diffDigest: DIFF,
    nativeToolCallId: `${slot.name}-call`,
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
      structuredOutput: structuredClone(structuredOutput),
      schemaValid: true,
    },
    outputDigest: "e".repeat(64),
  };
}

function capture(
  event: "COMMENT" | "REQUEST_CHANGES" | "APPROVE" = "REQUEST_CHANGES",
  captureHandle = CAPTURE_HANDLE,
): CompletedCapture {
  const candidate = {
    id: "one",
    path: "src/a.ts",
    line: 7,
    side: "RIGHT" as const,
    severity: "blocking" as const,
    title: "Finding",
    body: "reviewer body",
    evidence: "evidence",
  };
  const initial = (slot: Wf7TaskSlot, index: number, reviewer: "fable" | "sol", findings: typeof candidate[]): InitialReview => ({
    schema_version: 1,
    reviewer,
    run_nonce: RUN_NONCE,
    snapshot_nonce: SNAPSHOT_NONCE,
    call_nonce: binding(slot, index).call_nonce,
    head_sha: HEAD,
    diff_digest: DIFF,
    findings,
  });
  const fable = initial(WF7_TASK_SLOTS[0], 0, "fable", event === "APPROVE" ? [] : [candidate]);
  const sol = initial(WF7_TASK_SLOTS[1], 1, "sol", []);
  const rebuttal = (slot: Wf7TaskSlot, index: number, reviewer: "fable" | "sol", peer: InitialReview): Rebuttal => ({
    schema_version: 1,
    reviewer,
    run_nonce: RUN_NONCE,
    snapshot_nonce: SNAPSHOT_NONCE,
    call_nonce: binding(slot, index).call_nonce,
    head_sha: HEAD,
    diff_digest: DIFF,
    responses: peer.findings.map((finding) => ({
      peer_finding_id: `${peer.reviewer}:${finding.id}`,
      stance: "support" as const,
      rationale: "still valid",
    })),
    withdrawn_own_ids: [],
  });
  const judge: JudgeResult = {
    schema_version: 1,
    run_nonce: RUN_NONCE,
    snapshot_nonce: SNAPSHOT_NONCE,
    call_nonce: binding(WF7_TASK_SLOTS[4], 4).call_nonce,
    head_sha: HEAD,
    diff_digest: DIFF,
    adjudications: event === "APPROVE" ? [] : [{
      source_finding_ids: ["fable:one"],
      decision: event === "COMMENT" ? "accept" : "request_changes",
      rationale: "judge rationale",
      anchor_source_finding_id: "fable:one",
      body: "judge inline body",
    }],
    overall_rationale: "done",
  };
  const outputs = [
    fable,
    sol,
    rebuttal(WF7_TASK_SLOTS[2], 2, "fable", sol),
    rebuttal(WF7_TASK_SLOTS[3], 3, "sol", fable),
    judge,
  ];
  return {
    captureHandle,
    snapshot: {
      runHandle: "run-" + "q".repeat(32),
      snapshotHandle: SNAPSHOT_HANDLE,
      runNonce: RUN_NONCE,
      snapshotNonce: SNAPSHOT_NONCE,
      owner: "acme",
      repo: "widgets",
      pullNumber: 42,
      repositoryNodeId: "R_widgets",
      baseSha: BASE,
      headSha: HEAD,
      diffDigest: DIFF,
      diffBytes: new TextEncoder().encode("diff"),
      changedFiles: [{ path: "src/a.ts", status: "modified", patchComplete: true, reviewable: true }],
      lineMap: [{ path: "src/a.ts", line: 7, side: "RIGHT", hunk: 1 }],
      nonreviewableEntries: [],
    },
    results: outputs.map((output, index) => sealed(WF7_TASK_SLOTS[index]!, index, output)) as CompletedCapture["results"],
    completedAt: "2026-07-31T12:00:00.000Z",
  };
}

const roles: readonly RoleIntegrityObservation[] = WF7_ROLE_SPECS.map((role) => ({
  agent: role.agent,
  livePath: `/roles/${role.agent}.md`,
  checkedRealpath: `/canonical/${role.agent}.md`,
  preCallSha256: "1".repeat(64),
  prePublishSha256: "1".repeat(64),
  preCallValid: true,
  prePublishValid: true,
}));
const preCallRoles: readonly RoleIntegrityObservation[] = roles.map((role) => ({
  agent: role.agent,
  livePath: role.livePath,
  checkedRealpath: role.checkedRealpath,
  preCallSha256: role.preCallSha256,
  preCallValid: role.preCallValid,
}));
const manifest = {
  version: 1,
  digest: "2".repeat(64),
  roles: [],
} as unknown as LoadedRoleManifest;

function defaultManifestFixture(): LoadedRoleManifest {
  const root = mkdtempSync(join(tmpdir(), "pr-review-role-test-"));
  roots.push(root);
  const canonicalRoot = realpathSync.native(root);
  const schemaByAgent = {
    "wf7-fable-reviewer": [
      { identity: "https://dotfiles.local/schemas/pr-review-initial-v1.schema.json", sha256: INITIAL_REVIEW_SCHEMA_SHA256 },
      { identity: "https://dotfiles.local/schemas/pr-review-rebuttal-v1.schema.json", sha256: REBUTTAL_SCHEMA_SHA256 },
    ],
    "wf7-sol-reviewer": [
      { identity: "https://dotfiles.local/schemas/pr-review-initial-v1.schema.json", sha256: INITIAL_REVIEW_SCHEMA_SHA256 },
      { identity: "https://dotfiles.local/schemas/pr-review-rebuttal-v1.schema.json", sha256: REBUTTAL_SCHEMA_SHA256 },
    ],
    "wf7-grok-judge": [
      { identity: "https://dotfiles.local/schemas/pr-review-judge-v1.schema.json", sha256: JUDGE_RESULT_SCHEMA_SHA256 },
    ],
  } as const;
  return {
    version: 1,
    digest: manifest.digest,
    roles: WF7_ROLE_SPECS.map((role) => {
      const canonicalPath = join(canonicalRoot, `${role.agent}.md`);
      const livePath = join(canonicalRoot, `${role.agent}-live.md`);
      const bytes = [
        "---",
        `name: ${role.agent}`,
        `model: ${role.model}`,
        "tools:",
        "  - pr_review_snapshot",
        "spawns: []",
        "blocking: true",
        "---",
        "role fixture",
        "",
      ].join("\n");
      writeFileSync(canonicalPath, bytes, { mode: 0o600 });
      symlinkSync(canonicalPath, livePath);
      return {
        livePath,
        canonicalPath,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        agent: role.agent,
        model: role.model,
        tools: ["pr_review_snapshot"],
        spawns: [],
        blocking: true,
        schemas: schemaByAgent[role.agent],
      };
    }),
  };
}

function journalFor(source: CompletedCapture): ReceiptJournal {
  const root = mkdtempSync(join(tmpdir(), "pr-review-publish-test-"));
  roots.push(root);
  const journal = ReceiptJournal.start({
    rootDir: root,
    provisionalId: "publish-test",
    owner: source.snapshot.owner,
    repo: source.snapshot.repo,
    pullNumber: source.snapshot.pullNumber,
    roleManifestDigest: manifest.digest,
    now: () => "2026-07-31T12:00:00.000Z",
  });
  journal.promoteToHead({
    head_sha: source.snapshot.headSha,
    repositoryNodeId: source.snapshot.repositoryNodeId,
    base_sha: source.snapshot.baseSha,
    diff_digest: source.snapshot.diffDigest,
    authenticated_actor: "bot",
    roles: preCallRoles,
  });
  return journal;
}

function receipt(journal: ReceiptJournal): Record<string, unknown> {
  return JSON.parse(readFileSync(journal.receiptPath, "utf8"));
}

type FakeOptions = {
  actor?: string;
  author?: string;
  permissions?: Record<string, boolean>;
  actorWait?: (signal?: AbortSignal) => Promise<void>;
  state?: string;
  merged?: boolean;
  pullHeads?: string[];
  reviewPages?: (call: number, page: number) => unknown[];
  commentPages?: (call: number, page: number) => unknown[];
  postResult?: PrReviewExecResult;
  postStarted?: () => void;
  postWait?: Promise<void> | ((signal?: AbortSignal) => Promise<void>);
  postPullResult?: PrReviewExecResult;
};

interface FakeGitHub {
  calls: string[][];
  options: PrReviewExecOptions[];
  exec: PrReviewExec;
  inputPaths: string[];
  payloads: unknown[];
}

interface RemoteFixture {
  review: {
    id: number;
    user: { login: string };
    state: string;
    commit_id: string;
    body: string;
  };
  comments: Array<Record<string, unknown> & {
    id: number;
    pull_request_review_id: number;
    user: { login: string };
    path: string;
    line: number;
    side: string;
    body: string;
  }>;
}

function fakeGitHub(options: FakeOptions = {}): FakeGitHub {
  const calls: string[][] = [];
  const payloads: unknown[] = [];
  const inputPaths: string[] = [];
  let pullCall = 0;
  let reviewCall = 0;
  let commentCall = 0;
  const execOptions: PrReviewExecOptions[] = [];
  const exec: PrReviewExec = async (argv, callOptions = {}) => {
    execOptions.push(callOptions);
    const args = [...argv];
    calls.push(args);
    const methodIndex = args.indexOf("--method");
    const method = args[methodIndex + 1];
    const endpoint = args[methodIndex + 2] ?? "";
    if (method === "POST") {
      const path = args[args.indexOf("--input") + 1]!;
      inputPaths.push(path);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      const payload = JSON.parse(readFileSync(path, "utf8")) as { comments?: unknown[] };
      payloads.push(payload);
      options.postStarted?.();
      await (typeof options.postWait === "function"
        ? options.postWait(callOptions.signal)
        : options.postWait);
      return options.postResult ?? {
        exitCode: 0,
        stdout: JSON.stringify({
          id: 900,
          comments: (payload.comments ?? []).map((_comment, index) => ({ id: 901 + index })),
        }),
        stderr: "",
      };
    }
    if (endpoint === "user") {
      await options.actorWait?.(callOptions.signal);
      return { exitCode: 0, stdout: JSON.stringify({ login: options.actor ?? "bot", id: 1 }), stderr: "" };
    }
    if (endpoint === "repos/acme/widgets") {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          full_name: "acme/widgets",
          node_id: "R_widgets",
          permissions: options.permissions ?? { pull: true, push: true },
        }),
        stderr: "",
      };
    }
    if (endpoint === "repos/acme/widgets/pulls/42") {
      const call = pullCall++;
      if (call === 1 && options.postPullResult) return options.postPullResult;
      const heads = options.pullHeads ?? [HEAD, HEAD];
      const head = heads[Math.min(call, heads.length - 1)]!;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          state: options.state ?? "open",
          draft: false,
          merged: options.merged ?? false,
          changed_files: 1,
          user: { login: options.author ?? "author" },
          base: { sha: BASE },
          head: { sha: head, repo: { full_name: "acme/widgets" } },
        }),
        stderr: "",
      };
    }
    const reviewMatch = /pulls\/42\/reviews\?per_page=100&page=(\d+)/.exec(endpoint);
    if (reviewMatch) {
      const page = Number(reviewMatch[1]);
      if (page === 1) reviewCall += 1;
      return { exitCode: 0, stdout: JSON.stringify(options.reviewPages?.(reviewCall, page) ?? []), stderr: "" };
    }
    const commentMatch = /pulls\/42\/comments\?per_page=100&page=(\d+)/.exec(endpoint);
    if (commentMatch) {
      const page = Number(commentMatch[1]);
      if (page === 1) commentCall += 1;
      return { exitCode: 0, stdout: JSON.stringify(options.commentPages?.(commentCall, page) ?? []), stderr: "" };
    }
    throw new Error(`unexpected fake GitHub argv: ${args.join(" ")}`);
  };
  return { calls, options: execOptions, exec, inputPaths, payloads };
}

function toolForCaptures(
  captures: ReadonlyMap<string, { source: CompletedCapture; journal: ReceiptJournal }>,
  fake: FakeGitHub,
  checkRoles = () => roles,
) {
  return createPrReviewPublishTool({
    state: { lookupCapture: (handle: string) => {
      const entry = captures.get(handle);
      if (!entry) throw new Error("unknown capture handle");
      return entry.source;
    } },
    journalForCapture: (handle) => {
      const entry = captures.get(handle);
      if (!entry) throw new Error("unknown capture handle");
      return entry.journal;
    },
    exec: fake.exec,
    loadManifest: () => manifest,
    checkRoles,
  });
}

function toolFor(source: CompletedCapture, journal: ReceiptJournal, fake: FakeGitHub, checkRoles = () => roles) {
  return toolForCaptures(new Map([[source.captureHandle, { source, journal }]]), fake, checkRoles);
}

function remoteFor(plan: ReviewPlan, reviewId = 700, actor = "bot"): RemoteFixture {
  const state = plan.event === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : plan.event === "COMMENT" ? "COMMENTED" : "APPROVED";
  return {
    review: {
      id: reviewId,
      user: { login: actor },
      state,
      commit_id: plan.payload.commit_id,
      body: plan.payload.body,
    },
    comments: plan.payload.comments.map((comment, index) => ({
      id: reviewId + index + 1,
      pull_request_review_id: reviewId,
      user: { login: actor },
      path: comment.path,
      line: comment.line,
      side: comment.side,
      ...(comment.start_line === undefined ? {} : { start_line: comment.start_line, start_side: comment.start_side }),
      body: comment.body,
    })),
  };
}

describe("pr_review_publish", () => {
  test("exposes only capture_handle and dry_run and dry-run validates dedupe with zero mutation", async () => {
    const source = capture("COMMENT");
    const journal = journalFor(source);
    const fake = fakeGitHub();
    const tool = toolFor(source, journal, fake);

    expect(tool.parameters).toEqual(PR_REVIEW_PUBLISH_PARAMETERS_SCHEMA);
    await expect(tool.execute({ capture_handle: CAPTURE_HANDLE, dry_run: true, extra: true } as never))
      .rejects.toMatchObject({ code: "invalid_arguments" });
    const result = await tool.execute({ capture_handle: CAPTURE_HANDLE, dry_run: true });

    expect(result).toMatchObject({ status: "dry_run", event: "COMMENT", comment_count: 1 });
    expect(fake.calls.filter((argv) => argv.includes("POST"))).toHaveLength(0);
    expect(receipt(journal)).toMatchObject({ status: "dry_run", event: "COMMENT" });
  });

  test("cancels preflight before POST with a terminal task_cancelled receipt", async () => {
    const source = capture();
    const journal = journalFor(source);
    const started = Promise.withResolvers<void>();
    const fake = fakeGitHub({
      actorWait: async (signal) => {
        started.resolve();
        if (!signal?.aborted) {
          await new Promise<void>((resolve) => {
            signal?.addEventListener("abort", () => resolve(), { once: true });
            if (!signal) resolve();
          });
        }
      },
    });
    const controller = new AbortController();
    const pending = toolFor(source, journal, fake).execute(
      { capture_handle: CAPTURE_HANDLE, dry_run: false },
      controller.signal,
    );
    await started.promise;

    controller.abort("token=github_pat_CANCELSECRET");
    await expect(pending).rejects.toMatchObject({ code: "task_cancelled" });

    expect(fake.calls.filter((argv) => argv.includes("POST"))).toHaveLength(0);
    expect(fake.options[0]?.signal).toBe(controller.signal);
    expect(receipt(journal)).toMatchObject({
      status: "failed",
      failure_code: "task_cancelled",
      mutation_guard_active: false,
    });
    expect(JSON.stringify(receipt(journal))).not.toContain("CANCELSECRET");
  });

  for (const event of ["COMMENT", "REQUEST_CHANGES", "APPROVE"] as const) {
    test(`submits one pinned grouped ${event} payload through private --input`, async () => {
      const source = capture(event);
      const plan = buildReviewPlanFromCapture(source);
      const journal = journalFor(source);
      const fake = fakeGitHub();
      const result = await toolFor(source, journal, fake).execute({ capture_handle: CAPTURE_HANDLE, dry_run: false });

      expect(fake.payloads).toEqual([plan.payload]);
      const posts = fake.calls.filter((argv) => argv.includes("POST"));
      expect(posts).toEqual([["gh", "api", "--method", "POST", "repos/acme/widgets/pulls/42/reviews", "--input", fake.inputPaths[0]!]]);
      expect(fake.calls.some((argv) => argv[1] === "pr" || argv.join(" ").includes("issues/42/comments") || (argv.includes("POST") && argv.some((arg) => /pulls\/42\/comments/.test(arg))))).toBe(false);
      expect(fake.inputPaths.every((path) => !existsSync(path))).toBe(true);
      expect(result).toMatchObject({ status: "published", event, github_review_id: 900 });
      expect(receipt(journal)).toMatchObject({ status: "published", event, github_review_id: 900 });
    });
  }

  test("fails closed before mutation for role drift, stale/closed PR, permission, and self-review", async () => {
    const cases = [
      { options: {}, check: () => { throw new Error("role drift github_pat_SECRET"); }, code: "role_integrity_drift" },
      { options: { pullHeads: ["f".repeat(40)] }, code: "stale_head" },
      { options: { state: "closed" }, code: "pr_not_open" },
      { options: { permissions: { pull: true, push: false } }, code: "permission_denied" },
      { options: { actor: "author", author: "AUTHOR" }, code: "self_review_denied" },
    ] as const;
    for (const item of cases) {
      const source = capture("REQUEST_CHANGES");
      const journal = journalFor(source);
      const fake = fakeGitHub(item.options);
      const tool = toolFor(source, journal, fake, item.check ?? (() => roles));
      await expect(tool.execute({ capture_handle: CAPTURE_HANDLE, dry_run: false }))
        .rejects.toMatchObject({ code: item.code });
      expect(fake.calls.filter((argv) => argv.includes("POST"))).toHaveLength(0);
      const stored = receipt(journal);
      expect(stored).toMatchObject({ status: "failed", failure_code: item.code });
      expect(JSON.stringify(stored)).not.toContain("github_pat_SECRET");
    }
  });

  test("paginates reviews and inline comments, returning identical authored marker IDs without POST", async () => {
    const source = capture();
    const plan = buildReviewPlanFromCapture(source);
    const remote = remoteFor(plan);
    const junk = Array.from({ length: 100 }, (_, id) => ({ id, user: { login: "other" }, body: "no marker" }));
    const journal = journalFor(source);
    const fake = fakeGitHub({
      reviewPages: (_call, page) => page === 1 ? junk : [remote.review],
      commentPages: (_call, page) => page === 1 ? junk : remote.comments,
    });
    const result = await toolFor(source, journal, fake).execute({ capture_handle: CAPTURE_HANDLE, dry_run: false });

    expect(result).toMatchObject({ status: "existing", github_review_id: 700, github_inline_comment_ids: [701] });
    expect(fake.calls.filter((argv) => argv.includes("POST"))).toHaveLength(0);
    expect(receipt(journal)).toMatchObject({ status: "published", github_review_id: 700 });
  });

  test("rejects same-run conflicting event and never treats a prepared receipt as publication authority", async () => {
    const source = capture();
    const plan = buildReviewPlanFromCapture(source);
    const remote = remoteFor(plan);
    remote.review.state = "APPROVED";
    const journal = journalFor(source);
    const fake = fakeGitHub({ reviewPages: () => [remote.review], commentPages: () => remote.comments });
    await expect(toolFor(source, journal, fake).execute({ capture_handle: CAPTURE_HANDLE, dry_run: false }))
      .rejects.toMatchObject({ code: "same_head_conflict" });
    expect(fake.calls.filter((argv) => argv.includes("POST"))).toHaveLength(0);

    const second = fakeGitHub();
    const invalid = createPrReviewPublishTool({
      state: { lookupCapture: () => { throw new Error("unknown capture handle"); } },
      journalForCapture: () => { throw new Error("receipt must not authorize lookup"); },
      exec: second.exec,
      loadManifest: () => manifest,
      checkRoles: () => roles,
    });
    await expect(invalid.execute({ capture_handle: "z".repeat(32), dry_run: false }))
      .rejects.toMatchObject({ code: "invalid_arguments" });
    expect(second.calls).toHaveLength(0);
  });

  test("deduplicates sequential fresh same-head captures and rejects a fresh conflicting event", async () => {
    const firstSource = capture("REQUEST_CHANGES");
    const secondHandle = `${CAPTURE_HANDLE}-fresh`;
    const conflictHandle = `${CAPTURE_HANDLE}-conflict`;
    const secondSource = capture("REQUEST_CHANGES", secondHandle);
    const conflictSource = capture("APPROVE", conflictHandle);
    const plan = buildReviewPlanFromCapture(firstSource);
    const firstJournal = journalFor(firstSource);
    const secondJournal = journalFor(secondSource);
    const conflictJournal = journalFor(conflictSource);
    let published: RemoteFixture | undefined;
    const fake = fakeGitHub({
      reviewPages: () => published ? [published.review] : [],
      commentPages: () => published?.comments ?? [],
    });
    const original = fake.exec;
    fake.exec = async (argv, options) => {
      const result = await original(argv, options);
      if (argv.includes("POST")) published = remoteFor(plan, 900);
      return result;
    };
    const tool = toolForCaptures(new Map([
      [firstSource.captureHandle, { source: firstSource, journal: firstJournal }],
      [secondSource.captureHandle, { source: secondSource, journal: secondJournal }],
      [conflictSource.captureHandle, { source: conflictSource, journal: conflictJournal }],
    ]), fake);

    const first = await tool.execute({ capture_handle: firstSource.captureHandle, dry_run: false });
    const second = await tool.execute({ capture_handle: secondSource.captureHandle, dry_run: false });
    await expect(tool.execute({ capture_handle: conflictSource.captureHandle, dry_run: false }))
      .rejects.toMatchObject({ code: "same_head_conflict" });

    expect(first).toMatchObject({ status: "published", github_review_id: 900 });
    expect(second).toMatchObject({ status: "existing", github_review_id: 900 });
    expect(fake.calls.filter((argv) => argv.includes("POST"))).toHaveLength(1);
    expect(receipt(firstJournal)).toMatchObject({ status: "published", github_review_id: 900 });
    expect(receipt(secondJournal)).toMatchObject({ status: "published", github_review_id: 900 });
    expect(receipt(conflictJournal)).toMatchObject({
      status: "failed",
      failure_code: "same_head_conflict",
    });
  });

  test("serializes concurrent fresh same-head captures by run key", async () => {
    const firstSource = capture("REQUEST_CHANGES");
    const secondSource = capture("REQUEST_CHANGES", `${CAPTURE_HANDLE}-concurrent`);
    const plan = buildReviewPlanFromCapture(firstSource);
    const firstJournal = journalFor(firstSource);
    const secondJournal = journalFor(secondSource);
    let published: RemoteFixture | undefined;
    let releasePost!: () => void;
    let signalPostStarted!: () => void;
    const postWait = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    const postStarted = new Promise<void>((resolve) => {
      signalPostStarted = resolve;
    });
    const fake = fakeGitHub({
      postStarted: signalPostStarted,
      postWait,
      reviewPages: () => published ? [published.review] : [],
      commentPages: () => published?.comments ?? [],
    });
    const original = fake.exec;
    fake.exec = async (argv, options) => {
      const result = await original(argv, options);
      if (argv.includes("POST")) published = remoteFor(plan, 900);
      return result;
    };
    const tool = toolForCaptures(new Map([
      [firstSource.captureHandle, { source: firstSource, journal: firstJournal }],
      [secondSource.captureHandle, { source: secondSource, journal: secondJournal }],
    ]), fake);

    const firstPending = tool.execute({ capture_handle: firstSource.captureHandle, dry_run: false });
    await postStarted;
    const secondPending = tool.execute({ capture_handle: secondSource.captureHandle, dry_run: false });
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    expect(fake.calls.filter((argv) => argv.includes("user"))).toHaveLength(1);
    releasePost();
    const results = await Promise.all([firstPending, secondPending]);

    expect(results.map((result) => result.status).sort()).toEqual(["existing", "published"]);
    expect(results.map((result) => result.github_review_id)).toEqual([900, 900]);
    expect(fake.calls.filter((argv) => argv.includes("POST"))).toHaveLength(1);
    expect([receipt(firstJournal), receipt(secondJournal)]).toEqual([
      expect.objectContaining({ status: "published", github_review_id: 900 }),
      expect.objectContaining({ status: "published", github_review_id: 900 }),
    ]);
  });

  test("records known IDs as indeterminate when post-publication head read fails, then recovers without POST", async () => {
    const firstSource = capture("REQUEST_CHANGES");
    const secondSource = capture("REQUEST_CHANGES", `${CAPTURE_HANDLE}-recovery`);
    const plan = buildReviewPlanFromCapture(firstSource);
    const firstJournal = journalFor(firstSource);
    const secondJournal = journalFor(secondSource);
    let published: RemoteFixture | undefined;
    const fake = fakeGitHub({
      postPullResult: {
        exitCode: 1,
        stdout: "",
        stderr: "gh: API rate limit exceeded (HTTP 429)",
      },
      reviewPages: () => published ? [published.review] : [],
      commentPages: () => published?.comments ?? [],
    });
    const original = fake.exec;
    fake.exec = async (argv, options) => {
      const result = await original(argv, options);
      if (argv.includes("POST")) published = remoteFor(plan, 900);
      return result;
    };
    const tool = toolForCaptures(new Map([
      [firstSource.captureHandle, { source: firstSource, journal: firstJournal }],
      [secondSource.captureHandle, { source: secondSource, journal: secondJournal }],
    ]), fake);

    await expect(tool.execute({ capture_handle: firstSource.captureHandle, dry_run: false }))
      .rejects.toMatchObject({ code: "publication_indeterminate" });
    expect(receipt(firstJournal)).toMatchObject({
      status: "indeterminate",
      failure_code: "publication_indeterminate",
      event: plan.event,
      payload_digest: plan.payloadDigest,
      github_review_id: 900,
      github_inline_comment_ids: [901],
      github_inline_comment_markers: plan.findings.map((finding) => finding.marker),
    });

    const recovered = await tool.execute({ capture_handle: secondSource.captureHandle, dry_run: false });
    expect(recovered).toMatchObject({
      status: "existing",
      github_review_id: 900,
      github_inline_comment_ids: [901],
    });
    expect(fake.calls.filter((argv) => argv.includes("POST"))).toHaveLength(1);
    expect(receipt(firstJournal)).toMatchObject({
      status: "indeterminate",
      github_review_id: 900,
    });
    expect(receipt(secondJournal)).toMatchObject({
      status: "published",
      github_review_id: 900,
      github_inline_comment_ids: [901],
    });
  });

  test("retains ambiguous run-key evidence until an exact marker appears", async () => {
    const firstSource = capture("REQUEST_CHANGES");
    const secondSource = capture("REQUEST_CHANGES", `${CAPTURE_HANDLE}-ambiguous-second`);
    const thirdSource = capture("REQUEST_CHANGES", `${CAPTURE_HANDLE}-ambiguous-recovery`);
    const plan = buildReviewPlanFromCapture(firstSource);
    const remote = remoteFor(plan, 900);
    const firstJournal = journalFor(firstSource);
    const secondJournal = journalFor(secondSource);
    const thirdJournal = journalFor(thirdSource);
    let markerVisible = false;
    const fake = fakeGitHub({
      postResult: { exitCode: 1, stdout: "", stderr: "request timed out" },
      reviewPages: () => markerVisible ? [remote.review] : [],
      commentPages: () => markerVisible ? remote.comments : [],
    });
    const tool = toolForCaptures(new Map([
      [firstSource.captureHandle, { source: firstSource, journal: firstJournal }],
      [secondSource.captureHandle, { source: secondSource, journal: secondJournal }],
      [thirdSource.captureHandle, { source: thirdSource, journal: thirdJournal }],
    ]), fake);

    await expect(tool.execute({ capture_handle: firstSource.captureHandle, dry_run: false }))
      .rejects.toMatchObject({ code: "publication_indeterminate" });
    await expect(tool.execute({ capture_handle: secondSource.captureHandle, dry_run: false }))
      .rejects.toMatchObject({ code: "publication_indeterminate" });

    expect(fake.calls.filter((argv) => argv.includes("POST"))).toHaveLength(1);
    for (const journal of [firstJournal, secondJournal]) {
      expect(receipt(journal)).toMatchObject({
        status: "indeterminate",
        failure_code: "publication_indeterminate",
        event: plan.event,
        payload_digest: plan.payloadDigest,
        github_inline_comment_markers: plan.findings.map((finding) => finding.marker),
      });
    }

    markerVisible = true;
    const recovered = await tool.execute({
      capture_handle: thirdSource.captureHandle,
      dry_run: false,
    });
    expect(recovered).toMatchObject({
      status: "existing",
      github_review_id: 900,
      github_inline_comment_ids: [901],
    });
    expect(fake.calls.filter((argv) => argv.includes("POST"))).toHaveLength(1);
    expect(receipt(thirdJournal)).toMatchObject({
      status: "published",
      github_review_id: 900,
      github_inline_comment_ids: [901],
    });
  });

  test("recovers one ambiguous POST by one exact marker lookup without retry", async () => {
    const source = capture();
    const plan = buildReviewPlanFromCapture(source);
    const remote = remoteFor(plan, 800);
    const journal = journalFor(source);
    const fake = fakeGitHub({
      postResult: { exitCode: 1, stdout: "", stderr: "request timed out" },
      reviewPages: (call) => call === 1 ? [] : [remote.review],
      commentPages: (call) => call === 1 ? [] : remote.comments,
    });
    const result = await toolFor(source, journal, fake).execute({ capture_handle: CAPTURE_HANDLE, dry_run: false });

    expect(result).toMatchObject({ status: "published", github_review_id: 800 });
    expect(fake.calls.filter((argv) => argv.includes("POST"))).toHaveLength(1);
    expect(fake.calls.filter((argv) => argv.some((arg) => arg.includes("/reviews?per_page=100&page=1")))).toHaveLength(2);
    expect(fake.calls.filter((argv) => argv.some((arg) => arg.includes("/comments?per_page=100&page=1")))).toHaveLength(2);
    expect(receipt(journal)).toMatchObject({ status: "published", github_review_id: 800 });
  });

  for (const markerVisible of [true, false]) {
    test(`aborted POST performs one fresh bounded marker reconciliation (${markerVisible ? "recovered" : "indeterminate"})`, async () => {
      const source = capture();
      const plan = buildReviewPlanFromCapture(source);
      const remote = remoteFor(plan, 850);
      const journal = journalFor(source);
      const postStarted = Promise.withResolvers<void>();
      const fake = fakeGitHub({
        postStarted: () => postStarted.resolve(),
        postWait: async (signal) => {
          if (!signal?.aborted) {
            await new Promise<void>((resolve) => {
              signal?.addEventListener("abort", () => resolve(), { once: true });
              if (!signal) resolve();
            });
          }
        },
        postResult: {
          exitCode: 1,
          stdout: "",
          stderr: "operation aborted token=github_pat_POSTSECRET",
        },
        reviewPages: (call) => call === 1 || !markerVisible ? [] : [remote.review],
        commentPages: (call) => call === 1 || !markerVisible ? [] : remote.comments,
      });
      const controller = new AbortController();
      const pending = toolFor(source, journal, fake).execute(
        { capture_handle: CAPTURE_HANDLE, dry_run: false },
        controller.signal,
      );
      await postStarted.promise;

      controller.abort();
      if (markerVisible) {
        await expect(pending).resolves.toMatchObject({
          status: "published",
          github_review_id: 850,
          github_inline_comment_ids: [851],
        });
      } else {
        await expect(pending).rejects.toMatchObject({
          code: "publication_indeterminate",
        });
      }

      const postIndex = fake.calls.findIndex((argv) => argv.includes("POST"));
      expect(postIndex).toBeGreaterThan(-1);
      expect(fake.options[postIndex]?.signal).toBe(controller.signal);
      const reconciliationIndexes = fake.calls.flatMap((argv, index) =>
        argv.some((arg) =>
            arg.includes("/reviews?per_page=100&page=1")
            || arg.includes("/comments?per_page=100&page=1")
          )
          ? [index]
          : []
      ).slice(2);
      expect(reconciliationIndexes).toHaveLength(2);
      for (const index of reconciliationIndexes) {
        expect(fake.options[index]?.signal).not.toBe(controller.signal);
        expect(fake.options[index]?.signal?.aborted).toBe(false);
        expect(Number(fake.options[index]?.timeoutMs)).toBeGreaterThan(0);
      }
      expect(fake.calls.filter((argv) => argv.includes("POST"))).toHaveLength(1);
      expect(receipt(journal)).toMatchObject(markerVisible
        ? {
          status: "published",
          github_review_id: 850,
          github_inline_comment_ids: [851],
        }
        : {
          status: "indeterminate",
          failure_code: "publication_indeterminate",
          github_inline_comment_markers: plan.findings.map((finding) => finding.marker),
        });
      expect(JSON.stringify(receipt(journal))).not.toContain("POSTSECRET");
    });
  }

  test("caller abort during fresh marker lookup cannot cancel recovered post-head verification", async () => {
    const source = capture();
    const plan = buildReviewPlanFromCapture(source);
    const remote = remoteFor(plan, 875);
    const journal = journalFor(source);
    const fake = fakeGitHub({
      postResult: { exitCode: 1, stdout: "", stderr: "request timed out" },
      reviewPages: (call) => call === 1 ? [] : [remote.review],
      commentPages: (call) => call === 1 ? [] : remote.comments,
    });
    const controller = new AbortController();
    const originalExec = fake.exec;
    let reviewReads = 0;
    fake.exec = async (argv, options) => {
      if (argv.some((arg) => arg.includes("/reviews?per_page=100&page=1"))) {
        reviewReads += 1;
        if (reviewReads === 2) controller.abort();
      }
      return originalExec(argv, options);
    };

    const result = await toolFor(source, journal, fake).execute(
      { capture_handle: CAPTURE_HANDLE, dry_run: false },
      controller.signal,
    );

    const recoveryReviewIndex = fake.calls.findLastIndex((argv) =>
      argv.some((arg) => arg.includes("/reviews?per_page=100&page=1"))
    );
    const postHeadIndex = fake.calls.findLastIndex((argv) =>
      argv.at(-1) === "repos/acme/widgets/pulls/42"
    );
    expect(result).toMatchObject({
      status: "published",
      github_review_id: 875,
      github_inline_comment_ids: [876],
    });
    expect(controller.signal.aborted).toBe(true);
    expect(fake.options[recoveryReviewIndex]?.signal).not.toBe(controller.signal);
    expect(fake.options[postHeadIndex]?.signal).toBe(
      fake.options[recoveryReviewIndex]?.signal,
    );
    expect(receipt(journal)).toMatchObject({
      status: "published",
      github_review_id: 875,
      github_inline_comment_ids: [876],
    });
  });

  test("default role recheck is read-only on an identical rerun with a terminal published receipt", async () => {
    const source = capture();
    const plan = buildReviewPlanFromCapture(source);
    const journal = journalFor(source);
    const roleManifest = defaultManifestFixture();
    let published: RemoteFixture | undefined;
    const fake = fakeGitHub({
      reviewPages: (call) => call === 1 ? [] : published ? [published.review] : [],
      commentPages: (call) => call === 1 ? [] : published?.comments ?? [],
    });
    const original = fake.exec;
    fake.exec = async (argv, options) => {
      const result = await original(argv, options);
      if (argv.includes("POST")) published = remoteFor(plan, 900);
      return result;
    };
    const tool = createPrReviewPublishTool({
      state: { lookupCapture: () => source },
      journalForCapture: () => journal,
      exec: fake.exec,
      loadManifest: () => roleManifest,
    });

    await tool.execute({ capture_handle: CAPTURE_HANDLE, dry_run: false });
    const second = await tool.execute({ capture_handle: CAPTURE_HANDLE, dry_run: false });

    expect(second).toMatchObject({ status: "existing", github_review_id: 900 });
    expect(fake.calls.filter((argv) => argv.includes("POST"))).toHaveLength(1);
    expect(receipt(journal)).toMatchObject({ status: "published", github_review_id: 900 });
  });

  test("later role failure receipts every earlier prepublish observation and preserves unchecked pre-call evidence", async () => {
    const source = capture();
    const journal = journalFor(source);
    const roleManifest = defaultManifestFixture();
    const failedRole = roleManifest.roles[1]!;
    const driftedBytes = "drifted role bytes";
    writeFileSync(failedRole.canonicalPath, driftedBytes, { mode: 0o600 });
    const fake = fakeGitHub();
    const tool = createPrReviewPublishTool({
      state: { lookupCapture: () => source },
      journalForCapture: () => journal,
      exec: fake.exec,
      loadManifest: () => roleManifest,
    });

    await expect(tool.execute({ capture_handle: CAPTURE_HANDLE, dry_run: false }))
      .rejects.toMatchObject({ code: "role_integrity_drift" });

    const stored = receipt(journal) as { status: string; roles: Array<Record<string, unknown>> };
    expect(stored.status).toBe("failed");
    expect(stored.roles).toHaveLength(3);
    expect(stored.roles[0]).toMatchObject({
      agent: "wf7-fable-reviewer",
      preCallSha256: "1".repeat(64),
      preCallValid: true,
      prePublishSha256: roleManifest.roles[0]!.sha256,
      prePublishValid: true,
    });
    expect(stored.roles[1]).toMatchObject({
      agent: "wf7-sol-reviewer",
      preCallSha256: "1".repeat(64),
      preCallValid: true,
      prePublishSha256: createHash("sha256").update(driftedBytes).digest("hex"),
      prePublishValid: false,
    });
    expect(stored.roles[2]).toMatchObject({
      agent: "wf7-grok-judge",
      preCallSha256: "1".repeat(64),
      preCallValid: true,
    });
    expect(stored.roles[2]).not.toHaveProperty("prePublishSha256");
    expect(stored.roles[2]).not.toHaveProperty("prePublishValid");
    expect(fake.calls).toHaveLength(0);
  });

  test("serializes concurrent identical calls per capture, publishes once, and releases the lock", async () => {
    const source = capture();
    const plan = buildReviewPlanFromCapture(source);
    const journal = journalFor(source);
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    let published: RemoteFixture | undefined;
    const fake = fakeGitHub({
      postStarted: () => started.resolve(),
      postWait: finish.promise,
      reviewPages: (call) => call === 1 ? [] : published ? [published.review] : [],
      commentPages: (call) => call === 1 ? [] : published?.comments ?? [],
    });
    const original = fake.exec;
    fake.exec = async (argv, options) => {
      const result = await original(argv, options);
      if (argv.includes("POST")) published = remoteFor(plan, 900);
      return result;
    };
    const tool = toolFor(source, journal, fake);

    const first = tool.execute({ capture_handle: CAPTURE_HANDLE, dry_run: false });
    await started.promise;
    const second = tool.execute({ capture_handle: CAPTURE_HANDLE, dry_run: false });
    for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
    const postsBeforeRelease = fake.calls.filter((argv) => argv.includes("POST")).length;
    finish.resolve();
    const results = await Promise.all([first, second]);
    expect(postsBeforeRelease).toBe(1);
    const third = await tool.execute({ capture_handle: CAPTURE_HANDLE, dry_run: false });

    expect(results[0]).toMatchObject({ status: "published", github_review_id: 900 });
    expect(results[1]).toMatchObject({ status: "existing", github_review_id: 900 });
    expect(third).toMatchObject({ status: "existing", github_review_id: 900 });
    expect(fake.calls.filter((argv) => argv.includes("POST"))).toHaveLength(1);
    expect(receipt(journal)).toMatchObject({ status: "published", github_review_id: 900 });
  });

  for (const [label, stdout] of [
    ["malformed response", "not-json"],
    ["missing review ID", JSON.stringify({ comments: [{ id: 901 }] })],
    ["missing inline comment ID", JSON.stringify({ id: 900, comments: [{}] })],
  ] as const) {
    test(`records zero-exit ${label} as indeterminate after exactly one recovery lookup`, async () => {
      const source = capture();
      const journal = journalFor(source);
      const fake = fakeGitHub({
        postResult: { exitCode: 0, stdout, stderr: "" },
      });

      await expect(toolFor(source, journal, fake).execute({ capture_handle: CAPTURE_HANDLE, dry_run: false }))
        .rejects.toMatchObject({ code: "publication_indeterminate" });

      expect(fake.calls.filter((argv) => argv.includes("POST"))).toHaveLength(1);
      expect(fake.calls.filter((argv) => argv.some((arg) => arg.includes("/reviews?per_page=100&page=1")))).toHaveLength(2);
      expect(fake.calls.filter((argv) => argv.some((arg) => arg.includes("/comments?per_page=100&page=1")))).toHaveLength(2);
      expect(receipt(journal)).toMatchObject({
        status: "indeterminate",
        failure_code: "publication_indeterminate",
      });
    });
  }

  for (const [stderr, code, status] of [
    ["gh: HTTP 429 rate limit exceeded", "rate_limited", "failed"],
    ["gh: Validation Failed (HTTP 422)", "github_api_failed", "failed"],
    ["gh: server failure (HTTP 500)", "github_api_failed", "failed"],
    ["request timed out", "publication_indeterminate", "indeterminate"],
  ] as const) {
    test(`records unrecovered ${code} without retry`, async () => {
      const source = capture();
      const journal = journalFor(source);
      const fake = fakeGitHub({ postResult: { exitCode: 1, stdout: "", stderr } });
      await expect(toolFor(source, journal, fake).execute({ capture_handle: CAPTURE_HANDLE, dry_run: false }))
        .rejects.toMatchObject({ code });
      expect(fake.calls.filter((argv) => argv.includes("POST"))).toHaveLength(1);
      expect(receipt(journal)).toMatchObject({ status, failure_code: code });
    });
  }

  for (const stderr of [
    "unexpected EOF",
    "write EPIPE",
    "broken pipe",
    "premature close",
    "terminated by signal SIGTERM",
    "unknown process failure",
  ]) {
    test(`treats non-HTTP transport failure '${stderr}' as indeterminate after one recovery`, async () => {
      const source = capture();
      const journal = journalFor(source);
      const fake = fakeGitHub({ postResult: { exitCode: 1, stdout: "", stderr } });

      await expect(toolFor(source, journal, fake).execute({ capture_handle: CAPTURE_HANDLE, dry_run: false }))
        .rejects.toMatchObject({ code: "publication_indeterminate" });

      expect(fake.calls.filter((argv) => argv.includes("POST"))).toHaveLength(1);
      expect(fake.calls.filter((argv) => argv.some((arg) => arg.includes("/reviews?per_page=100&page=1")))).toHaveLength(2);
      expect(fake.calls.filter((argv) => argv.some((arg) => arg.includes("/comments?per_page=100&page=1")))).toHaveLength(2);
      expect(receipt(journal)).toMatchObject({
        status: "indeterminate",
        failure_code: "publication_indeterminate",
      });
    });
  }

  test("records post-publication head race and repeated exact run never posts twice", async () => {
    const source = capture();
    const plan = buildReviewPlanFromCapture(source);
    const journal = journalFor(source);
    let published: RemoteFixture | undefined;
    const fake = fakeGitHub({
      pullHeads: [HEAD, "f".repeat(40), HEAD],
      reviewPages: (call) => call === 1 ? [] : published ? [published.review] : [],
      commentPages: (call) => call === 1 ? [] : published?.comments ?? [],
    });
    const original = fake.exec;
    fake.exec = async (argv, options) => {
      const result = await original(argv, options);
      if (argv.includes("POST")) published = remoteFor(plan, 900);
      return result;
    };
    const tool = toolFor(source, journal, fake);
    const first = await tool.execute({ capture_handle: CAPTURE_HANDLE, dry_run: false });
    const second = await tool.execute({ capture_handle: CAPTURE_HANDLE, dry_run: false });

    expect(first).toMatchObject({ status: "published", published_on_superseded_head: true });
    expect(second).toMatchObject({ status: "existing", github_review_id: 900 });
    expect(fake.calls.filter((argv) => argv.includes("POST"))).toHaveLength(1);
    expect(receipt(journal)).toMatchObject({
      status: "published",
      post_publish_head_sha: "f".repeat(40),
      published_on_superseded_head: true,
    });
  });
});
