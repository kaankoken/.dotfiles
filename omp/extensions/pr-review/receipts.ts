import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  PR_REVIEW_PROTOCOL_VERSION,
  PR_REVIEW_ROLE_MANIFEST_VERSION,
  PR_REVIEW_SCHEMA_VERSION,
  type PrReviewFailureCode,
  type PrReviewReceiptStatus,
  type PrReviewReceiptV1,
  type ReceiptTaskEvidence,
  type RoleIntegrityObservation,
} from "./contracts";
import { writeAllSync } from "./private-files";

export interface ReceiptJournalStartOptions {
  rootDir?: string;
  provisionalId: string;
  owner: string;
  repo: string;
  pullNumber: number;
  roleManifestDigest: string;
  now?: () => string;
}

export type PrReviewJournalReceipt = Omit<PrReviewReceiptV1, "run_key"> & {
  run_key?: string;
};

export type ReceiptUpdate = Partial<Pick<
  PrReviewReceiptV1,
  | "base_sha"
  | "head_sha"
  | "snapshot_digest"
  | "diff_digest"
  | "authenticated_actor"
  | "roles"
  | "tasks"
  | "mutation_guard_active"
  | "completed_capture_digest"
  | "adjudication_counts"
  | "event"
  | "payload_digest"
  | "github_review_id"
  | "github_inline_comment_ids"
  | "github_inline_comment_markers"
  | "post_publish_head_sha"
  | "published_on_superseded_head"
>>;

const UPDATE_KEYS: readonly (keyof ReceiptUpdate)[] = [
  "base_sha",
  "head_sha",
  "snapshot_digest",
  "diff_digest",
  "authenticated_actor",
  "roles",
  "tasks",
  "mutation_guard_active",
  "completed_capture_digest",
  "adjudication_counts",
  "event",
  "payload_digest",
  "github_review_id",
  "github_inline_comment_ids",
  "github_inline_comment_markers",
  "post_publish_head_sha",
  "published_on_superseded_head",
];

function assertSafeSegment(value: string, label: string): void {
  if (!value || value === "." || value === ".." || !/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`invalid ${label}`);
  }
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 digest`);
  }
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function fsyncDirectory(path: string): void {
  const directory = openSync(path, "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

function writeAtomic(path: string, receipt: PrReviewJournalReceipt): void {
  const temporary = `${path}.tmp-${randomBytes(12).toString("base64url")}`;
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  let file: number | undefined;
  try {
    file = openSync(temporary, "wx", 0o600);
    writeAllSync(bytes, (buffer, offset, length) =>
      writeSync(file!, buffer, offset, length)
    );
    fsyncSync(file);
    closeSync(file);
    file = undefined;
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
    chmodSync(path, 0o600);
    fsyncDirectory(dirname(path));
  } catch (error) {
    if (file !== undefined) {
      try {
        closeSync(file);
      } catch {
        // Preserve the write failure; the temp path is removed below.
      }
    }
    rmSync(temporary, { force: true });
    throw error;
  }
}

function redactedFailureMessage(message: string): string {
  return message
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]+\b/g, "[REDACTED]")
    .replace(
      /\b(token|secret|password|capture_handle|run_handle|snapshot_handle|(?:call_)?nonce)\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi,
      "[REDACTED]",
    )
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[REDACTED]")
    .slice(0, 500);
}

function applyUpdate(receipt: PrReviewJournalReceipt, update: ReceiptUpdate): PrReviewJournalReceipt {
  const next = { ...receipt };
  const raw = update as Record<string, unknown>;
  const target = next as unknown as Record<string, unknown>;
  for (const key of UPDATE_KEYS) {
    if (raw[key] === undefined) continue;
    if (key.endsWith("_digest")) assertSha256(raw[key], key);
    if (key === "roles") {
      target.roles = (raw.roles as readonly RoleIntegrityObservation[]).map((role) => {
        if (role.preCallSha256 !== undefined) assertSha256(role.preCallSha256, "preCallSha256");
        if (role.prePublishSha256 !== undefined) assertSha256(role.prePublishSha256, "prePublishSha256");
        const safe: RoleIntegrityObservation = {
          agent: role.agent,
          livePath: role.livePath,
          preCallValid: role.preCallValid,
        };
        if (role.checkedRealpath !== undefined) safe.checkedRealpath = role.checkedRealpath;
        if (role.preCallSha256 !== undefined) safe.preCallSha256 = role.preCallSha256;
        if (role.prePublishSha256 !== undefined) safe.prePublishSha256 = role.prePublishSha256;
        if (role.prePublishValid !== undefined) safe.prePublishValid = role.prePublishValid;
        return safe;
      });
    } else if (key === "tasks") {
      target.tasks = (raw.tasks as readonly ReceiptTaskEvidence[]).map((task) => {
        assertSha256(task.nonceDigest, "nonceDigest");
        assertSha256(task.schemaSha256, "schemaSha256");
        assertSha256(task.outputDigest, "outputDigest");
        return {
          stage: task.stage,
          task: task.task,
          agent: task.agent,
          nonceDigest: task.nonceDigest,
          nativeToolCallId: task.nativeToolCallId,
          nativeResultId: task.nativeResultId,
          agentSource: task.agentSource,
          requestedModel: task.requestedModel,
          resolvedModel: task.resolvedModel,
          resolvedModelIsFallback: task.resolvedModelIsFallback,
          schemaSha256: task.schemaSha256,
          structuredOutputSource: task.structuredOutputSource,
          structuredOutputMode: task.structuredOutputMode,
          structuredOutputStatus: task.structuredOutputStatus,
          outputDigest: task.outputDigest,
        };
      });
    } else if (key === "adjudication_counts") {
      const counts = raw.adjudication_counts as NonNullable<PrReviewReceiptV1["adjudication_counts"]>;
      target.adjudication_counts = {
        accept: counts.accept,
        reject: counts.reject,
        request_changes: counts.request_changes,
      };
    } else {
      target[key] = structuredClone(raw[key]);
    }
  }
  return next;
}

export class ReceiptJournal {
  readonly #directory: string;
  readonly #now: () => string;
  #receipt: PrReviewJournalReceipt;
  #path: string;
  #terminal = false;
  #promoted = false;

  private constructor(
    directory: string,
    path: string,
    receipt: PrReviewJournalReceipt,
    now: () => string,
  ) {
    this.#directory = directory;
    this.#path = path;
    this.#receipt = receipt;
    this.#now = now;
  }

  static start(options: ReceiptJournalStartOptions): ReceiptJournal {
    assertSafeSegment(options.provisionalId, "provisional id");
    assertSafeSegment(options.owner, "owner");
    assertSafeSegment(options.repo, "repo");
    assertSha256(options.roleManifestDigest, "roleManifestDigest");
    if (!Number.isSafeInteger(options.pullNumber) || options.pullNumber < 1) {
      throw new Error("invalid pull number");
    }

    const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
    const rootDir = options.rootDir ?? join(stateHome, "omp", "pr-review");
    const directories = [
      rootDir,
      join(rootDir, options.owner),
      join(rootDir, options.owner, options.repo),
      join(rootDir, options.owner, options.repo, String(options.pullNumber)),
    ];
    for (const directory of directories) ensurePrivateDirectory(directory);

    const directory = directories.at(-1)!;
    const path = join(directory, `unresolved-${options.provisionalId}.json`);
    if (existsSync(path)) throw new Error("receipt already exists");
    const now = options.now ?? (() => new Date().toISOString());
    const startedAt = now();
    const receipt: PrReviewJournalReceipt = {
      protocol_version: PR_REVIEW_PROTOCOL_VERSION,
      schema_version: PR_REVIEW_SCHEMA_VERSION,
      role_manifest_version: PR_REVIEW_ROLE_MANIFEST_VERSION,
      status: "prepared",
      owner: options.owner,
      repo: options.repo,
      pull_number: options.pullNumber,
      started_at: startedAt,
      updated_at: startedAt,
      role_manifest_digest: options.roleManifestDigest,
      roles: [],
      tasks: [],
      mutation_guard_active: false,
    };
    writeAtomic(path, receipt);
    return new ReceiptJournal(directory, path, receipt, now);
  }

  get receiptPath(): string {
    return this.#path;
  }

  get currentReceipt(): Readonly<PrReviewJournalReceipt> {
    return Object.freeze(structuredClone(this.#receipt));
  }

  promoteToHead(
    update: ReceiptUpdate & { head_sha: string; repositoryNodeId: string },
  ): string {
    this.#assertOpen();
    if (this.#promoted) throw new Error("receipt already promoted");
    assertSafeSegment(update.head_sha, "head sha");
    const target = join(this.#directory, `${update.head_sha}.json`);
    if (existsSync(target)) throw new Error("receipt already exists for head");
    if (!update.repositoryNodeId || /[\u0000-\u001f\u007f]/.test(update.repositoryNodeId)) {
      throw new Error("invalid repository node id");
    }

    const receipt: PrReviewReceiptV1 = {
      ...this.#nextReceipt("prepared", update),
      run_key: createHash("sha256")
        .update(JSON.stringify([
          PR_REVIEW_PROTOCOL_VERSION,
          update.repositoryNodeId,
          this.#receipt.pull_number,
          update.head_sha,
        ]))
        .digest("hex"),
    };
    writeAtomic(this.#path, receipt);
    renameSync(this.#path, target);
    chmodSync(target, 0o600);
    fsyncDirectory(this.#directory);
    this.#receipt = receipt;
    this.#path = target;
    this.#promoted = true;
    return target;
  }

  prepare(update: ReceiptUpdate = {}): Readonly<PrReviewJournalReceipt> {
    return this.#transition("prepared", update, false);
  }

  fail(
    code: PrReviewFailureCode,
    message: string,
    update: ReceiptUpdate = {},
  ): Readonly<PrReviewJournalReceipt> {
    return this.#terminalFailure("failed", code, message, update);
  }

  dryRun(update: ReceiptUpdate = {}): Readonly<PrReviewJournalReceipt> {
    this.#assertOpen();
    this.#assertPromoted();
    return this.#transition("dry_run", update, true);
  }

  publish(update: ReceiptUpdate = {}): Readonly<PrReviewJournalReceipt> {
    this.#assertOpen();
    this.#assertPromoted();
    return this.#transition("published", update, true);
  }

  indeterminate(
    code: PrReviewFailureCode,
    message: string,
    update: ReceiptUpdate = {},
  ): Readonly<PrReviewJournalReceipt> {
    this.#assertOpen();
    this.#assertPromoted();
    return this.#terminalFailure("indeterminate", code, message, update);
  }

  #terminalFailure(
    status: "failed" | "indeterminate",
    code: PrReviewFailureCode,
    message: string,
    update: ReceiptUpdate,
  ): Readonly<PrReviewJournalReceipt> {
    const receipt = this.#transition(status, update, true, {
      failure_code: code,
      failure_message: redactedFailureMessage(message),
    });
    return receipt;
  }

  #transition(
    status: PrReviewReceiptStatus,
    update: ReceiptUpdate,
    terminal: boolean,
    failure: Pick<PrReviewReceiptV1, "failure_code" | "failure_message"> = {},
  ): Readonly<PrReviewJournalReceipt> {
    this.#assertOpen();
    this.#assertHeadStable(update);
    this.#receipt = { ...this.#nextReceipt(status, update), ...failure };
    writeAtomic(this.#path, this.#receipt);
    this.#terminal = terminal;
    return Object.freeze(structuredClone(this.#receipt));
  }

  #nextReceipt(status: PrReviewReceiptStatus, update: ReceiptUpdate): PrReviewJournalReceipt {
    return {
      ...applyUpdate(this.#receipt, update),
      status,
      updated_at: this.#now(),
    };
  }

  #assertHeadStable(update: ReceiptUpdate): void {
    if (update.head_sha === undefined) return;
    if (!this.#promoted || update.head_sha !== this.#receipt.head_sha) {
      throw new Error("head sha is immutable after promotion");
    }
  }

  #assertPromoted(): void {
    if (!this.#promoted || !this.#receipt.run_key) {
      throw new Error("head promotion required");
    }
  }

  #assertOpen(): void {
    if (this.#terminal) throw new Error("terminal receipt cannot transition");
  }
}
