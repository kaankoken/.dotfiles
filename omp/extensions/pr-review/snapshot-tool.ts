import { createHash, randomBytes } from "node:crypto";
import type {
  PrReviewFailureCode,
  RoleIntegrityObservation,
  SnapshotChangedFile,
  SnapshotNonreviewableEntry,
  SnapshotReviewableLine,
  PrReviewTaskName,
} from "./contracts";
import {
  PR_REVIEW_SNAPSHOT_PARAMETERS_SCHEMA,
  PR_REVIEW_TASK_SLOTS,
} from "./contracts";
import {
  GitHubReadClient,
  GitHubReadError,
  defaultPrReviewExec,
  DEFAULT_PR_REVIEW_EXEC_TIMEOUT_MS,
  type GitHubChangedFile,
  type PrReviewExec,
} from "./github";
import {
  mapCanonicalDiffBlocks,
  parseUnifiedDiff,
  type ParsedUnifiedDiff,
} from "./line-map";
import { ReceiptJournal } from "./receipts";
import {
  checkAllRoleFiles,
  loadRoleManifest,
  RoleIntegrityError,
  type LoadedRoleManifest,
} from "./role-integrity";
import { PrReviewStateStore } from "./state";
import {
  parsePrReviewTarget,
  parseRemoteRepository,
  resolvePrReviewTarget,
  type RepositoryIdentity,
} from "./target";

export interface SnapshotCreateInput {
  action: "create";
  target: string;
  dry_run: boolean;
}

export interface SnapshotReadInput {
  action: "read";
  snapshot_handle: string;
  offset: number;
  length: number;
}

export interface SnapshotStatusInput {
  action: "status";
  run_handle: string;
}

export interface SnapshotCreateResult {
  status: "created";
  run_handle: string;
  snapshot_handle: string;
  run_nonce: string;
  snapshot_nonce: string;
  owner: string;
  repo: string;
  pull_number: number;
  repository_node_id: string;
  repository_permissions: Readonly<Record<string, boolean>>;
  actor: string;
  state: "open";
  draft: boolean;
  fork: boolean;
  head_repository: string;
  base_sha: string;
  head_sha: string;
  diff_digest: string;
  diff_size: number;
  changed_file_count: number;
  line_map: readonly SnapshotReviewableLine[];
  nonreviewable_entries: readonly SnapshotNonreviewableEntry[];
  call_nonces: readonly { task: PrReviewTaskName; call_nonce: string }[];
}

export interface SnapshotReadResult {
  status: "read";
  content: string;
  content_base64: string;
  offset: number;
  bytes_read: number;
  next_offset: number;
  eof: boolean;
}

export type SnapshotStatusResult =
  | { status: "pending" }
  | { status: "completed"; capture_handle: string };

export interface PrReviewSnapshotTool {
  readonly name: "pr_review_snapshot";
  readonly description: string;
  readonly parameters: typeof PR_REVIEW_SNAPSHOT_PARAMETERS_SCHEMA;
  execute(
    input: SnapshotCreateInput,
    invocationId?: string,
    signal?: AbortSignal,
  ): Promise<SnapshotCreateResult>;
  execute(
    input: SnapshotReadInput,
    invocationId?: string,
    signal?: AbortSignal,
  ): Promise<SnapshotReadResult>;
  execute(
    input: SnapshotStatusInput,
    invocationId?: string,
    signal?: AbortSignal,
  ): Promise<SnapshotStatusResult>;
  cleanup(runHandle: string): void;
  cancelCreate(
    invocationId: string,
    code: PrReviewFailureCode,
    message: string,
  ): Promise<void> | undefined;
  finishCreate(invocationId: string): void;
  retryCleanup(): void;
}

export interface PrReviewSnapshotToolOptions {
  exec?: PrReviewExec;
  cwd?: string;
  state?: PrReviewStateStore;
  receiptRootDir?: string;
  maxDiffBytes?: number;
  loadManifest?: () => LoadedRoleManifest;
  checkRoles?: (
    manifest: LoadedRoleManifest,
    journal: ReceiptJournal,
    invocationId?: string,
  ) => readonly RoleIntegrityObservation[];
  provisionalId?: () => string;
  now?: () => string;
}

interface SnapshotContext {
  journal: ReceiptJournal;
  diffSize: number;
  runHandle: string;
  snapshotHandle: string;
}

interface PendingSnapshotCreate {
  journal?: ReceiptJournal;
  runHandle?: string;
  cancelled: boolean;
  cancellationCode?: PrReviewFailureCode;
  cancellationMessage?: string;
  controller: AbortController;
  settled: Promise<void>;
  resolveSettled: () => void;
}

export class PrReviewSnapshotError extends Error {
  readonly code: PrReviewFailureCode;

  constructor(code: PrReviewFailureCode, message: string) {
    super(message);
    this.name = "PrReviewSnapshotError";
    this.code = code;
  }
}

const MAX_TOOL_READ_BYTES = 65_536;
const DEFAULT_MAX_DIFF_BYTES = 8 * 1024 * 1024;

function exactObject(value: unknown, action: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PrReviewSnapshotError("invalid_arguments", `${action} input must be an object`);
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== keys.length || Object.keys(raw).some((key) => !keys.includes(key))) {
    throw new PrReviewSnapshotError("invalid_arguments", `${action} input has unknown or missing fields`);
  }
  return raw;
}

function safeHandle(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 32 || value.length > 256) {
    throw new PrReviewSnapshotError("invalid_arguments", `${label} is invalid`);
  }
  return value;
}

function normalizedFailure(error: unknown, fallback: PrReviewFailureCode): PrReviewSnapshotError {
  if (error instanceof PrReviewSnapshotError) return error;
  if (error instanceof GitHubReadError || error instanceof RoleIntegrityError) {
    return new PrReviewSnapshotError(error.code, error.message);
  }
  return new PrReviewSnapshotError(fallback, error instanceof Error ? error.message : "PR review snapshot failed");
}


function changedFileMetadata(diff: string, files: readonly GitHubChangedFile[]): SnapshotChangedFile[] {
  const provisional = files.map((file) => ({
    path: file.filename,
    status: file.status,
    patchComplete: true,
    reviewable: true,
  }));
  const blocks = mapCanonicalDiffBlocks(diff, provisional);
  return files.map((file) => {
    const lines = blocks.get(file.filename) ?? [];
    if (lines.some((line) =>
      /^Binary files .+ and .+ differ$/.test(line) || line === "GIT binary patch"
    )) {
      return Object.freeze({ path: file.filename, status: `${file.status} binary`, patchComplete: true, reviewable: false });
    }
    if (lines.some((line) =>
      /^Subproject commit [0-9a-f]+(?:-dirty)?$/i.test(line)
      || /^(?:old|new|deleted file|new file) mode 160000$/.test(line)
      || /^index [0-9a-f]+\.\.[0-9a-f]+ 160000$/i.test(line)
    )) {
      return Object.freeze({ path: file.filename, status: `${file.status} submodule`, patchComplete: true, reviewable: false });
    }
    if (file.patch !== undefined) {
      return Object.freeze({ path: file.filename, status: file.status, patchComplete: true, reviewable: true });
    }
    return Object.freeze({ path: file.filename, status: file.status, patchComplete: false, reviewable: true });
  });
}

function lineIdentity(line: { path: string; line: number; side: "LEFT" | "RIGHT"; hunk: number }): string {
  return `${line.path}\0${line.hunk}\0${line.side}\0${line.line}`;
}

function proveApiPatchesComplete(
  files: readonly GitHubChangedFile[],
  metadata: readonly SnapshotChangedFile[],
  canonicalLines: readonly SnapshotReviewableLine[],
): void {
  for (const file of files) {
    if (file.patch === undefined) continue;
    const single = metadata.find((entry) => entry.path === file.filename)!;
    let patchLines: readonly SnapshotReviewableLine[];
    try {
      patchLines = parseUnifiedDiff([
        `diff --git a/${file.filename} b/${file.filename}`,
        `--- a/${file.filename}`,
        `+++ b/${file.filename}`,
        file.patch,
        "",
      ].join("\n"), [single]).lines;
    } catch {
      throw new PrReviewSnapshotError("snapshot_incomplete", `changed-file patch is truncated for ${file.filename}`);
    }
    const expected = canonicalLines.filter((line) => line.path === file.filename).map(lineIdentity);
    const actual = patchLines.map(lineIdentity);
    if (expected.length !== actual.length || expected.some((line, index) => line !== actual[index])) {
      throw new PrReviewSnapshotError("snapshot_incomplete", `changed-file patch is incomplete for ${file.filename}`);
    }
  }
}

class SnapshotTool implements PrReviewSnapshotTool {
  readonly name = "pr_review_snapshot" as const;
  readonly description = "Create and read one immutable, complete GitHub PR snapshot. Read-only.";
  readonly parameters = PR_REVIEW_SNAPSHOT_PARAMETERS_SCHEMA;
  readonly #exec: PrReviewExec;
  readonly #cwd?: string;
  readonly #state: PrReviewStateStore;
  readonly #receiptRootDir?: string;
  readonly #maxDiffBytes: number;
  readonly #loadManifest: () => LoadedRoleManifest;
  readonly #checkRoles?: PrReviewSnapshotToolOptions["checkRoles"];
  readonly #provisionalId: () => string;
  readonly #now?: () => string;
  readonly #byRun = new Map<string, SnapshotContext>();
  readonly #bySnapshot = new Map<string, SnapshotContext>();
  readonly #pendingCreates = new Map<string, PendingSnapshotCreate>();

  constructor(options: PrReviewSnapshotToolOptions) {
    this.#exec = options.exec ?? defaultPrReviewExec;
    this.#cwd = options.cwd;
    this.#state = options.state ?? new PrReviewStateStore();
    this.#receiptRootDir = options.receiptRootDir;
    this.#maxDiffBytes = options.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES;
    this.#loadManifest = options.loadManifest ?? loadRoleManifest;
    this.#checkRoles = options.checkRoles;
    this.#provisionalId = options.provisionalId ?? (() => randomBytes(16).toString("hex"));
    this.#now = options.now;
    if (!Number.isSafeInteger(this.#maxDiffBytes) || this.#maxDiffBytes < 1) {
      throw new Error("maxDiffBytes must be a positive integer");
    }
  }

  execute(
    input: SnapshotCreateInput,
    invocationId?: string,
    signal?: AbortSignal,
  ): Promise<SnapshotCreateResult>;
  execute(
    input: SnapshotReadInput,
    invocationId?: string,
    signal?: AbortSignal,
  ): Promise<SnapshotReadResult>;
  execute(
    input: SnapshotStatusInput,
    invocationId?: string,
    signal?: AbortSignal,
  ): Promise<SnapshotStatusResult>;
  async execute(
    input: SnapshotCreateInput | SnapshotReadInput | SnapshotStatusInput,
    invocationId?: string,
    signal?: AbortSignal,
  ): Promise<SnapshotCreateResult | SnapshotReadResult | SnapshotStatusResult> {
    if (!input || typeof input !== "object") {
      throw new PrReviewSnapshotError("invalid_arguments", "snapshot input must be an object");
    }
    if (input.action === "create") {
      let resolveSettled!: () => void;
      const controller = new AbortController();
      const pending: PendingSnapshotCreate = {
        cancelled: false,
        controller,
        settled: new Promise<void>((resolve) => {
          resolveSettled = resolve;
        }),
        resolveSettled: () => resolveSettled(),
      };
      if (invocationId) {
        if (this.#pendingCreates.has(invocationId)) {
          throw new PrReviewSnapshotError(
            "invalid_arguments",
            "duplicate snapshot invocation identifier",
          );
        }
        this.#pendingCreates.set(invocationId, pending);
      }
      const combinedSignal = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal;
      try {
        return await this.#create(input, pending, invocationId, combinedSignal);
      } catch (error) {
        if (invocationId) this.#pendingCreates.delete(invocationId);
        throw error;
      } finally {
        pending.resolveSettled();
      }
    }
    if (input.action === "read") return this.#read(input, signal);
    if (input.action === "status") return this.#status(input, signal);
    throw new PrReviewSnapshotError("invalid_arguments", "snapshot action must be create, read, or status");
  }

  cancelCreate(
    invocationId: string,
    code: PrReviewFailureCode,
    message: string,
  ): Promise<void> | undefined {
    const pending = this.#pendingCreates.get(invocationId);
    if (!pending) return undefined;
    pending.cancelled = true;
    pending.cancellationCode = code;
    pending.cancellationMessage = message;
    pending.controller.abort();
    this.#finalizePendingCancellation(pending);
    return pending.settled;
  }

  finishCreate(invocationId: string): void {
    this.#pendingCreates.delete(invocationId);
  }

  retryCleanup(): void {
    this.#state.retryCleanup();
  }

  #finalizePendingCancellation(pending: PendingSnapshotCreate): void {
    if (pending.journal?.currentReceipt.status === "prepared") {
      try {
        pending.journal.fail(
          pending.cancellationCode ?? "internal_error",
          pending.cancellationMessage ?? "snapshot create was cancelled",
          { mutation_guard_active: false },
        );
      } catch {
        // State revocation must continue after durable receipt storage failure.
      }
    }
    if (pending.runHandle) {
      try {
        this.cleanup(pending.runHandle);
      } catch {
        // Preserve the terminal cancellation receipt.
      }
    }
  }

  #assertCreateActive(pending: PendingSnapshotCreate): void {
    if (!pending.cancelled) return;
    this.#finalizePendingCancellation(pending);
    throw new PrReviewSnapshotError(
      pending.cancellationCode ?? "internal_error",
      pending.cancellationMessage ?? "snapshot create was cancelled",
    );
  }

  async #create(
    input: SnapshotCreateInput,
    pending: PendingSnapshotCreate,
    invocationId?: string,
    signal?: AbortSignal,
  ): Promise<SnapshotCreateResult> {
    const raw = exactObject(input, "create", ["action", "target", "dry_run"]);
    if (typeof raw.target !== "string" || raw.target.length < 1 || raw.target.length > 512 || typeof raw.dry_run !== "boolean") {
      throw new PrReviewSnapshotError("invalid_arguments", "create input is invalid");
    }

    let parsed;
    try {
      parsed = parsePrReviewTarget(raw.target);
    } catch (error) {
      throw normalizedFailure(error, "target_resolution_failed");
    }
    let remote: RepositoryIdentity | undefined;
    if (parsed.kind === "bare") {
      try {
        const remoteResult = await this.#exec(
          ["git", "remote", "get-url", "origin"],
          {
            cwd: this.#cwd,
            signal,
            timeoutMs: DEFAULT_PR_REVIEW_EXEC_TIMEOUT_MS,
          },
        );
        if (signal?.aborted) {
          throw new PrReviewSnapshotError("task_cancelled", "snapshot creation was cancelled");
        }
        if (remoteResult.exitCode !== 0) throw new Error("origin remote is unavailable");
        const remoteText = typeof remoteResult.stdout === "string"
          ? remoteResult.stdout
          : new TextDecoder("utf-8", { fatal: true }).decode(remoteResult.stdout);
        remote = parseRemoteRepository(remoteText);
      } catch (error) {
        const journal = ReceiptJournal.start({
          rootDir: this.#receiptRootDir,
          provisionalId: this.#provisionalId(),
          owner: "unresolved",
          repo: "unresolved",
          pullNumber: parsed.pullNumber,
          roleManifestDigest: "0".repeat(64),
          now: this.#now,
        });
        const failure = signal?.aborted
          ? new PrReviewSnapshotError("task_cancelled", "snapshot creation was cancelled")
          : normalizedFailure(error, "target_resolution_failed");
        journal.fail(failure.code, failure.message);
        throw failure;
      }
    }

    const provisionalTarget = parsed.kind === "explicit" ? parsed : {
      owner: remote!.owner,
      repo: remote!.repo,
      pullNumber: parsed.pullNumber,
    };
    let manifest: LoadedRoleManifest;
    try {
      manifest = this.#loadManifest();
    } catch (error) {
      const journal = ReceiptJournal.start({
        rootDir: this.#receiptRootDir,
        provisionalId: this.#provisionalId(),
        owner: provisionalTarget.owner,
        repo: provisionalTarget.repo,
        pullNumber: provisionalTarget.pullNumber,
        roleManifestDigest: "0".repeat(64),
        now: this.#now,
      });
      const failure = normalizedFailure(error, "role_integrity_drift");
      journal.fail(failure.code, failure.message);
      throw failure;
    }
    const journal = ReceiptJournal.start({
      rootDir: this.#receiptRootDir,
      provisionalId: this.#provisionalId(),
      owner: provisionalTarget.owner,
      repo: provisionalTarget.repo,
      pullNumber: provisionalTarget.pullNumber,
      roleManifestDigest: manifest.digest,
      now: this.#now,
    });
    if (pending) {
      pending.journal = journal;
      this.#assertCreateActive(pending);
    }
    let runHandle: string | undefined;
    let roleFailureAlreadyReceipted = false;
    try {
      let roles: readonly RoleIntegrityObservation[];
      if (this.#checkRoles) {
        roles = this.#checkRoles(manifest, journal, invocationId);
        journal.prepare({ roles });
      } else {
        try {
          roles = checkAllRoleFiles(manifest, { boundary: "pre-call", journal });
        } catch (error) {
          roleFailureAlreadyReceipted = error instanceof RoleIntegrityError;
          throw error;
        }
      }

      const stateRun = this.#state.startRun();
      runHandle = stateRun.runHandle;
      if (pending) pending.runHandle = stateRun.runHandle;
      this.#assertCreateActive(pending);
      const github = new GitHubReadClient({
        exec: this.#exec,
        cwd: this.#cwd,
        maxDiffBytes: this.#maxDiffBytes,
        signal,
        timeoutMs: DEFAULT_PR_REVIEW_EXEC_TIMEOUT_MS,
      });
      const actor = await github.readActor();
      this.#assertCreateActive(pending);
      journal.prepare({ authenticated_actor: actor.login, roles });
      const repository = await github.readRepository(provisionalTarget.owner, provisionalTarget.repo);
      this.#assertCreateActive(pending);
      let target;
      try {
        target = resolvePrReviewTarget(parsed, remote, {
          owner: repository.owner,
          repo: repository.repo,
          nodeId: repository.nodeId,
        });
      } catch (error) {
        throw normalizedFailure(error, "target_resolution_failed");
      }
      if (
        target.owner.toLowerCase() !== repository.owner.toLowerCase()
        || target.repo.toLowerCase() !== repository.repo.toLowerCase()
      ) {
        throw new PrReviewSnapshotError("target_resolution_failed", "GitHub repository identity does not match target");
      }

      const pull = await github.readPull(target.owner, target.repo, target.pullNumber);
      this.#assertCreateActive(pending);
      journal.promoteToHead({
        head_sha: pull.headSha,
        repositoryNodeId: repository.nodeId,
        base_sha: pull.baseSha,
        authenticated_actor: actor.login,
        roles,
      });
      if (pull.state !== "open" || pull.merged) {
        throw new PrReviewSnapshotError("pr_not_open", "pull request is not open");
      }

      const files = await github.readChangedFiles(
        target.owner,
        target.repo,
        target.pullNumber,
        pull.changedFileCount,
      );
      this.#assertCreateActive(pending);
      const diffBytes = await github.readDiff(target.owner, target.repo, target.pullNumber);
      this.#assertCreateActive(pending);
      if (diffBytes.byteLength > this.#maxDiffBytes) {
        throw new PrReviewSnapshotError("diff_too_large", "pull request diff exceeds the supported snapshot size");
      }

      let diff: string;
      let metadata: SnapshotChangedFile[];
      let parsedDiff: ParsedUnifiedDiff;
      try {
        diff = new TextDecoder("utf-8", { fatal: true }).decode(diffBytes);
        metadata = changedFileMetadata(diff, files);
        parsedDiff = parseUnifiedDiff(diff, metadata);
        proveApiPatchesComplete(files, metadata, parsedDiff.lines);
      } catch (error) {
        throw normalizedFailure(error, "snapshot_incomplete");
      }

      const current = await github.readPull(target.owner, target.repo, target.pullNumber);
      this.#assertCreateActive(pending);
      if (current.state !== "open" || current.merged) {
        throw new PrReviewSnapshotError("pr_not_open", "pull request stopped being open during snapshot");
      }
      if (current.headSha !== pull.headSha) {
        throw new PrReviewSnapshotError("stale_head", "pull request head changed during snapshot");
      }

      const snapshot = this.#state.storeSnapshot(stateRun.runHandle, {
        owner: target.owner,
        repo: target.repo,
        pullNumber: target.pullNumber,
        repositoryNodeId: repository.nodeId,
        baseSha: pull.baseSha,
        headSha: pull.headSha,
        diffBytes,
        changedFiles: metadata,
        lineMap: parsedDiff.lines,
        nonreviewableEntries: parsedDiff.nonreviewableEntries,
      });
      const callNonces = PR_REVIEW_TASK_SLOTS.map((slot) => Object.freeze({
        task: slot.name,
        call_nonce: this.#state.mintCallNonce(stateRun.runHandle, slot.name),
      }));
      const snapshotDigest = createHash("sha256").update(JSON.stringify([
        repository.nodeId,
        target.pullNumber,
        pull.baseSha,
        pull.headSha,
        snapshot.diffDigest,
      ])).digest("hex");
      journal.prepare({
        base_sha: pull.baseSha,
        head_sha: pull.headSha,
        snapshot_digest: snapshotDigest,
        diff_digest: snapshot.diffDigest,
        authenticated_actor: actor.login,
        roles,
      });
      const context = Object.freeze({
        journal,
        diffSize: diffBytes.byteLength,
        runHandle: stateRun.runHandle,
        snapshotHandle: snapshot.snapshotHandle,
      });
      this.#byRun.set(stateRun.runHandle, context);
      this.#bySnapshot.set(snapshot.snapshotHandle, context);
      return Object.freeze({
        status: "created",
        run_handle: stateRun.runHandle,
        snapshot_handle: snapshot.snapshotHandle,
        run_nonce: stateRun.runNonce,
        snapshot_nonce: snapshot.snapshotNonce,
        owner: target.owner,
        repo: target.repo,
        pull_number: target.pullNumber,
        repository_node_id: repository.nodeId,
        repository_permissions: repository.permissions,
        actor: actor.login,
        state: "open",
        draft: pull.draft,
        fork: pull.fork,
        head_repository: pull.headRepository,
        base_sha: pull.baseSha,
        head_sha: pull.headSha,
        diff_digest: snapshot.diffDigest,
        diff_size: diffBytes.byteLength,
        changed_file_count: metadata.length,
        line_map: parsedDiff.lines,
        nonreviewable_entries: parsedDiff.nonreviewableEntries,
        call_nonces: Object.freeze(callNonces),
      });
    } catch (error) {
      const failure = pending.cancelled
        ? new PrReviewSnapshotError(
          pending.cancellationCode ?? "internal_error",
          pending.cancellationMessage ?? "snapshot create was cancelled",
        )
        : normalizedFailure(error, "internal_error");
      if (
        !roleFailureAlreadyReceipted
        && journal.currentReceipt.status === "prepared"
      ) journal.fail(failure.code, failure.message);
      if (runHandle) {
        try {
          this.#state.cleanupRun(runHandle);
        } catch {
          // Preserve the typed, durable snapshot failure.
        }
      }
      throw failure;
    }
  }

  cleanup(runHandle: string): void {
    const context = this.#byRun.get(runHandle);
    if (context) {
      this.#byRun.delete(context.runHandle);
      this.#bySnapshot.delete(context.snapshotHandle);
    }
    this.#state.cleanupRun(runHandle);
  }

  #discard(context: SnapshotContext): void {
    this.cleanup(context.runHandle);
  }

  async #read(
    input: SnapshotReadInput,
    signal?: AbortSignal,
  ): Promise<SnapshotReadResult> {
    const raw = exactObject(input, "read", ["action", "snapshot_handle", "offset", "length"]);
    const snapshotHandle = safeHandle(raw.snapshot_handle, "snapshot handle");
    if (
      !Number.isSafeInteger(raw.offset)
      || Number(raw.offset) < 0
      || !Number.isSafeInteger(raw.length)
      || Number(raw.length) < 1
      || Number(raw.length) > MAX_TOOL_READ_BYTES
    ) {
      throw new PrReviewSnapshotError("invalid_arguments", "snapshot read bounds are invalid");
    }
    const context = this.#bySnapshot.get(snapshotHandle);
    try {
      if (signal?.aborted) {
        throw new PrReviewSnapshotError("task_cancelled", "snapshot read was cancelled");
      }
      const offset = Number(raw.offset);
      const requestedEnd = Math.min(offset + Number(raw.length), context?.diffSize ?? Number.MAX_SAFE_INTEGER);
      if (context && offset < context.diffSize) {
        const first = this.#state.readSnapshot(snapshotHandle, offset, 1)[0]!;
        if ((first & 0xc0) === 0x80) {
          throw new Error("snapshot read offset is not on a UTF-8 boundary");
        }
      }
      let end = requestedEnd;
      if (context) {
        while (end > offset && end < context.diffSize) {
          const next = this.#state.readSnapshot(snapshotHandle, end, 1)[0]!;
          if ((next & 0xc0) !== 0x80) break;
          end -= 1;
        }
        if (end === offset && offset < context.diffSize) {
          throw new Error("snapshot read length cannot include one complete UTF-8 character");
        }
      }
      const bytes = end === offset
        ? new Uint8Array()
        : this.#state.readSnapshot(snapshotHandle, offset, end - offset);
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return Object.freeze({
        status: "read",
        content,
        content_base64: Buffer.from(bytes).toString("base64"),
        offset,
        bytes_read: bytes.byteLength,
        next_offset: end,
        eof: end === context?.diffSize,
      });
    } catch (error) {
      const failure = normalizedFailure(error, "snapshot_incomplete");
      if (context) {
        try {
          context.journal.fail(failure.code, failure.message);
        } catch {
          // Preserve the typed read failure when receipt storage is unavailable.
        } finally {
          this.#discard(context);
        }
      }
      throw failure;
    }
  }

  async #status(
    input: SnapshotStatusInput,
    signal?: AbortSignal,
  ): Promise<SnapshotStatusResult> {
    const raw = exactObject(input, "status", ["action", "run_handle"]);
    const runHandle = safeHandle(raw.run_handle, "run handle");
    try {
      if (signal?.aborted) {
        throw new PrReviewSnapshotError("task_cancelled", "snapshot status was cancelled");
      }
      const status = this.#state.getRunStatus(runHandle);
      if (status.stage === "captured" && status.captureHandle) {
        return Object.freeze({ status: "completed", capture_handle: status.captureHandle });
      }
      return Object.freeze({ status: "pending" });
    } catch (error) {
      const failure = normalizedFailure(error, "invalid_arguments");
      const context = this.#byRun.get(runHandle);
      if (context) {
        try {
          context.journal.fail(failure.code, failure.message);
        } catch {
          // Preserve the typed state failure when receipt storage is unavailable.
        } finally {
          this.#discard(context);
        }
      }
      throw failure;
    }
  }
}

export function createPrReviewSnapshotTool(
  options: PrReviewSnapshotToolOptions = {},
): PrReviewSnapshotTool {
  return new SnapshotTool(options);
}
