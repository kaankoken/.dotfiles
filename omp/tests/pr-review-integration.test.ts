import { createHash } from "node:crypto";
import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FakeExtensionApi,
  resultEvent,
  runFakeReview,
  targetFiles,
} from "./pr-review-fixture";
import defaultExtension, {
  createPrReviewExtension,
} from "../extensions/pr-review/index";
import { WF7_ROLE_SPECS } from "../extensions/pr-review/contracts";
import roleManifestJson from "../extensions/pr-review/role-manifest.json";
import type { LoadedRoleManifest } from "../extensions/pr-review/role-integrity";
import type {
  NativeTaskCallEvent,
} from "../extensions/pr-review/capture";
import type { PrReviewExec } from "../extensions/pr-review/github";
import type { PrReviewPublishResult } from "../extensions/pr-review/publish-tool";
import type { SnapshotCreateResult } from "../extensions/pr-review/snapshot-tool";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type PublicSnapshotCreate = SnapshotCreateResult & {
  next_task: Record<string, unknown>;
};

type PublicSnapshotStatus =
  | { status: "pending"; next_task: Record<string, unknown> }
  | { status: "completed"; capture_handle: string };

interface DualRunFixture {
  api: FakeExtensionApi;
  root: string;
  targetDir: string;
  receiptRoot: string;
  stateRoot: string;
  guardRoutes: string[];
  alphaAtRepository: Promise<void>;
  releaseAlpha: () => void;
  signals: Array<AbortSignal | undefined>;
}

function receiptFiles(root: string): Array<Record<string, unknown>> {
  const values: Array<Record<string, unknown>> = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".json")) {
        values.push(JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>);
      }
    }
  };
  visit(root);
  return values;
}

function execOk(value: unknown) {
  return {
    exitCode: 0,
    stdout: typeof value === "string" ? value : JSON.stringify(value),
    stderr: "",
  };
}

async function dualRunFixture(
  options: { ignoreAbort?: boolean } = {},
): Promise<DualRunFixture> {
  const root = mkdtempSync(join(tmpdir(), "wf7-dual-run-"));
  roots.push(root);
  const targetDir = join(root, "repo");
  const receiptRoot = join(root, "receipts");
  const stateRoot = join(root, "state");
  mkdirSync(targetDir, { recursive: true });
  const targets = {
    alpha: {
      pull: 1,
      base: "b".repeat(40),
      head: "a".repeat(40),
      path: "src/a.ts",
      replacement: "alpha",
    },
    beta: {
      pull: 2,
      base: "d".repeat(40),
      head: "c".repeat(40),
      path: "src/a.ts",
      replacement: "beta",
    },
  } as const;
  let alphaReached!: () => void;
  let releaseAlpha!: () => void;
  const alphaAtRepository = new Promise<void>((resolve) => {
    alphaReached = resolve;
  });
  const alphaRelease = new Promise<void>((resolve) => {
    releaseAlpha = resolve;
  });
  let delayedAlpha = false;
  const signals: Array<AbortSignal | undefined> = [];
  const exec: PrReviewExec = async (argv, callOptions = {}) => {
    signals.push(callOptions.signal);
    const call = [...argv];
    const endpoint = call.find((argument) => argument.startsWith("repos/")) ?? call.at(-1)!;
    if (endpoint === "user") return execOk({ login: "reviewer", id: 1 });
    for (const [repo, target] of Object.entries(targets)) {
      if (endpoint === `repos/owner/${repo}`) {
        if (repo === "alpha" && !delayedAlpha) {
          delayedAlpha = true;
          alphaReached();
          if (options.ignoreAbort) {
            await alphaRelease;
          } else {
            await Promise.race([
              alphaRelease,
              new Promise<void>((resolve) => {
                callOptions.signal?.addEventListener("abort", () => resolve(), { once: true });
              }),
            ]);
            if (callOptions.signal?.aborted) {
              return { exitCode: 1, stdout: "", stderr: "operation aborted" };
            }
          }
        }
        return execOk({
          id: target.pull,
          node_id: `R_${repo}`,
          full_name: `owner/${repo}`,
          permissions: { pull: true, push: true },
        });
      }
      const pullEndpoint = `repos/owner/${repo}/pulls/${target.pull}`;
      if (
        endpoint === pullEndpoint
        && call.some((argument) => argument === "Accept: application/vnd.github.v3.diff")
      ) {
        return execOk([
          `diff --git a/${target.path} b/${target.path}`,
          `--- a/${target.path}`,
          `+++ b/${target.path}`,
          "@@ -1 +1 @@",
          "-old",
          `+${target.replacement}`,
          "",
        ].join("\n"));
      }
      if (endpoint === `${pullEndpoint}/files?per_page=100&page=1`) {
        return execOk([{
          filename: target.path,
          status: "modified",
          patch: `@@ -1 +1 @@\n-old\n+${target.replacement}`,
        }]);
      }
      if (endpoint === pullEndpoint) {
        return execOk({
          state: "open",
          draft: false,
          merged: false,
          changed_files: 1,
          user: { login: "author" },
          base: { sha: target.base, repo: { full_name: `owner/${repo}` } },
          head: { sha: target.head, repo: { full_name: `owner/${repo}` } },
        });
      }
      if (
        endpoint === `${pullEndpoint}/reviews?per_page=100&page=1`
        || endpoint === `${pullEndpoint}/comments?per_page=100&page=1`
      ) return execOk([]);
    }
    throw new Error(`unexpected dual-run argv: ${JSON.stringify(call)}`);
  };

  const guardRoutes: string[] = [];
  const api = new FakeExtensionApi();
  const roleObservations = WF7_ROLE_SPECS.map((role) => ({
    agent: role.agent,
    livePath: `/live/${role.agent}.md`,
    preCallSha256: "1".repeat(64),
    preCallValid: true,
  }));
  await createPrReviewExtension({
    config: { task: { batch: true, maxConcurrency: 2 }, github: { enabled: true } },
    cwd: targetDir,
    exec,
    receiptRootDir: receiptRoot,
    stateRootDir: stateRoot,
    manifest: { version: 1, digest: "1".repeat(64), roles: [] },
    checkAtRegistration: () => [],
    checkAtPreCall: () => roleObservations,
    checkAtPublish: () => roleObservations.map((observation) => ({
      ...observation,
      prePublishSha256: "1".repeat(64),
      prePublishValid: true,
    })),
    verifySlot: () => undefined,
    createGuard: (_manifest, journal) => {
      let active = true;
      return {
        get active() {
          return active;
        },
        handleToolCall(event) {
          if (event.toolName === "task") guardRoutes.push(journal.currentReceipt.repo);
          return undefined;
        },
        stop() {
          active = false;
        },
      };
    },
    now: () => "2026-07-31T12:00:00.000Z",
  })(api);
  return {
    api,
    root,
    targetDir,
    receiptRoot,
    stateRoot,
    guardRoutes,
    alphaAtRepository,
    releaseAlpha,
    signals,
  };
}

async function createReversed(fixture: DualRunFixture) {
  const alphaPromise = fixture.api.executeTool<PublicSnapshotCreate>(
    "pr_review_snapshot",
    { action: "create", target: "owner/alpha#1", dry_run: true },
    "create-alpha",
  );
  await fixture.alphaAtRepository;
  const beta = await fixture.api.executeTool<PublicSnapshotCreate>(
    "pr_review_snapshot",
    { action: "create", target: "owner/beta#2", dry_run: true },
    "create-beta",
  );
  fixture.releaseAlpha();
  const alpha = await alphaPromise;
  return { alpha, beta };
}

async function completeReview(
  api: FakeExtensionApi,
  created: PublicSnapshotCreate,
  prefix: string,
  cwd: string,
): Promise<string> {
  let nextTask = created.next_task;
  for (let step = 1; step <= 3; step += 1) {
    const call: NativeTaskCallEvent = {
      type: "tool_call",
      toolName: "task",
      toolCallId: `${prefix}-task-${step}`,
      input: structuredClone(nextTask),
      cwd,
    };
    expect(await api.emitCall(call)).toBeUndefined();
    await api.emitResult(resultEvent(call, "request_changes", "user"));
    const status = await api.executeTool<PublicSnapshotStatus>(
      "pr_review_snapshot",
      { action: "status", run_handle: created.run_handle },
      `${prefix}-status-${step}`,
    );
    if (status.status === "completed") return status.capture_handle;
    nextTask = status.next_task;
  }
  throw new Error("capture did not complete");
}

describe("production PR-review extension", () => {
  test("loads the exported default factory from an arbitrary cwd", async () => {
    const root = mkdtempSync(join(tmpdir(), "wf7-default-extension-"));
    roots.push(root);
    const arbitraryRepo = join(root, "repo");
    const stateHome = join(root, "state");
    mkdirSync(arbitraryRepo, { recursive: true });
    const priorCwd = process.cwd();
    const priorStateHome = process.env.XDG_STATE_HOME;
    const canonicalDir = join(root, "canonical-agents");
    const liveDir = join(root, "home", ".omp", "agent", "agents");
    mkdirSync(canonicalDir, { recursive: true });
    mkdirSync(liveDir, { recursive: true });
    const ompRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const roles = roleManifestJson.roles.map((role) => {
      const source = join(ompRoot, "agents", `${role.agent}.md`);
      const trackedPath = join(canonicalDir, `${role.agent}.md`);
      const livePath = join(liveDir, `${role.agent}.md`);
      const bytes = readFileSync(source);
      writeFileSync(trackedPath, bytes, { mode: 0o600 });
      const canonicalPath = realpathSync(trackedPath);
      symlinkSync(canonicalPath, livePath);
      return {
        ...role,
        livePath,
        canonicalPath,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    });
    const manifest: LoadedRoleManifest = {
      version: 1,
      digest: createHash("sha256").update(JSON.stringify(roles)).digest("hex"),
      roles,
    };
    const api = new FakeExtensionApi();
    try {
      process.chdir(arbitraryRepo);
      process.env.XDG_STATE_HOME = stateHome;
      await defaultExtension(api, {
        manifest,
        stateRootDir: join(stateHome, "runs"),
      });
    } finally {
      process.chdir(priorCwd);
      if (priorStateHome === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = priorStateHome;
    }
    expect([...api.commands.keys()]).toEqual(["review-pr"]);
    expect([...api.tools.keys()]).toEqual([
      "pr_review_snapshot",
      "pr_review_publish",
    ]);
    expect(api.hooks.get("tool_call")).toHaveLength(1);
    expect(existsSync(join(arbitraryRepo, ".omp"))).toBe(false);
  });

  test("registers one command, strict read/exec tools, and capture hooks", async () => {
    expect(typeof createPrReviewExtension).toBe("function");

    const run = await runFakeReview({ dryRun: true, decision: "reject" });
    roots.push(run.root);
    expect([...run.api.commands.keys()]).toEqual(["review-pr"]);
    expect([...run.api.tools.keys()]).toEqual([
      "pr_review_snapshot",
      "pr_review_publish",
    ]);
    expect(run.api.tools.get("pr_review_snapshot")).toMatchObject({
      approval: "read",
      strict: true,
    });
    expect(run.api.tools.get("pr_review_publish")).toMatchObject({
      approval: "exec",
      strict: true,
    });
    expect(run.api.hooks.get("tool_call")).toHaveLength(1);
    expect(run.api.hooks.get("tool_result")).toHaveLength(1);
    expect(run.api.hooks.get("session_shutdown")).toHaveLength(1);
  });

  test("registered snapshot cancellation reaches argv execution and tears down state", async () => {
    const fixture = await dualRunFixture();
    const controller = new AbortController();
    const pending = fixture.api.executeTool<PublicSnapshotCreate>(
      "pr_review_snapshot",
      { action: "create", target: "owner/alpha#1", dry_run: true },
      "cancel-alpha",
      controller.signal,
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await fixture.alphaAtRepository;

    controller.abort("token=github_pat_REGISTEREDSECRET");
    fixture.releaseAlpha();
    const outcome = await pending;

    if (!("error" in outcome)) throw new Error("cancelled snapshot unexpectedly completed");
    expect(outcome.error).toMatchObject({ code: "task_cancelled" });
    expect(fixture.signals.length).toBeGreaterThan(0);
    expect(fixture.signals.every((signal) => signal !== controller.signal)).toBe(true);
    expect(fixture.signals.every((signal) => signal?.aborted)).toBe(true);
    expect(readdirSync(fixture.stateRoot)).toEqual([]);
    const stored = receiptFiles(fixture.receiptRoot).find((receipt) =>
      receipt.repo === "alpha"
    );
    expect(stored).toMatchObject({
      status: "failed",
      failure_code: "task_cancelled",
      mutation_guard_active: false,
    });
    expect(JSON.stringify(stored)).not.toContain("REGISTEREDSECRET");
  });

  test("registered publish forwards its signal through every preflight child", async () => {
    const fixture = await dualRunFixture();
    const created = await fixture.api.executeTool<PublicSnapshotCreate>(
      "pr_review_snapshot",
      { action: "create", target: "owner/beta#2", dry_run: true },
      "signal-beta",
    );
    const captureHandle = await completeReview(
      fixture.api,
      created,
      "signal-beta",
      fixture.targetDir,
    );
    const controller = new AbortController();
    const priorCalls = fixture.signals.length;

    const result = await fixture.api.executeTool<PrReviewPublishResult>(
      "pr_review_publish",
      { capture_handle: captureHandle, dry_run: true },
      "signal-publish-beta",
      controller.signal,
    );

    const publishSignals = fixture.signals.slice(priorCalls);
    expect(result.status).toBe("dry_run");
    expect(publishSignals.length).toBeGreaterThan(0);
    expect(publishSignals.every((signal) => signal === controller.signal)).toBe(true);
    expect(readdirSync(fixture.stateRoot)).toEqual([]);
  });

  test("correlates reversed creates and audits an unattributed concurrent task call", async () => {
    const fixture = await dualRunFixture();
    const { alpha, beta } = await createReversed(fixture);

    expect(beta).toMatchObject({
      repo: "beta",
      pull_number: 2,
      head_sha: "c".repeat(40),
    });
    expect(alpha).toMatchObject({
      repo: "alpha",
      pull_number: 1,
      head_sha: "a".repeat(40),
    });
    for (const created of [alpha, beta]) {
      const tasks = created.next_task.tasks as Array<{ task: string }>;
      for (const task of tasks) {
        expect(JSON.parse(task.task)).toMatchObject({
          snapshot_handle: created.snapshot_handle,
          head_sha: created.head_sha,
          diff_digest: created.diff_digest,
        });
      }
    }
    const betaRead = await fixture.api.executeTool<{ content: string }>(
      "pr_review_snapshot",
      {
        action: "read",
        snapshot_handle: beta.snapshot_handle,
        offset: 0,
        length: beta.diff_size,
      },
      "read-beta",
    );
    const alphaRead = await fixture.api.executeTool<{ content: string }>(
      "pr_review_snapshot",
      {
        action: "read",
        snapshot_handle: alpha.snapshot_handle,
        offset: 0,
        length: alpha.diff_size,
      },
      "read-alpha",
    );
    expect(betaRead.content).toContain("+beta");
    expect(alphaRead.content).toContain("+alpha");

    const unknownCall = await fixture.api.emitCall({
      type: "tool_call",
      toolName: "task",
      toolCallId: "unknown-task-call",
      input: {
        tasks: [{
          name: "unbound",
          task: JSON.stringify({ snapshot_handle: "unknown-call-secret" }),
        }],
      },
      cwd: fixture.targetDir,
    });
    expect(unknownCall).toEqual({
      block: true,
      reason: expect.stringContaining("WF7"),
    });
    expect(await fixture.api.executeTool(
      "pr_review_snapshot",
      { action: "status", run_handle: alpha.run_handle },
      "alpha-still-active",
    )).toMatchObject({ status: "pending" });
    expect(await fixture.api.executeTool(
      "pr_review_snapshot",
      { action: "status", run_handle: beta.run_handle },
      "beta-still-active",
    )).toMatchObject({ status: "pending" });
    const audit = receiptFiles(fixture.receiptRoot).find(
      (receipt) => receipt.repo === "invalid-task-call",
    );
    expect(audit).toMatchObject({
      status: "failed",
      failure_code: "task_envelope_invalid",
      mutation_guard_active: false,
    });
    expect(JSON.stringify(audit)).not.toContain("unknown-call-secret");
    expect(audit).not.toHaveProperty("completed_capture_digest");

    const betaCapture = await completeReview(
      fixture.api,
      beta,
      "beta",
      fixture.targetDir,
    );
    const alphaCapture = await completeReview(
      fixture.api,
      alpha,
      "alpha",
      fixture.targetDir,
    );
    expect(betaCapture).not.toBe(alphaCapture);
    expect(fixture.guardRoutes).toEqual([
      "beta",
      "beta",
      "beta",
      "alpha",
      "alpha",
      "alpha",
    ]);

    const betaPublish = await fixture.api.executeTool<PrReviewPublishResult>(
      "pr_review_publish",
      { capture_handle: betaCapture, dry_run: true },
      "publish-beta",
    );
    expect(betaPublish.status).toBe("dry_run");
    expect(readdirSync(fixture.stateRoot)).toHaveLength(1);
    expect(await fixture.api.executeTool(
      "pr_review_snapshot",
      { action: "status", run_handle: alpha.run_handle },
      "alpha-survives-beta-terminal",
    )).toMatchObject({ status: "completed", capture_handle: alphaCapture });
    const alphaPublish = await fixture.api.executeTool<PrReviewPublishResult>(
      "pr_review_publish",
      { capture_handle: alphaCapture, dry_run: true },
      "publish-alpha",
    );
    expect(alphaPublish.status).toBe("dry_run");
    expect(readdirSync(fixture.stateRoot)).toEqual([]);

    const attempts = receiptFiles(fixture.receiptRoot);
    expect(attempts.find((receipt) => receipt.repo === "alpha")).toMatchObject({
      owner: "owner",
      repo: "alpha",
      pull_number: 1,
      head_sha: alpha.head_sha,
      diff_digest: alpha.diff_digest,
      status: "dry_run",
    });
    expect(attempts.find((receipt) => receipt.repo === "beta")).toMatchObject({
      owner: "owner",
      repo: "beta",
      pull_number: 2,
      head_sha: beta.head_sha,
      diff_digest: beta.diff_digest,
      status: "dry_run",
    });
  });

  test("blocks an extra bound task call and revokes only its run", async () => {
    const fixture = await dualRunFixture();
    const { alpha, beta } = await createReversed(fixture);
    const first: NativeTaskCallEvent = {
      type: "tool_call",
      toolName: "task",
      toolCallId: "alpha-task",
      input: structuredClone(alpha.next_task),
      cwd: fixture.targetDir,
    };
    expect(await fixture.api.emitCall(first)).toBeUndefined();
    expect(await fixture.api.emitCall({
      ...first,
      toolCallId: "alpha-extra-task",
    })).toEqual({
      block: true,
      reason: expect.stringContaining("Invalid WF7 task envelope"),
    });
    await expect(fixture.api.executeTool(
      "pr_review_snapshot",
      { action: "status", run_handle: alpha.run_handle },
      "alpha-revoked",
    )).rejects.toThrow("unknown run handle");
    expect(await fixture.api.emitCall({
      ...first,
      toolCallId: "alpha-revoked-handle",
    })).toEqual({
      block: true,
      reason: expect.stringContaining("Unattributed WF7"),
    });
    expect(await fixture.api.executeTool(
      "pr_review_snapshot",
      { action: "status", run_handle: beta.run_handle },
      "beta-survives-revoked-alpha",
    )).toMatchObject({ status: "pending" });
    expect(receiptFiles(fixture.receiptRoot).filter(
      (receipt) => receipt.repo === "invalid-task-call",
    )).toHaveLength(1);
    expect(readdirSync(fixture.stateRoot)).toHaveLength(1);
    expect(receiptFiles(fixture.receiptRoot).find(
      (receipt) => receipt.repo === "alpha",
    )).toMatchObject({
      status: "failed",
      failure_code: "task_envelope_invalid",
    });

    await fixture.api.emitShutdown();
    expect(readdirSync(fixture.stateRoot)).toEqual([]);
  });

  test("blocks a bound live-run task while another snapshot create awaits", async () => {
    const fixture = await dualRunFixture();
    const beta = await fixture.api.executeTool<PublicSnapshotCreate>(
      "pr_review_snapshot",
      { action: "create", target: "owner/beta#2", dry_run: true },
      "ready-beta",
    );
    const alphaPromise = fixture.api.executeTool<PublicSnapshotCreate>(
      "pr_review_snapshot",
      { action: "create", target: "owner/alpha#1", dry_run: true },
      "pending-alpha-with-beta",
    );
    await fixture.alphaAtRepository;
    const betaCall: NativeTaskCallEvent = {
      type: "tool_call",
      toolName: "task",
      toolCallId: "beta-task-during-alpha-create",
      input: structuredClone(beta.next_task),
      cwd: fixture.targetDir,
    };
    expect(await fixture.api.emitCall(betaCall)).toBeUndefined();
    await fixture.api.emitResult(resultEvent(betaCall, "request_changes", "user"));
    expect(await fixture.api.executeTool(
      "pr_review_snapshot",
      { action: "status", run_handle: beta.run_handle },
      "beta-advanced-during-alpha-pending",
    )).toMatchObject({ status: "pending" });
    expect(receiptFiles(fixture.receiptRoot).filter(
      (receipt) => receipt.repo === "invalid-task-call",
    )).toHaveLength(0);

    fixture.releaseAlpha();
    await alphaPromise;
    await fixture.api.emitShutdown();
    expect(readdirSync(fixture.stateRoot)).toEqual([]);
  });

  test("cancelled pending create cannot block a legitimate new run task", async () => {
    const fixture = await dualRunFixture({ ignoreAbort: true });
    const alphaPromise = fixture.api.executeTool<PublicSnapshotCreate>(
      "pr_review_snapshot",
      { action: "create", target: "owner/alpha#1", dry_run: true },
      "pending-alpha",
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await fixture.alphaAtRepository;

    expect(await fixture.api.emitCall({
      type: "tool_call",
      toolName: "task",
      toolCallId: "task-during-pending-create",
      input: { tasks: [{ name: "foreign", task: "{}" }] },
      cwd: fixture.targetDir,
    })).toEqual({
      block: true,
      reason: expect.stringContaining("WF7"),
    });
    const beta = await fixture.api.executeTool<PublicSnapshotCreate>(
      "pr_review_snapshot",
      { action: "create", target: "owner/beta#2", dry_run: true },
      "beta-after-cancelled-alpha",
    );
    expect(await fixture.api.emitCall({
      type: "tool_call",
      toolName: "task",
      toolCallId: "beta-task-after-cancelled-alpha",
      input: structuredClone(beta.next_task),
      cwd: fixture.targetDir,
    })).toBeUndefined();
    fixture.releaseAlpha();
    const outcome = await alphaPromise;
    await fixture.api.emitShutdown();
    expect(readdirSync(fixture.stateRoot)).toEqual([]);
    expect(receiptFiles(fixture.receiptRoot).find(
      (receipt) => receipt.repo === "alpha",
    )).toMatchObject({
      status: "failed",
      failure_code: "task_envelope_invalid",
      mutation_guard_active: false,
    });
  });

  test("shutdown revokes a pending create and late completion cannot resurrect it", async () => {
    const fixture = await dualRunFixture();
    const alphaPromise = fixture.api.executeTool<PublicSnapshotCreate>(
      "pr_review_snapshot",
      { action: "create", target: "owner/alpha#1", dry_run: true },
      "shutdown-pending-alpha",
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await fixture.alphaAtRepository;

    await fixture.api.emitShutdown();
    const outcome = await alphaPromise;
    expect(fixture.signals.some((signal) => signal?.aborted)).toBe(true);
    expect(readdirSync(fixture.stateRoot)).toEqual([]);
    expect(receiptFiles(fixture.receiptRoot).find(
      (receipt) => receipt.repo === "alpha",
    )).toMatchObject({
      status: "failed",
      failure_code: "internal_error",
      mutation_guard_active: false,
    });
    expect(outcome).toHaveProperty("error");
    expect(readdirSync(fixture.stateRoot)).toEqual([]);
    expect(receiptFiles(fixture.receiptRoot).filter(
      (receipt) => receipt.repo === "alpha",
    )).toHaveLength(1);
  });

  test("drives exact next-turn, two batches, judge, sealed status, and dry-run receipt", async () => {
    const run = await runFakeReview({ dryRun: true, decision: "reject" });
    roots.push(run.root);

    expect(run.api.messages).toHaveLength(1);
    expect(run.api.messages[0]!.options).toEqual({
      deliverAs: "nextTurn",
      triggerTurn: true,
    });
    expect(run.api.messages[0]!.payload).toContain("WF7 PR REVIEW CONTROLLER PROTOCOL v1");
    expect(run.api.messages[0]!.payload).toContain("TARGET: owner/repo#7");
    expect(run.api.messages[0]!.payload).toContain("DRY_RUN: true");
    expect(run.githubCalls.some((call) => call.includes("repos/owner/repo"))).toBe(true);
    expect(run.githubCalls.some((call) => call.some((arg) => arg.includes("octo/repo")))).toBe(false);

    expect(run.captureHandle).toHaveLength(43);
    expect(run.publishResult).toMatchObject({
      status: "dry_run",
      event: "APPROVE",
      comment_count: 0,
    });
    expect(run.posts).toHaveLength(0);
    const batches = run.api.taskCalls.map((call) => {
      const tasks = call.input.tasks;
      if (!Array.isArray(tasks)) throw new Error("public next_task omitted tasks");
      return tasks.map((task) => {
        if (!task || typeof task !== "object" || !(("name") in task)) {
          throw new Error("public next_task contained invalid task");
        }
        return task.name;
      });
    });
    expect(batches).toEqual([
      ["wf7-fable-initial", "wf7-sol-initial"],
      ["wf7-fable-rebuttal", "wf7-sol-rebuttal"],
      ["wf7-grok-judge"],
    ]);
    expect(run.receipt.status).toBe("dry_run");
    expect(run.receipt.tasks.map((task) => task.task)).toEqual([
      "wf7-fable-initial",
      "wf7-sol-initial",
      "wf7-fable-rebuttal",
      "wf7-sol-rebuttal",
      "wf7-grok-judge",
    ]);
    expect(new Set(run.receipt.tasks.map((task) => task.nativeToolCallId))).toEqual(
      new Set(["task-1", "task-2", "task-3"]),
    );
    expect(run.receipt.head_sha).toBe("a".repeat(40));
    expect(run.receipt.diff_digest).toHaveLength(64);
    expect(run.receipt.roles.every((role) => role.prePublishValid)).toBe(true);
    expect(targetFiles(run.targetDir)).toEqual(["sentinel.txt"]);
    expect(readFileSync(join(run.targetDir, "sentinel.txt"), "utf8")).toBe("untouched");
  });

  test("denies direct GitHub comment mutation outside opaque publisher", async () => {
    const run = await runFakeReview({
      dryRun: true,
      decision: "reject",
      probeDirectWrite: true,
    });
    roots.push(run.root);
    expect(run.boundaryResults).toHaveLength(14);
    for (const result of run.boundaryResults!.slice(0, 10)) {
      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("GitHub"),
      });
    }
    expect(run.boundaryResults!.slice(10)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(run.posts).toHaveLength(0);
    expect(run.receipt.status).toBe("dry_run");
  });


  test("keeps mutation boundary through publish and releases after terminal receipt", async () => {
    const run = await runFakeReview({
      dryRun: true,
      decision: "reject",
      probeGuardLifetime: true,
    });
    roots.push(run.root);
    expect(run.prePublishBlock).toEqual({
      block: true,
      reason: expect.stringContaining("GitHub"),
    });
    expect(run.prePublishGuardActive).toBe(true);
    expect(run.publishResult?.status).toBe("dry_run");
    expect(run.receipt.mutation_guard_active).toBe(false);
    expect(run.receipt.status).toBe("dry_run");
    expect(run.postPublishBlock).toBeUndefined();
  });

  test("tears down state for every terminal publication outcome", async () => {
    const cases = [
      {
        options: { dryRun: true, decision: "reject" as const },
        receiptStatus: "dry_run",
        resultStatus: "dry_run",
      },
      {
        options: { dryRun: false, decision: "request_changes" as const },
        receiptStatus: "published",
        resultStatus: "published",
      },
      {
        options: {
          dryRun: false,
          decision: "request_changes" as const,
          runCount: 2,
        },
        receiptStatus: "published",
        resultStatus: "existing",
      },
      {
        options: { dryRun: false, decision: "accept" as const, staleAtPublish: true },
        receiptStatus: "failed",
        resultStatus: undefined,
      },
      {
        options: {
          dryRun: false,
          decision: "request_changes" as const,
          indeterminateAtPublish: true,
        },
        receiptStatus: "indeterminate",
        resultStatus: undefined,
      },
    ];
    for (const entry of cases) {
      const run = await runFakeReview(entry.options);
      roots.push(run.root);
      expect(run.receipt.status).toBe(entry.receiptStatus);
      expect(run.publishResult?.status).toBe(entry.resultStatus);
      expect(readdirSync(run.stateRoot)).toEqual([]);
    }
  });

  test("rejects every handle after terminal receipt finalization", async () => {
    const run = await runFakeReview({ dryRun: true, decision: "reject" });
    roots.push(run.root);
    expect(readdirSync(run.stateRoot)).toEqual([]);
    await expect(run.api.executeTool(
      "pr_review_snapshot",
      {
        action: "read",
        snapshot_handle: run.snapshotHandle!,
        offset: 0,
        length: 1,
      },
      "read-after-terminal",
    )).rejects.toThrow("unknown snapshot handle");
    await expect(run.api.executeTool(
      "pr_review_snapshot",
      { action: "status", run_handle: run.runHandle! },
      "status-after-terminal",
    )).rejects.toThrow("unknown run handle");
    await expect(run.api.executeTool(
      "pr_review_publish",
      { capture_handle: run.captureHandle!, dry_run: true },
      "capture-after-terminal",
    )).rejects.toThrow(/unknown capture handle|live completed capture/);
  });
  test("session shutdown terminally receipts and removes every live run", async () => {
    const run = await runFakeReview({
      dryRun: true,
      decision: "reject",
      shutdownAfterCreate: true,
    });
    roots.push(run.root);
    expect(run.receipt).toMatchObject({
      status: "failed",
      failure_code: "internal_error",
      mutation_guard_active: false,
    });
    expect(readdirSync(run.stateRoot)).toEqual([]);
    await expect(run.api.executeTool(
      "pr_review_snapshot",
      { action: "status", run_handle: run.runHandle! },
      "status-after-shutdown",
    )).rejects.toThrow("unknown run handle");
    await expect(run.api.executeTool(
      "pr_review_snapshot",
      {
        action: "read",
        snapshot_handle: run.snapshotHandle!,
        offset: 0,
        length: 1,
      },
      "read-after-shutdown",
    )).rejects.toThrow("unknown snapshot handle");
  });
  test("fails closed on project role shadow with typed receipt and zero writes", async () => {
    const run = await runFakeReview({ dryRun: false, agentSource: "project" });
    roots.push(run.root);
    expect(run.receipt.status).toBe("failed");
    expect(run.receipt.failure_code).toBe("project_shadow");
    expect(run.receipt.completed_capture_digest).toBeUndefined();
    expect(run.posts).toHaveLength(0);
    expect(targetFiles(run.targetDir)).toEqual(["sentinel.txt"]);
    expect(readdirSync(run.stateRoot)).toEqual([]);
  });

  test("publishes one grouped inline-only review from opaque capture", async () => {
    const run = await runFakeReview({ dryRun: false, decision: "request_changes" });
    roots.push(run.root);
    expect(run.publishResult).toMatchObject({
      status: "published",
      event: "REQUEST_CHANGES",
      comment_count: 2,
    });
    expect(run.posts).toHaveLength(1);
    expect(run.posts[0]).toMatchObject({
      commit_id: "a".repeat(40),
      event: "REQUEST_CHANGES",
      body: expect.stringContaining("findings are inline"),
    });
    expect(run.posts[0]!.comments).toHaveLength(2);
    expect(JSON.stringify(run.posts[0])).not.toContain("candidate body");
    expect(run.githubCalls.filter((call) => call.includes("POST"))).toHaveLength(1);
    expect(run.githubCalls.some((call) => call.some((arg) => /issues\/.+\/comments/.test(arg)))).toBe(false);
    expect(run.githubCalls.some((call) => call[0] === "gh" && call[1] === "pr" && call[2] === "comment")).toBe(false);
    expect(run.receipt.status).toBe("published");
    expect(run.receipt.head_sha).toBe("a".repeat(40));
    expect(run.receipt.diff_digest).toHaveLength(64);
  });

  test("fresh sequential same-head review commands preserve attempts and reuse remote publication", async () => {
    const run = await runFakeReview({
      dryRun: false,
      decision: "request_changes",
      runCount: 2,
    });
    roots.push(run.root);

    expect(run.api.messages).toHaveLength(2);
    expect(run.posts).toHaveLength(1);
    expect(run.publishResults).toEqual([
      expect.objectContaining({
        status: "published",
        github_review_id: 77,
        github_inline_comment_ids: [100, 101],
      }),
      expect.objectContaining({
        status: "existing",
        github_review_id: 77,
        github_inline_comment_ids: [100, 101],
      }),
    ]);
    expect(run.receipts).toEqual([
      expect.objectContaining({ status: "published", github_review_id: 77 }),
      expect.objectContaining({ status: "published", github_review_id: 77 }),
    ]);
    expect(run.receipts![0]).not.toBe(run.receipts![1]);
  });

  test("stale publish head fails before mutation", async () => {
    const run = await runFakeReview({
      dryRun: false,
      decision: "accept",
      staleAtPublish: true,
    });
    roots.push(run.root);
    expect(run.publishResult).toBeUndefined();
    expect(run.receipt.status).toBe("failed");
    expect(run.receipt.failure_code).toBe("stale_head");
    expect(run.posts).toHaveLength(0);
  });

  test("link/config discovery is user-scoped from an arbitrary repository", () => {
    const root = mkdtempSync(join(tmpdir(), "wf7-link-integration-"));
    roots.push(root);
    const agentDir = join(root, "home", ".omp", "agent");
    const arbitraryRepo = join(root, "other-repo");
    mkdirSync(arbitraryRepo, { recursive: true });
    const ompRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const result = Bun.spawnSync(["sh", join(ompRoot, "link.sh")], {
      cwd: arbitraryRepo,
      env: { ...process.env, OMP_AGENT_DIR: agentDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(agentDir, "config.yml"))).toBe(true);
    expect(existsSync(join(agentDir, "extensions", "pr-review", "index.ts"))).toBe(true);
    for (const role of ["wf7-fable-reviewer", "wf7-sol-reviewer", "wf7-grok-judge"]) {
      const live = join(agentDir, "agents", `${role}.md`);
      expect(existsSync(live)).toBe(true);
      expect(realpathSync(live)).toBe(join(ompRoot, "agents", `${role}.md`));
    }
    expect(lstatSync(join(agentDir, "extensions")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(agentDir, "extensions"))).toBe(join(ompRoot, "extensions"));
    expect(existsSync(join(arbitraryRepo, ".omp"))).toBe(false);
  });
});
