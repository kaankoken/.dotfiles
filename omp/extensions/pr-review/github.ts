import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrReviewFailureCode } from "./contracts";

export interface PrReviewExecOptions {
  cwd?: string;
  maxBufferBytes?: number;
}

export interface PrReviewExecResult {
  exitCode: number;
  stdout: string | Uint8Array;
  stderr: string;
}

export type PrReviewExec = (
  argv: readonly string[],
  options?: PrReviewExecOptions,
) => PrReviewExecResult | Promise<PrReviewExecResult>;

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
}

export class GitHubReadError extends Error {
  readonly code: PrReviewFailureCode;

  constructor(code: PrReviewFailureCode, message: string) {
    super(message);
    this.name = "GitHubReadError";
    this.code = code;
  }
}

export function defaultPrReviewExec(
  argv: readonly string[],
  options: PrReviewExecOptions = {},
): Promise<PrReviewExecResult> {
  const { promise, resolve } = Promise.withResolvers<PrReviewExecResult>();
  execFile(argv[0]!, argv.slice(1), {
    cwd: options.cwd,
    env: process.env,
    maxBuffer: options.maxBufferBytes ?? 64 * 1024 * 1024,
    shell: false,
  }, (error, stdout, stderr) => {
    resolve({
      exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
      stdout: new Uint8Array(stdout ?? []),
      stderr: [String(stderr ?? ""), String(error?.message ?? "")].filter(Boolean).join("\n"),
    });
  });
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

  constructor(options: GitHubReadClientOptions = {}) {
    this.#exec = options.exec ?? defaultPrReviewExec;
    this.#cwd = options.cwd;
    this.#maxPages = options.maxPages ?? 100;
    this.#maxDiffBytes = options.maxDiffBytes ?? 8 * 1024 * 1024;
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
        if (error.code === "rate_limited") throw error;
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
    return Object.freeze({
      state: string(raw.state, "pull request"),
      draft: raw.draft,
      merged: raw.merged,
      changedFileCount: integer(raw.changed_files, "pull request"),
      baseSha: string(base.sha, "pull request base"),
      headSha: string(head.sha, "pull request head"),
      headRepository,
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
    const result = await this.#exec(argv, { cwd: this.#cwd, maxBufferBytes });
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
