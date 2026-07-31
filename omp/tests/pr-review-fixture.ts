import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPrReviewExtension,
  type PrReviewExtensionApi,
} from "../extensions/pr-review/index";
import {
  PR_REVIEW_ROLE_SPECS,
  PR_REVIEW_TASK_SLOTS,
  type PrReviewReceiptV1,
  type PrReviewTaskBinding,
  type PrReviewTaskName,
  type PrReviewTaskSlot,
} from "../extensions/pr-review/contracts";
import type { PrReviewExec } from "../extensions/pr-review/github";
import type {
  NativeTaskCallEvent,
  NativeTaskResultEvent,
} from "../extensions/pr-review/capture";
import type {
  LoadedRoleManifest,
  RoleMutationGuard,
} from "../extensions/pr-review/role-integrity";
import type {
  InitialReview,
  JudgeResult,
  Rebuttal,
} from "../extensions/pr-review/validation";
import type { SnapshotCreateResult } from "../extensions/pr-review/snapshot-tool";
import type { PrReviewPublishResult } from "../extensions/pr-review/publish-tool";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const TASK_WRAPPER = "Complete the assignment below, thoroughly:\n\n";
const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "",
].join("\n");
const PATCH = "@@ -1 +1 @@\n-old\n+new";

export type RegisteredTool = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  approval?: string;
  strict?: boolean;
  execute: (...args: unknown[]) => unknown;
};

type Command = Record<string, unknown> & {
  handler: (first: unknown, second?: unknown) => unknown;
};
type Hook = (
  event?: NativeTaskCallEvent | NativeTaskResultEvent,
  context?: { cwd?: string },
) => unknown;
type StageOutput = InitialReview | Rebuttal | JudgeResult;
type TaskItem = {
  name: PrReviewTaskName;
  agent: string;
  task: string;
  outputSchema: Record<string, unknown>;
  schemaMode: "strict";
  isolated: true;
};
type NextTask = {
  context: string;
  tasks: TaskItem[];
};
type PublicSnapshotCreateResult = SnapshotCreateResult & { next_task: NextTask };
type PublicSnapshotStatusResult =
  | { status: "pending"; next_task: NextTask }
  | { status: "completed"; capture_handle: string };

export class FakeExtensionApi implements PrReviewExtensionApi {
  readonly commands = new Map<string, Command>();
  readonly tools = new Map<string, RegisteredTool>();
  readonly hooks = new Map<string, Hook[]>();
  readonly messages: Array<{ payload: string; options: unknown }> = [];
  readonly taskCalls: NativeTaskCallEvent[] = [];

  registerCommand(name: string, options: Record<string, unknown>): void {
    if (typeof options.handler !== "function") throw new Error(`missing command handler for ${name}`);
    this.commands.set(name, { ...options, handler: options.handler });
  }

  registerTool(tool: RegisteredTool): void {
    this.tools.set(tool.name, tool);
  }

  on(event: "tool_call" | "tool_result" | "session_shutdown", handler: Hook): void {
    const handlers = this.hooks.get(event) ?? [];
    handlers.push(handler);
    this.hooks.set(event, handlers);
  }

  async sendMessage(
    payload: string,
    options: { deliverAs: "nextTurn"; triggerTurn: true },
  ): Promise<void> {
    this.messages.push({ payload, options });
  }

  async executeTool<T extends object>(
    name: string,
    input: Record<string, unknown>,
    toolCallId = `${name}-call`,
    signal?: AbortSignal,
  ): Promise<T> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`missing tool ${name}`);
    const result = await tool.execute(toolCallId, input, signal, undefined, {
      cwd: process.cwd(),
    });
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      !("content" in result) ||
      !Array.isArray(result.content) ||
      !("details" in result)
    ) throw new Error(`tool ${name} returned an invalid AgentToolResult`);
    const value = result.details;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`tool ${name} returned non-object details`);
    }
    return value as T;
  }

  async emitCall(event: NativeTaskCallEvent): Promise<unknown> {
    if (event.toolName === "task") this.taskCalls.push(structuredClone(event));
    for (const handler of this.hooks.get("tool_call") ?? []) {
      const result = await handler(event, { cwd: event.cwd ?? process.cwd() });
      if (result && typeof result === "object" && "block" in result && result.block === true) {
        return result;
      }
    }
    return undefined;
  }

  async emitResult(event: NativeTaskResultEvent): Promise<void> {
    for (const handler of this.hooks.get("tool_result") ?? []) {
      await handler(event, { cwd: process.cwd() });
    }
  }

  async emitShutdown(): Promise<void> {
    for (const handler of this.hooks.get("session_shutdown") ?? []) {
      await handler(undefined, { cwd: process.cwd() });
    }
  }
}

export type FakeRunOptions = {
  dryRun?: boolean;
  decision?: "accept" | "reject" | "request_changes";
  agentSource?: "user" | "project";
  staleAtPublish?: boolean;
  probeDirectWrite?: boolean;
  probeGuardLifetime?: boolean;
  runCount?: number;
  indeterminateAtPublish?: boolean;
  shutdownAfterCreate?: boolean;
};

export type FakeRunResult = {
  api: FakeExtensionApi;
  root: string;
  targetDir: string;
  receiptRoot: string;
  stateRoot: string;
  runHandle?: string;
  snapshotHandle?: string;
  receipt: PrReviewReceiptV1;
  githubCalls: readonly string[][];
  posts: readonly Record<string, unknown>[];
  publishResult?: Record<string, unknown>;
  captureHandle?: string;
  blocked?: unknown;
  boundaryResults?: readonly unknown[];
  directWriteBlock?: unknown;
  prePublishBlock?: unknown;
  postPublishBlock?: unknown;
  prePublishGuardActive?: boolean;
  receipts?: readonly PrReviewReceiptV1[];
  publishResults?: readonly (Record<string, unknown> | undefined)[];
};


function manifest(root: string): LoadedRoleManifest {
  return {
    version: 1,
    digest: createHash("sha256").update("fake manifest").digest("hex"),
    roles: PR_REVIEW_ROLE_SPECS.map((role) => ({
      livePath: join(root, "live", `${role.agent}.md`),
      canonicalPath: join(root, "canonical", `${role.agent}.md`),
      sha256: "1".repeat(64),
      agent: role.agent,
      model: role.model,
      tools: ["pr_review_snapshot"],
      spawns: [],
      blocking: true,
      schemas: [],
    })),
  };
}

function observations(prePublish = false) {
  return PR_REVIEW_ROLE_SPECS.map((role) => ({
    agent: role.agent,
    livePath: `/live/${role.agent}.md`,
    checkedRealpath: `/canonical/${role.agent}.md`,
    preCallSha256: "1".repeat(64),
    ...(prePublish ? { prePublishSha256: "1".repeat(64) } : {}),
    preCallValid: true,
    ...(prePublish ? { prePublishValid: true } : {}),
  }));
}

function noopGuard(): RoleMutationGuard {
  let active = true;
  return {
    get active() {
      return active;
    },
    handleToolCall() {
      return undefined;
    },
    stop() {
      active = false;
    },
  };
}

function ok(value: unknown) {
  return {
    exitCode: 0,
    stdout: typeof value === "string" ? value : JSON.stringify(value),
    stderr: "",
  };
}

function fakeGithub(options: FakeRunOptions) {
  const calls: string[][] = [];
  const posts: Record<string, unknown>[] = [];
  let pullReads = 0;
  let publishedReview: Record<string, unknown> | undefined;
  let publishedComments: Record<string, unknown>[] = [];
  const exec: PrReviewExec = async (argv) => {
    const call = [...argv];
    calls.push(call);
    const endpoint = call.find((arg) => arg.startsWith("repos/")) ?? call.at(-1)!;
    if (endpoint === "user") return ok({ login: "reviewer", id: 1 });
    if (endpoint === "repos/owner/repo") {
      return ok({
        id: 9,
        node_id: "R_repo",
        full_name: "owner/repo",
        permissions: { pull: true, push: true },
      });
    }
    if (endpoint === "repos/owner/repo/pulls/7/files?per_page=100&page=1") {
      return ok([{ filename: "src/a.ts", status: "modified", patch: PATCH }]);
    }
    if (
      endpoint === "repos/owner/repo/pulls/7" &&
      call.some((arg) => arg === "Accept: application/vnd.github.v3.diff")
    ) return ok(DIFF);
    if (endpoint === "repos/owner/repo/pulls/7") {
      pullReads += 1;
      const stale = options.staleAtPublish && pullReads >= 3;
      return ok({
        state: "open",
        draft: false,
        merged: false,
        changed_files: 1,
        user: { login: "author" },
        base: { sha: BASE, repo: { full_name: "owner/repo" } },
        head: {
          sha: stale ? "c".repeat(40) : HEAD,
          repo: { full_name: "owner/repo" },
        },
      });
    }
    if (endpoint === "repos/owner/repo/pulls/7/reviews?per_page=100&page=1") {
      return ok(publishedReview ? [publishedReview] : []);
    }
    if (endpoint === "repos/owner/repo/pulls/7/comments?per_page=100&page=1") {
      return ok(publishedComments);
    }
    if (
      options.indeterminateAtPublish
      && call.includes("POST")
      && endpoint === "repos/owner/repo/pulls/7/reviews"
    ) {
      return { exitCode: 1, stdout: "", stderr: "network outcome unknown" };
    }
    if (call.includes("POST") && endpoint === "repos/owner/repo/pulls/7/reviews") {
      const input = call[call.indexOf("--input") + 1];
      if (!input) throw new Error("missing private payload path");
      const payload = JSON.parse(readFileSync(input, "utf8")) as Record<string, unknown>;
      posts.push(payload);
      const event = payload.event;
      const state = event === "REQUEST_CHANGES"
        ? "CHANGES_REQUESTED"
        : event === "COMMENT"
        ? "COMMENTED"
        : "APPROVED";
      publishedReview = {
        id: 77,
        user: { login: "reviewer" },
        state,
        commit_id: payload.commit_id,
        body: payload.body,
      };
      publishedComments = (payload.comments as Record<string, unknown>[]).map((comment, index) => ({
        ...comment,
        id: 100 + index,
        pull_request_review_id: 77,
        user: { login: "reviewer" },
      }));
      return ok({ id: 77, comments: publishedComments });
    }
    throw new Error(`unexpected fake GitHub argv: ${JSON.stringify(call)}`);
  };
  return { exec, calls, posts };
}


function outputFor(
  slot: PrReviewTaskSlot,
  binding: PrReviewTaskBinding,
  decision: NonNullable<FakeRunOptions["decision"]>,
): StageOutput {
  const common = {
    schema_version: 1,
    run_nonce: binding.run_nonce,
    snapshot_nonce: binding.snapshot_nonce,
    call_nonce: binding.call_nonce,
    head_sha: binding.head_sha,
    diff_digest: binding.diff_digest,
  };
  if (slot.stage === "initial") {
    const reviewer = slot.name.includes("fable") ? "fable" : "sol";
    return {
      ...common,
      reviewer,
      findings: [{
        id: "one",
        path: "src/a.ts",
        line: 1,
        side: "RIGHT",
        severity: reviewer === "fable" ? "blocking" : "nonblocking",
        title: `${reviewer} title`,
        body: `${reviewer} candidate body`,
        evidence: `${reviewer} evidence`,
      }],
    };
  }
  if (slot.stage === "rebuttal") {
    const reviewer = slot.name.includes("fable") ? "fable" : "sol";
    const peer = reviewer === "fable" ? "sol:one" : "fable:one";
    return {
      ...common,
      reviewer,
      responses: [{ peer_finding_id: peer, stance: "support", rationale: "confirmed" }],
      withdrawn_own_ids: [],
    };
  }
  const adjudications = ["fable:one", "sol:one"].map((id) =>
    decision === "reject"
      ? { source_finding_ids: [id], decision, rationale: "reject internally" }
      : {
        source_finding_ids: [id],
        decision,
        rationale: "judge rationale",
        anchor_source_finding_id: id,
        body: `judge body for ${id}`,
      }
  );
  return { ...common, adjudications, overall_rationale: "complete partition" };
}

export function resultEvent(
  call: NativeTaskCallEvent,
  decision: NonNullable<FakeRunOptions["decision"]>,
  agentSource: NonNullable<FakeRunOptions["agentSource"]>,
): NativeTaskResultEvent {
  const items = call.input.tasks as TaskItem[];
  const results = items.map((item, index) => {
    const slot = PR_REVIEW_TASK_SLOTS.find((candidate) => candidate.name === item.name)!;
    const binding = JSON.parse(item.task) as PrReviewTaskBinding;
    const data = outputFor(slot, binding, decision);
    const role = PR_REVIEW_ROLE_SPECS.find((candidate) => candidate.agent === slot.agent)!;
    return {
      index,
      id: `${slot.name}-2`,
      agent: slot.agent,
      agentSource,
      assignment: item.task,
      task: `${TASK_WRAPPER}${item.task}`,
      exitCode: 0,
      output: "ignored presentation",
      stderr: "",
      truncated: false,
      durationMs: 1,
      tokens: 1,
      requests: 1,
      resolvedModel: role.model,
      resolvedModelIsFallback: false,
      aborted: false,
      structuredOutput: { source: "caller", mode: "strict", status: "valid", data },
      extractedToolData: {
        yield: [{ status: "success", type: "result", data }],
      },
    };
  });
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

function findReceipt(root: string): PrReviewReceiptV1 {
  const paths: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".json")) paths.push(path);
    }
  };
  visit(root);
  const receipts = paths.map((path) => JSON.parse(readFileSync(path, "utf8")) as PrReviewReceiptV1);
  const matching = receipts.filter((receipt) => receipt.head_sha === HEAD);
  return matching.at(-1) ?? receipts.at(-1)!;
}

export async function runFakeReview(options: FakeRunOptions = {}): Promise<FakeRunResult> {
  const dryRun = options.dryRun ?? true;
  const decision = options.decision ?? "request_changes";
  const agentSource = options.agentSource ?? "user";
  const root = mkdtempSync(join(tmpdir(), "pr-review-integration-"));
  const targetDir = join(root, "arbitrary-repo");
  const receiptRoot = join(root, "receipts");
  const stateRoot = join(root, "state");
  Bun.write(join(targetDir, "sentinel.txt"), "untouched");
  const github = fakeGithub(options);
  const loadedManifest = manifest(root);
  const api = new FakeExtensionApi();
  const extension = createPrReviewExtension({
    config: { task: { batch: true, maxConcurrency: 2 }, github: { enabled: true } },
    cwd: targetDir,
    exec: github.exec,
    receiptRootDir: receiptRoot,
    stateRootDir: stateRoot,
    manifest: loadedManifest,
    checkAtRegistration: () => observations(),
    checkAtPreCall: () => observations(),
    checkAtPublish: () => observations(true),
    verifySlot: () => undefined,
    createGuard: noopGuard,
    now: () => "2026-07-31T12:00:00.000Z",
    provisionalId: () => crypto.randomUUID(),
  });
  await extension(api);

  const command = api.commands.get("pr-reviewer")!;
  const receipts: PrReviewReceiptV1[] = [];
  const publishResults: Array<Record<string, unknown> | undefined> = [];
  let captureHandle: string | undefined;
  let publishResult: PrReviewPublishResult | undefined;
  let boundaryResults: readonly unknown[] | undefined;
  let directWriteBlock: unknown;
  let prePublishBlock: unknown;
  let postPublishBlock: unknown;
  let prePublishGuardActive: boolean | undefined;
  let runHandle: string | undefined;
  let snapshotHandle: string | undefined;

  for (let run = 0; run < (options.runCount ?? 1); run += 1) {
    await command.handler(`owner/repo#7${dryRun ? " --dry-run" : ""}`);
    const controller = api.messages.at(-1);
    if (!controller) throw new Error("controller message was not queued");
    const target = /^TARGET: (.+)$/m.exec(controller.payload)?.[1];
    const controllerDryRun = /^DRY_RUN: (true|false)$/m.exec(controller.payload)?.[1] === "true";
    if (!target) throw new Error("controller target is unavailable");
    const created = await api.executeTool<PublicSnapshotCreateResult>("pr_review_snapshot", {
      action: "create",
      target,
      dry_run: controllerDryRun,
    });
    runHandle = created.run_handle;
    snapshotHandle = created.snapshot_handle;
    if (options.shutdownAfterCreate) {
      await api.emitShutdown();
      receipts.push(findReceipt(receiptRoot));
      publishResults.push(undefined);
      break;
    }
    if (!created.next_task) throw new Error("snapshot create did not expose next_task");

    boundaryResults = options.probeDirectWrite
      ? await Promise.all([
        "gh api --method POST repos/owner/repo/issues/7/comments --input payload.json",
        "gh pr comment 7 --body leak",
        "gh pr review 7 --comment --body leak",
        "gh pr merge 7",
        "gh api --method DELETE repos/owner/repo/git/refs/heads/topic",
        "gh api graphql -f query='mutation { deleteRef(input: {}) { clientMutationId } }'",
        "gh unknown-command",
        "bash -lc 'gh api --method GET repos/owner/repo/pulls/7'",
        "/opt/homebrew/bin/gh api --method DELETE repos/owner/repo/git/refs/heads/qualified",
        "./gh pr comment 7 --body qualified-leak",
        "gh api --method GET repos/owner/repo/pulls/7",
        "gh pr view 7",
        "/opt/homebrew/bin/gh api --method GET repos/owner/repo/pulls/7",
        "printf harmless",
      ].map((commandText, index) =>
        api.emitCall({
          type: "tool_call",
          toolName: "bash",
          toolCallId: `github-boundary-${run}-${index}`,
          input: { command: commandText },
          cwd: targetDir,
        })
      ))
      : undefined;
    directWriteBlock = boundaryResults?.[0];
    let nextTask = created.next_task;
    captureHandle = undefined;
    for (let index = 1; index <= 3; index += 1) {
      const call: NativeTaskCallEvent = {
        type: "tool_call",
        toolName: "task",
        toolCallId: run === 0 ? `task-${index}` : `task-${run}-${index}`,
        input: structuredClone(nextTask),
        cwd: targetDir,
      };
      const blocked = await api.emitCall(call);
      if (blocked) {
        return {
          api,
          root,
          targetDir,
          receiptRoot,
          stateRoot,
          runHandle,
          snapshotHandle,
          receipt: findReceipt(receiptRoot),
          githubCalls: github.calls,
          posts: github.posts,
          blocked,
          boundaryResults,
          directWriteBlock,
        };
      }
      await api.emitResult(resultEvent(call, decision, agentSource));
      if (agentSource !== "user") {
        return {
          api,
          root,
          targetDir,
          receiptRoot,
          stateRoot,
          runHandle,
          snapshotHandle,
          receipt: findReceipt(receiptRoot),
          githubCalls: github.calls,
          boundaryResults,
          posts: github.posts,
          directWriteBlock,
        };
      }
      const status = await api.executeTool<PublicSnapshotStatusResult>(
        "pr_review_snapshot",
        { action: "status", run_handle: created.run_handle },
      );
      if (status.status === "completed") {
        captureHandle = status.capture_handle;
        break;
      }
      nextTask = status.next_task;
    }
    if (!captureHandle) throw new Error("capture did not complete through public status");
    const lifetimeCommand = {
      type: "tool_call" as const,
      toolName: "bash",
      input: { command: "gh pr merge 7" },
      cwd: targetDir,
    };
    prePublishBlock = options.probeGuardLifetime
      ? await api.emitCall({
        ...lifetimeCommand,
        toolCallId: `guard-lifetime-before-publish-${run}`,
      })
      : undefined;
    prePublishGuardActive = options.probeGuardLifetime
      ? findReceipt(receiptRoot).mutation_guard_active
      : undefined;
    publishResult = undefined;
    try {
      publishResult = await api.executeTool<PrReviewPublishResult>("pr_review_publish", {
        capture_handle: captureHandle,
        dry_run: dryRun,
      });
    } catch {
      // Typed receipt is asserted by the caller for fail-closed branches.
    }
    postPublishBlock = options.probeGuardLifetime
      ? await api.emitCall({
        ...lifetimeCommand,
        toolCallId: `guard-lifetime-after-publish-${run}`,
      })
      : undefined;
    receipts.push(findReceipt(receiptRoot));
    publishResults.push(publishResult ? { ...publishResult } : undefined);
  }

  return {
    api,
    root,
    targetDir,
    receiptRoot,
    stateRoot,
    runHandle,
    snapshotHandle,
    receipt: receipts.at(-1)!,
    receipts,
    githubCalls: github.calls,
    posts: github.posts,
    publishResult,
    publishResults,
    captureHandle,
    boundaryResults,
    directWriteBlock,
    prePublishBlock,
    postPublishBlock,
    prePublishGuardActive,
  };
}

export function targetFiles(targetDir: string): string[] {
  return readdirSync(targetDir).sort();
}
