import { execFile, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrReviewFailureCode } from "./contracts";

export interface PrReviewExecOptions {
  cwd?: string;
  maxBufferBytes?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  terminationGraceMs?: number;
}

export interface PrReviewExecResult {
  exitCode: number;
  stdout: string | Uint8Array;
  stderr: string;
}

export type PrReviewExec = (
  argv: readonly string[],
  options?: PrReviewExecOptions,
) => Promise<PrReviewExecResult>;

export interface GitHubActor {
  login: string;
  id: number;
}

export interface GitHubRepository {
  owner: string;
  repo: string;
  nodeId: string;
  permissions: Readonly<Record<string, boolean>>;
}

export interface GitHubPullRequest {
  state: string;
  draft: boolean;
  merged: boolean;
  changedFileCount: number;
  baseSha: string;
  headSha: string;
  headRepository: string;
  fork: boolean;
  authorLogin?: string;
}

export interface GitHubChangedFile {
  filename: string;
  previousFilename?: string;
  status: string;
  patch?: string;
}

export interface GitHubReadClientOptions {
  exec?: PrReviewExec;
  cwd?: string;
  maxPages?: number;
  maxDiffBytes?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface PrReviewPublishOptions {
  exec?: PrReviewExec;
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface PublishedReview {
  reviewId: number;
  inlineCommentIds: readonly number[];
}

export class GitHubReadError extends Error {
  readonly code: PrReviewFailureCode;

  constructor(code: PrReviewFailureCode, message: string) {
    super(message);
    this.name = "GitHubReadError";
    this.code = code;
  }
}

export class GitHubPublishError extends Error {
  readonly code: PrReviewFailureCode;
  readonly ambiguous: boolean;

  constructor(code: PrReviewFailureCode, message: string, ambiguous = false) {
    super(message);
    this.name = "GitHubPublishError";
    this.code = code;
    this.ambiguous = ambiguous;
  }
}

export const DEFAULT_PR_REVIEW_EXEC_TIMEOUT_MS = 120_000;

export function defaultPrReviewExec(
  argv: readonly string[],
  options: PrReviewExecOptions = {},
): Promise<PrReviewExecResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PR_REVIEW_EXEC_TIMEOUT_MS;
  const terminationGraceMs = options.terminationGraceMs ?? 250;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("timeoutMs must be a positive integer");
  }
  if (!Number.isSafeInteger(terminationGraceMs) || terminationGraceMs < 0) {
    throw new RangeError("terminationGraceMs must be a non-negative integer");
  }
  if (options.signal?.aborted) {
    return Promise.resolve({
      exitCode: 1,
      stdout: new Uint8Array(),
      stderr: "argv execution aborted",
    });
  }

  const { promise, resolve } = Promise.withResolvers<PrReviewExecResult>();
  let completed: PrReviewExecResult | undefined;
  let closed = false;
  let terminationReason: "aborted" | "timed out" | undefined;
  let timeoutTimer: NodeJS.Timeout | undefined;
  let graceTimer: NodeJS.Timeout | undefined;
  let child: ChildProcess | undefined;
  const onAbort = () => terminate("aborted");
  const cleanup = () => {
    clearTimeout(timeoutTimer);
    clearTimeout(graceTimer);
    options.signal?.removeEventListener("abort", onAbort);
  };
  const terminate = (reason?: "aborted" | "timed out") => {
    if (closed || !child) return;
    if (reason && !terminationReason) terminationReason = reason;
    child.kill("SIGTERM");
    graceTimer ??= setTimeout(() => {
      if (!closed) child?.kill("SIGKILL");
    }, terminationGraceMs);
  };
  const finish = (
    error: NodeJS.ErrnoException & { signal?: string } | null,
    stdout: string | Buffer,
    stderr: string | Buffer,
  ) => {
    completed = {
      exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
      stdout: new Uint8Array(stdout ?? []),
      stderr: [
        String(stderr ?? ""),
        String(error?.message ?? ""),
        error?.signal ? `terminated by signal ${error.signal}` : "",
        terminationReason ? `argv execution ${terminationReason}` : "",
      ].filter(Boolean).join("\n"),
    };
    if (error && !closed) terminate();
    if (closed && completed) resolve(completed);
  };

  try {
    child = execFile(argv[0]!, argv.slice(1), {
      cwd: options.cwd,
      env: process.env,
      maxBuffer: options.maxBufferBytes ?? 64 * 1024 * 1024,
      shell: false,
    }, finish);
    child.once("close", () => {
      closed = true;
      cleanup();
      if (completed) resolve(completed);
    });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    timeoutTimer = setTimeout(() => terminate("timed out"), timeoutMs);
  } catch (error) {
    closed = true;
    cleanup();
    finish(error instanceof Error ? error : new Error("argv execution failed"), "", "");
  }
  return promise;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GitHubReadError("github_api_failed", `${label} response is invalid`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new GitHubReadError("github_api_failed", `${label} response is invalid`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new GitHubReadError("github_api_failed", `${label} response is invalid`);
  }
  return Number(value);
}

function splitRepository(value: string): { owner: string; repo: string } {
  const match = /^([^/]+)\/([^/]+)$/.exec(value);
  if (!match) throw new GitHubReadError("github_api_failed", "repository response is invalid");
  return { owner: match[1]!, repo: match[2]! };
}

function stdoutText(value: string | Uint8Array, label: string): string {
  if (typeof value === "string") return value;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new GitHubReadError("github_api_failed", `${label} response is not valid UTF-8`);
  }
}

export async function withPrivateJsonFile<T>(
  value: unknown,
  use: (path: string) => T | Promise<T>,
): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "omp-pr-review-"));
  const path = join(directory, "input.json");
  try {
    writeFileSync(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return await use(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export class GitHubReadClient {
  readonly #exec: PrReviewExec;
  readonly #cwd?: string;
  readonly #maxPages: number;
  readonly #maxDiffBytes: number;
  readonly #signal?: AbortSignal;
  readonly #timeoutMs: number;

  constructor(options: GitHubReadClientOptions = {}) {
    this.#exec = options.exec ?? defaultPrReviewExec;
    this.#cwd = options.cwd;
    this.#maxPages = options.maxPages ?? 100;
    this.#maxDiffBytes = options.maxDiffBytes ?? 8 * 1024 * 1024;
    this.#signal = options.signal;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_PR_REVIEW_EXEC_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.#maxPages) || this.#maxPages < 1) {
      throw new Error("maxPages must be a positive integer");
    }
    if (!Number.isSafeInteger(this.#maxDiffBytes) || this.#maxDiffBytes < 1) {
      throw new Error("maxDiffBytes must be a positive integer");
    }
  }

  async readActor(): Promise<GitHubActor> {
    let raw: unknown;
    try {
      raw = await this.#getJson("user");
    } catch (error) {
      if (error instanceof GitHubReadError) {
        if (error.code === "rate_limited" || error.code === "task_cancelled") throw error;
        throw new GitHubReadError("auth_failed", "GitHub authentication failed");
      }
      throw error;
    }
    const actor = object(raw, "actor");
    return Object.freeze({ login: string(actor.login, "actor"), id: integer(actor.id, "actor") });
  }

  async readRepository(owner: string, repo: string): Promise<GitHubRepository> {
    const raw = object(await this.#getJson(`repos/${owner}/${repo}`), "repository");
    const identity = splitRepository(string(raw.full_name, "repository"));
    const permissionsRaw = raw.permissions === undefined ? {} : object(raw.permissions, "repository permissions");
    const permissions: Record<string, boolean> = {};
    for (const [name, allowed] of Object.entries(permissionsRaw)) {
      if (typeof allowed !== "boolean") {
        throw new GitHubReadError("github_api_failed", "repository permissions response is invalid");
      }
      permissions[name] = allowed;
    }
    return Object.freeze({
      ...identity,
      nodeId: string(raw.node_id, "repository"),
      permissions: Object.freeze(permissions),
    });
  }

  async readPull(owner: string, repo: string, pullNumber: number): Promise<GitHubPullRequest> {
    const raw = object(await this.#getJson(`repos/${owner}/${repo}/pulls/${pullNumber}`), "pull request");
    const base = object(raw.base, "pull request base");
    const head = object(raw.head, "pull request head");
    const headRepo = object(head.repo, "pull request head repository");
    if (typeof raw.draft !== "boolean" || typeof raw.merged !== "boolean") {
      throw new GitHubReadError("github_api_failed", "pull request response is invalid");
    }
    const headRepository = string(headRepo.full_name, "pull request head repository");
    const authorLogin = raw.user === undefined
      ? undefined
      : string(object(raw.user, "pull request author").login, "pull request author");
    return Object.freeze({
      state: string(raw.state, "pull request"),
      draft: raw.draft,
      merged: raw.merged,
      changedFileCount: integer(raw.changed_files, "pull request"),
      baseSha: string(base.sha, "pull request base"),
      headSha: string(head.sha, "pull request head"),
      headRepository,
      ...(authorLogin === undefined ? {} : { authorLogin }),
      fork: headRepository.toLowerCase() !== `${owner}/${repo}`.toLowerCase(),
    });
  }

  async readChangedFiles(
    owner: string,
    repo: string,
    pullNumber: number,
    expectedCount: number,
  ): Promise<readonly GitHubChangedFile[]> {
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
      throw new GitHubReadError("snapshot_incomplete", "changed file count is invalid");
    }
    const files: GitHubChangedFile[] = [];
    for (let page = 1; files.length < expectedCount; page += 1) {
      if (page > this.#maxPages) {
        throw new GitHubReadError("snapshot_incomplete", "changed-file pagination exceeded its bound");
      }
      const raw = await this.#getJson(
        `repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
      );
      if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) {
        throw new GitHubReadError("snapshot_incomplete", "changed-file pagination is incomplete");
      }
      for (const item of raw) {
        const file = object(item, "changed file");
        if (file.patch !== undefined && typeof file.patch !== "string") {
          throw new GitHubReadError("snapshot_incomplete", "changed-file patch is invalid");
        }
        const parsed: GitHubChangedFile = {
          filename: string(file.filename, "changed file"),
          status: string(file.status, "changed file"),
        };
        if (file.previous_filename !== undefined) {
          parsed.previousFilename = string(file.previous_filename, "changed file");
        }
        if (file.patch !== undefined) parsed.patch = file.patch;
        files.push(Object.freeze(parsed));
      }
      if (files.length > expectedCount || (raw.length < 100 && files.length !== expectedCount)) {
        throw new GitHubReadError("snapshot_incomplete", "changed-file count does not match pull metadata");
      }
    }
    if (files.length !== expectedCount) {
      throw new GitHubReadError("snapshot_incomplete", "changed-file pagination is incomplete");
    }
    return Object.freeze(files);
  }

  async readDiff(owner: string, repo: string, pullNumber: number): Promise<Uint8Array> {
    const result = await this.#run([
      "gh", "api", "--method", "GET",
      "-H", "Accept: application/vnd.github.v3.diff",
      `repos/${owner}/${repo}/pulls/${pullNumber}`,
    ], this.#maxDiffBytes, "diff_too_large");
    return typeof result.stdout === "string"
      ? new TextEncoder().encode(result.stdout)
      : new Uint8Array(result.stdout);
  }

  async readReviews(owner: string, repo: string, pullNumber: number): Promise<readonly Record<string, unknown>[]> {
    return this.#readAllPages(`repos/${owner}/${repo}/pulls/${pullNumber}/reviews`);
  }

  async readReviewComments(owner: string, repo: string, pullNumber: number): Promise<readonly Record<string, unknown>[]> {
    return this.#readAllPages(`repos/${owner}/${repo}/pulls/${pullNumber}/comments`);
  }

  async #readAllPages(endpoint: string): Promise<readonly Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    for (let page = 1; page <= this.#maxPages; page += 1) {
      const raw = await this.#getJson(`${endpoint}?per_page=100&page=${page}`);
      if (!Array.isArray(raw) || raw.length > 100) {
        throw new GitHubReadError("snapshot_incomplete", "GitHub pagination response is invalid");
      }
      for (const item of raw) items.push(Object.freeze({ ...object(item, "paginated item") }));
      if (raw.length < 100) return Object.freeze(items);
    }
    throw new GitHubReadError("snapshot_incomplete", "GitHub pagination exceeded its bound");
  }

  async #getJson(endpoint: string): Promise<unknown> {
    const result = await this.#run(["gh", "api", "--method", "GET", endpoint]);
    try {
      return JSON.parse(stdoutText(result.stdout, "GitHub JSON"));
    } catch {
      throw new GitHubReadError("github_api_failed", "GitHub returned invalid JSON");
    }
  }

  async #run(
    argv: readonly string[],
    maxBufferBytes = 64 * 1024 * 1024,
    overflowCode: PrReviewFailureCode = "github_api_failed",
  ): Promise<PrReviewExecResult> {
    let result: PrReviewExecResult;
    try {
      result = await this.#exec(argv, {
        cwd: this.#cwd,
        maxBufferBytes,
        signal: this.#signal,
        timeoutMs: this.#timeoutMs,
      });
    } catch (error) {
      if (this.#signal?.aborted) {
        throw new GitHubReadError("task_cancelled", "GitHub read was cancelled");
      }
      throw error;
    }
    if (this.#signal?.aborted) {
      throw new GitHubReadError("task_cancelled", "GitHub read was cancelled");
    }
    if (
      !result
      || !Number.isInteger(result.exitCode)
      || (typeof result.stdout !== "string" && !(result.stdout instanceof Uint8Array))
      || typeof result.stderr !== "string"
    ) {
      throw new GitHubReadError("github_api_failed", "GitHub executor returned an invalid result");
    }
    if (result.exitCode !== 0) {
      if (/maxbuffer|stdout.*exceeded/i.test(result.stderr)) {
        throw new GitHubReadError(overflowCode, "GitHub response exceeds the configured byte limit");
      }
      const rateLimited = /rate.?limit|secondary rate|HTTP 429/i.test(result.stderr);
      throw new GitHubReadError(rateLimited ? "rate_limited" : "github_api_failed", "GitHub read failed");
    }
    return result;
  }
}

export class PrReviewPublish {
  readonly #exec: PrReviewExec;
  readonly #cwd?: string;
  readonly #signal?: AbortSignal;
  readonly #timeoutMs: number;

  constructor(options: PrReviewPublishOptions = {}) {
    this.#exec = options.exec ?? defaultPrReviewExec;
    this.#cwd = options.cwd;
    this.#signal = options.signal;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_PR_REVIEW_EXEC_TIMEOUT_MS;
  }

  async submitGroupedReview(
    owner: string,
    repo: string,
    pullNumber: number,
    payload: unknown,
  ): Promise<PublishedReview> {
    if (this.#signal?.aborted) {
      throw new GitHubPublishError("task_cancelled", "GitHub publication was cancelled before POST");
    }
    return withPrivateJsonFile(payload, async (path) => {
      if (this.#signal?.aborted) {
        throw new GitHubPublishError("task_cancelled", "GitHub publication was cancelled before POST");
      }
      let result: PrReviewExecResult;
      try {
        result = await this.#exec([
          "gh",
          "api",
          "--method",
          "POST",
          `repos/${owner}/${repo}/pulls/${pullNumber}/reviews`,
          "--input",
          path,
        ], {
          cwd: this.#cwd,
          maxBufferBytes: 64 * 1024 * 1024,
          signal: this.#signal,
          timeoutMs: this.#timeoutMs,
        });
      } catch (error) {
        throw new GitHubPublishError(
          "publication_indeterminate",
          this.#signal?.aborted
            ? "GitHub publication was cancelled after POST may have started"
            : error instanceof Error
            ? error.message
            : "GitHub publish executor failed",
          true,
        );
      }
      if (this.#signal?.aborted) {
        throw new GitHubPublishError(
          "publication_indeterminate",
          "GitHub publication was cancelled after POST may have started",
          true,
        );
      }
      if (
        !result
        || !Number.isInteger(result.exitCode)
        || (typeof result.stdout !== "string" && !(result.stdout instanceof Uint8Array))
        || typeof result.stderr !== "string"
      ) {
        throw new GitHubPublishError(
          "publication_indeterminate",
          "GitHub publish executor returned an invalid result",
          true,
        );
      }
      if (result.exitCode !== 0) {
        const rateLimited = /rate.?limit|secondary rate|HTTP 429/i.test(result.stderr);
        const apiRejected = /\bHTTP [45]\d{2}\b/i.test(result.stderr);
        const indeterminate = !rateLimited && !apiRejected;
        throw new GitHubPublishError(
          rateLimited ? "rate_limited" : apiRejected ? "github_api_failed" : "publication_indeterminate",
          rateLimited
            ? "GitHub publish was rate limited"
            : apiRejected
            ? "GitHub rejected the review publication"
            : "GitHub publish outcome is ambiguous",
          indeterminate,
        );
      }

      try {
        const review = object(
          JSON.parse(stdoutText(result.stdout, "published review")),
          "published review",
        );
        const reviewId = integer(review.id, "published review");
        const comments = review.comments === undefined ? [] : review.comments;
        if (!Array.isArray(comments)) throw new Error("invalid inline comments");
        const inlineCommentIds = comments.map((comment) =>
          integer(object(comment, "published inline comment").id, "published inline comment")
        );
        return Object.freeze({
          reviewId,
          inlineCommentIds: Object.freeze(inlineCommentIds),
        });
      } catch {
        throw new GitHubPublishError(
          "publication_indeterminate",
          "GitHub publish returned an invalid response",
          true,
        );
      }
    });
  }
}
