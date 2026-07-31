import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  rmSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  WF7_TASK_SLOTS,
  type CompletedCapture,
  type ImmutableSnapshot,
  type SealedTaskResult,
  type SnapshotChangedFile,
  type SnapshotNonreviewableEntry,
  type SnapshotReviewableLine,
  type Wf7TaskName,
} from "./contracts";
import { writeAllSync } from "./private-files";

export type PrReviewRunStage =
  | "started"
  | "snapshotted"
  | "initial"
  | "rebuttal"
  | "judge"
  | "captured";

export interface PrReviewRunIdentity {
  runHandle: string;
  runNonce: string;
}

export interface PrReviewRunStatus {
  stage: PrReviewRunStage;
  captureHandle?: string;
}

export interface SnapshotInput {
  owner: string;
  repo: string;
  pullNumber: number;
  repositoryNodeId: string;
  baseSha: string;
  headSha: string;
  diffBytes: Uint8Array;
  changedFiles: readonly SnapshotChangedFile[];
  lineMap: readonly SnapshotReviewableLine[];
  nonreviewableEntries: readonly SnapshotNonreviewableEntry[];
}

export interface PrReviewStateStoreOptions {
  rootDir?: string;
  maxReadBytes?: number;
  removeRunDirectory?: (directory: string) => void;
}

interface SnapshotRecord {
  snapshotHandle: string;
  snapshotNonce: string;
  diffDigest: string;
  diffBytes: Uint8Array;
  metadata: Omit<SnapshotInput, "diffBytes" | "changedFiles" | "lineMap" | "nonreviewableEntries">;
  changedFiles: readonly SnapshotChangedFile[];
  lineMap: readonly SnapshotReviewableLine[];
  nonreviewableEntries: readonly SnapshotNonreviewableEntry[];
}

interface RunRecord extends PrReviewRunIdentity {
  stage: PrReviewRunStage;
  directory: string;
  snapshot?: SnapshotRecord;
  callNonces: Map<Wf7TaskName, string>;
  captureHandle?: string;
}

interface CaptureRecord {
  captureHandle: string;
  runHandle: string;
  results: readonly SealedTaskResult[];
  completedAt: string;
}

const NEXT_STAGE: Partial<Record<PrReviewRunStage, PrReviewRunStage>> = {
  started: "snapshotted",
  snapshotted: "initial",
  initial: "rebuttal",
  rebuttal: "judge",
  judge: "captured",
};

function opaqueHandle(): string {
  return randomBytes(32).toString("base64url");
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

function writePrivateFile(path: string, bytes: Uint8Array): void {
  const file = openSync(path, "wx", 0o600);
  let closed = false;
  try {
    writeAllSync(bytes, (buffer, offset, length) =>
      writeSync(file, buffer, offset, length)
    );
    fsyncSync(file);
    closeSync(file);
    closed = true;
    chmodSync(path, 0o600);
  } catch (error) {
    if (!closed) {
      try {
        closeSync(file);
      } catch {
        // Preserve the write failure while still removing partial bytes.
      }
    }
    rmSync(path, { force: true });
    throw error;
  }
}

export class PrReviewStateStore {
  readonly rootDir: string;
  readonly maxReadBytes: number;
  readonly #runs = new Map<string, RunRecord>();
  readonly #snapshotRuns = new Map<string, string>();
  readonly #captures = new Map<string, CaptureRecord>();
  readonly #pendingRunDirectories = new Map<string, string>();
  readonly #removeRunDirectory: (directory: string) => void;

  constructor(options: PrReviewStateStoreOptions = {}) {
    const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
    this.rootDir = options.rootDir ?? join(stateHome, "omp", "pr-review", "runs");
    this.maxReadBytes = options.maxReadBytes ?? 64 * 1024;
    if (!Number.isSafeInteger(this.maxReadBytes) || this.maxReadBytes < 1) {
      throw new Error("maxReadBytes must be a positive integer");
    }
    this.#removeRunDirectory = options.removeRunDirectory
      ?? ((directory) => rmSync(directory, { recursive: true, force: true }));
    mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    chmodSync(this.rootDir, 0o700);
  }

  startRun(): Readonly<PrReviewRunIdentity> {
    const runHandle = opaqueHandle();
    const runNonce = opaqueHandle();
    const directory = join(this.rootDir, runHandle);
    mkdirSync(directory, { mode: 0o700 });
    chmodSync(directory, 0o700);
    this.#runs.set(runHandle, {
      runHandle,
      runNonce,
      stage: "started",
      directory,
      callNonces: new Map(),
    });
    return Object.freeze({ runHandle, runNonce });
  }

  storeSnapshot(runHandle: string, input: SnapshotInput): Readonly<ImmutableSnapshot> {
    const run = this.#requireRun(runHandle);
    if (run.stage !== "started") throw new Error(`snapshot cannot be stored during ${run.stage}`);

    const snapshotHandle = opaqueHandle();
    const snapshotNonce = opaqueHandle();
    const diffBytes = new Uint8Array(input.diffBytes);
    const record: SnapshotRecord = {
      snapshotHandle,
      snapshotNonce,
      diffDigest: createHash("sha256").update(diffBytes).digest("hex"),
      diffBytes,
      metadata: copyAndFreeze({
        owner: input.owner,
        repo: input.repo,
        pullNumber: input.pullNumber,
        repositoryNodeId: input.repositoryNodeId,
        baseSha: input.baseSha,
        headSha: input.headSha,
      }),
      changedFiles: copyAndFreeze([...input.changedFiles]),
      lineMap: copyAndFreeze([...input.lineMap]),
      nonreviewableEntries: copyAndFreeze([...input.nonreviewableEntries]),
    };
    writePrivateFile(join(run.directory, `${snapshotHandle}.diff`), diffBytes);
    run.snapshot = record;
    run.stage = "snapshotted";
    this.#snapshotRuns.set(snapshotHandle, runHandle);
    return this.#materializeSnapshot(run, record);
  }

  lookupSnapshot(snapshotHandle: string): Readonly<ImmutableSnapshot> {
    const runHandle = this.#snapshotRuns.get(snapshotHandle);
    if (!runHandle) throw new Error("unknown snapshot handle");
    const run = this.#requireRun(runHandle);
    if (!run.snapshot || run.snapshot.snapshotHandle !== snapshotHandle) {
      throw new Error("unknown snapshot handle");
    }
    return this.#materializeSnapshot(run, run.snapshot);
  }

  readSnapshot(snapshotHandle: string, offset: number, length: number): Uint8Array {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1) {
      throw new Error("snapshot read bounds must be positive integers");
    }
    if (length > this.maxReadBytes) throw new Error("snapshot read exceeds bounded limit");
    const runHandle = this.#snapshotRuns.get(snapshotHandle);
    if (!runHandle) throw new Error("unknown snapshot handle");
    const snapshot = this.#requireRun(runHandle).snapshot;
    if (!snapshot || snapshot.snapshotHandle !== snapshotHandle) {
      throw new Error("unknown snapshot handle");
    }
    if (offset > snapshot.diffBytes.byteLength) throw new Error("snapshot read offset is out of range");
    return snapshot.diffBytes.slice(offset, Math.min(offset + length, snapshot.diffBytes.byteLength));
  }

  getRunStatus(runHandle: string): Readonly<PrReviewRunStatus> {
    const run = this.#requireRun(runHandle);
    const status: PrReviewRunStatus = { stage: run.stage };
    if (run.stage === "captured" && run.captureHandle) status.captureHandle = run.captureHandle;
    return Object.freeze(status);
  }

  transitionRun(runHandle: string, next: PrReviewRunStage): void {
    const run = this.#requireRun(runHandle);
    if (NEXT_STAGE[run.stage] !== next || next === "snapshotted" || next === "captured") {
      throw new Error(`illegal stage transition ${run.stage} to ${next}`);
    }
    run.stage = next;
  }

  mintCallNonce(runHandle: string, slot: Wf7TaskName): string {
    const run = this.#requireRun(runHandle);
    if (run.stage === "started" || run.stage === "captured") {
      throw new Error(`cannot mint call nonce during ${run.stage}`);
    }
    if (!WF7_TASK_SLOTS.some((candidate) => candidate.name === slot)) {
      throw new Error(`unknown task slot ${slot}`);
    }
    if (run.callNonces.has(slot)) throw new Error(`call nonce already minted for ${slot}`);
    const nonce = opaqueHandle();
    run.callNonces.set(slot, nonce);
    return nonce;
  }

  completeCapture(
    runHandle: string,
    results: readonly SealedTaskResult[],
    completedAt = new Date().toISOString(),
  ): Readonly<CompletedCapture> {
    const run = this.#requireRun(runHandle);
    if (run.stage !== "judge") throw new Error(`illegal stage transition ${run.stage} to captured`);
    if (!run.snapshot) throw new Error("capture has no snapshot");
    if (results.length !== WF7_TASK_SLOTS.length) throw new Error("capture requires exactly five results");

    const capturedCallNonces = new Set<string>();
    for (let index = 0; index < WF7_TASK_SLOTS.length; index += 1) {
      const slot = WF7_TASK_SLOTS[index]!;
      const result = results[index]!;
      const expectedCallNonce = run.callNonces.get(slot.name);
      if (!expectedCallNonce) throw new Error(`unknown call nonce at ${slot.name}`);
      if (result.callNonce !== expectedCallNonce) {
        throw new Error(`call nonce slot mismatch at ${slot.name}`);
      }
      if (
        result.slot !== slot.name
        || result.name !== slot.name
        || result.stage !== slot.stage
        || result.agent !== slot.agent
        || result.runNonce !== run.runNonce
        || result.snapshotNonce !== run.snapshot.snapshotNonce
        || result.snapshotHandle !== run.snapshot.snapshotHandle
        || result.headSha !== run.snapshot.metadata.headSha
        || result.diffDigest !== run.snapshot.diffDigest
      ) {
        throw new Error(`capture binding mismatch at ${slot.name}`);
      }
    }

    const captureHandle = opaqueHandle();
    const capture: CaptureRecord = {
      captureHandle,
      runHandle,
      results: copyAndFreeze([...results]),
      completedAt,
    };
    this.#captures.set(captureHandle, capture);
    run.captureHandle = captureHandle;
    run.stage = "captured";
    return this.#materializeCapture(capture);
  }

  lookupCapture(captureHandle: string): Readonly<CompletedCapture> {
    const capture = this.#captures.get(captureHandle);
    if (!capture) throw new Error("unknown capture handle");
    return this.#materializeCapture(capture);
  }

  cleanupRun(runHandle: string): void {
    const run = this.#runs.get(runHandle);
    if (run) {
      if (run.snapshot) this.#snapshotRuns.delete(run.snapshot.snapshotHandle);
      if (run.captureHandle) this.#captures.delete(run.captureHandle);
      this.#runs.delete(runHandle);
      this.#pendingRunDirectories.set(runHandle, run.directory);
    }
    this.#retryRunDirectory(runHandle);
  }

  retryCleanup(): void {
    for (const runHandle of this.#pendingRunDirectories.keys()) {
      this.#retryRunDirectory(runHandle);
    }
  }

  #retryRunDirectory(runHandle: string): void {
    const directory = this.#pendingRunDirectories.get(runHandle);
    if (!directory) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        this.#removeRunDirectory(directory);
        this.#pendingRunDirectories.delete(runHandle);
        return;
      } catch {
        // Retain ownership for a later cleanup or shutdown retry.
      }
    }
  }

  #requireRun(runHandle: string): RunRecord {
    const run = this.#runs.get(runHandle);
    if (!run) throw new Error("unknown run handle");
    return run;
  }

  #materializeSnapshot(run: RunRecord, snapshot: SnapshotRecord): Readonly<ImmutableSnapshot> {
    return Object.freeze({
      runHandle: run.runHandle,
      snapshotHandle: snapshot.snapshotHandle,
      runNonce: run.runNonce,
      snapshotNonce: snapshot.snapshotNonce,
      ...snapshot.metadata,
      diffDigest: snapshot.diffDigest,
      diffBytes: new Uint8Array(snapshot.diffBytes),
      changedFiles: snapshot.changedFiles,
      lineMap: snapshot.lineMap,
      nonreviewableEntries: snapshot.nonreviewableEntries,
    });
  }

  #materializeCapture(capture: CaptureRecord): Readonly<CompletedCapture> {
    const run = this.#requireRun(capture.runHandle);
    if (!run.snapshot) throw new Error("capture has no snapshot");
    return Object.freeze({
      captureHandle: capture.captureHandle,
      snapshot: this.#materializeSnapshot(run, run.snapshot),
      results: capture.results as CompletedCapture["results"],
      completedAt: capture.completedAt,
    });
  }
}
