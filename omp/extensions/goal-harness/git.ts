/**
 * Guarded git primitives for the OMP goal harness.
 * Subprocess argument arrays only — no shell, no force, no history rewrite.
 */

import { execFileSync } from "node:child_process";
import { realpathSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export class GitHarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHarnessError";
  }
}

export const PROTECTED_BRANCHES = new Set([
  "main",
  "master",
  "trunk",
  "develop",
  "production",
  "prod",
]);

/** Single path/ref component: [A-Za-z0-9._-]+ no dots-only, no empty. */
const SAFE_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type GitEvidence = {
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  at: string;
};

export type RunGitContext = {
  repoRoot: string;
  evidence: GitEvidence[];
  /** Optional expected branch before mutation. */
  expectBranch?: string;
  /** Optional expected HEAD before mutation. */
  expectHead?: string;
};

export type RunBaseRecord = {
  runId: string;
  baseSha: string;
  invocationBranch: string;
  recordedAt: string;
};

export function validateSafeComponent(id: string, label = "id"): void {
  if (!id || typeof id !== "string") {
    throw new GitHarnessError(`${label}: empty component`);
  }
  if (id.includes("/") || id.includes("\\")) {
    throw new GitHarnessError(
      `${label}: must be a single safe path/ref component (got multi-segment)`,
    );
  }
  if (id === "." || id === ".." || id.includes("..")) {
    throw new GitHarnessError(`${label}: path traversal rejected`);
  }
  if (/\s/.test(id)) {
    throw new GitHarnessError(`${label}: whitespace not allowed`);
  }
  if (!SAFE_COMPONENT.test(id)) {
    throw new GitHarnessError(
      `${label}: unsafe characters (allowed: A-Za-z0-9._- starting alphanumeric)`,
    );
  }
}

/**
 * Integration branch: harness/<run-id>/integration
 * (Git cannot host both refs/heads/harness/<run-id> and
 * refs/heads/harness/<run-id>/<issue-id>; /integration keeps the design
 * hierarchy while remaining a valid ref namespace.)
 */
export function integrationBranchName(runId: string): string {
  validateSafeComponent(runId, "runId");
  return `harness/${runId}/integration`;
}

export function issueBranchName(runId: string, issueId: string): string;
export function issueBranchName(runId: string, issueId: string): string {
  validateSafeComponent(runId, "runId");
  validateSafeComponent(issueId, "issueId");
  return `harness/${runId}/${issueId}`;
}

export function assertNoForceOrRewrite(args: string[]): void {
  const joined = args.join(" ");
  const flags = new Set(args);
  if (
    flags.has("--force") ||
    flags.has("-f") ||
    flags.has("--force-with-lease") ||
    /\b--force\b/.test(joined)
  ) {
    throw new GitHarnessError("git: force flags rejected");
  }
  if (flags.has("--hard") || args.includes("reset") && args.includes("--hard")) {
    throw new GitHarnessError("git: history rewrite (--hard) rejected");
  }
  if (args[0] === "rebase" || args.includes("rebase")) {
    throw new GitHarnessError("git: history rewrite (rebase) rejected");
  }
  if (args.includes("--amend") || joined.includes("commit --amend")) {
    throw new GitHarnessError("git: history rewrite (--amend) rejected");
  }
  if (args[0] === "filter-branch" || args[0] === "filter-repo") {
    throw new GitHarnessError("git: history rewrite filter rejected");
  }
}

export function resolveCanonicalRepo(path: string): string {
  const abs = resolve(path);
  if (!existsSync(abs)) {
    throw new GitHarnessError(`repo path does not exist: ${abs}`);
  }
  try {
    const out = execFileSync(
      "git",
      ["-C", abs, "rev-parse", "--show-toplevel"],
      { encoding: "utf8" },
    ).trim();
    return realpathSync(out);
  } catch {
    throw new GitHarnessError(`not a git repository: ${abs}`);
  }
}

function currentBranch(repoRoot: string): string {
  return execFileSync(
    "git",
    ["-C", repoRoot, "branch", "--show-current"],
    { encoding: "utf8" },
  ).trim();
}

function currentHead(repoRoot: string): string {
  return execFileSync(
    "git",
    ["-C", repoRoot, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
}

export function runGit(
  ctx: RunGitContext,
  args: string[],
  opts?: { allowOnProtected?: boolean; mutate?: boolean },
): string {
  try {
    assertNoForceOrRewrite(args);
  } catch (err) {
    ctx.evidence.push({
      args: [...args],
      exitCode: -1,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      at: new Date().toISOString(),
    });
    throw err;
  }
  const repoRoot = resolveCanonicalRepo(ctx.repoRoot);
  const mutate = opts?.mutate ?? isMutating(args);

  if (mutate) {
    const branch = currentBranch(repoRoot);
    if (ctx.expectBranch && branch !== ctx.expectBranch) {
      throw new GitHarnessError(
        `expected branch ${ctx.expectBranch}, on ${branch}`,
      );
    }
    if (ctx.expectHead) {
      const head = currentHead(repoRoot);
      if (head !== ctx.expectHead) {
        throw new GitHarnessError(
          `expected HEAD ${ctx.expectHead.slice(0, 8)}, got ${head.slice(0, 8)}`,
        );
      }
    }
    if (
      !opts?.allowOnProtected &&
      PROTECTED_BRANCHES.has(branch) &&
      isBranchMutating(args)
    ) {
      throw new GitHarnessError(
        `refusing to mutate protected branch ${branch}`,
      );
    }
  }

  let exitCode = 0;
  let stdout = "";
  let stderr = "";
  try {
    stdout = execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      env: process.env,
    });
  } catch (err: unknown) {
    exitCode = 1;
    const e = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    exitCode = e.status ?? 1;
    stdout = String(e.stdout ?? "");
    stderr = String(e.stderr ?? e.message ?? "");
    ctx.evidence.push({
      args: [...args],
      exitCode,
      stdout,
      stderr,
      at: new Date().toISOString(),
    });
    throw new GitHarnessError(
      `git ${args.join(" ")} failed (exit ${exitCode}): ${stderr || stdout}`,
    );
  }

  ctx.evidence.push({
    args: [...args],
    exitCode: 0,
    stdout,
    stderr,
    at: new Date().toISOString(),
  });
  return stdout.trim();
}

function isMutating(args: string[]): boolean {
  const cmd = args[0];
  if (!cmd) return false;
  if (["status", "rev-parse", "log", "show", "diff", "branch", "worktree"].includes(cmd)) {
    if (cmd === "branch" && (args.includes("-d") || args.includes("-D") || args.includes("-m"))) {
      return true;
    }
    if (cmd === "worktree" && args[1] && args[1] !== "list") return true;
    if (cmd === "branch" && args.length === 1) return false;
    if (cmd === "branch" && args[1] === "--show-current") return false;
    if (cmd === "branch" && !args.some((a) => a.startsWith("-"))) {
      // `git branch name` creates
      return args.length >= 2;
    }
    return false;
  }
  return true;
}

function isBranchMutating(args: string[]): boolean {
  // Creating a new branch ref from a protected checkout is OK (does not change branch tip of main)
  // Committing on main is not OK
  const cmd = args[0];
  if (cmd === "commit" || cmd === "merge" || cmd === "cherry-pick" || cmd === "reset") {
    return true;
  }
  if (cmd === "checkout" || cmd === "switch") return true;
  return false;
}

export function recordRunBase(input: {
  runId: string;
  baseSha: string;
  invocationBranch: string;
  existing?: RunBaseRecord;
}): RunBaseRecord {
  validateSafeComponent(input.runId, "runId");
  if (!/^[0-9a-f]{7,40}$/i.test(input.baseSha)) {
    throw new GitHarnessError("RUN_BASE_SHA: invalid sha");
  }
  if (input.existing) {
    if (input.existing.runId !== input.runId) {
      throw new GitHarnessError("RUN_BASE_SHA: runId mismatch");
    }
    if (input.existing.baseSha !== input.baseSha) {
      throw new GitHarnessError(
        "RUN_BASE_SHA is immutable once recorded for a run",
      );
    }
    return input.existing;
  }
  return {
    runId: input.runId,
    baseSha: input.baseSha,
    invocationBranch: input.invocationBranch,
    recordedAt: new Date().toISOString(),
  };
}

export function createIntegrationBranch(
  ctx: RunGitContext,
  opts: { runId: string; baseSha: string },
): { branch: string; baseSha: string } {
  const branch = integrationBranchName(opts.runId);
  // Create branch at base without checking it out (leave protected branch alone)
  runGit(ctx, ["branch", branch, opts.baseSha], {
    allowOnProtected: true,
    mutate: true,
  });
  return { branch, baseSha: opts.baseSha };
}

export function createIssueBranch(
  ctx: RunGitContext,
  opts: { runId: string; issueId: string; baseSha: string },
): { branch: string; baseSha: string } {
  const branch = issueBranchName(opts.runId, opts.issueId);
  runGit(ctx, ["branch", branch, opts.baseSha], {
    allowOnProtected: true,
    mutate: true,
  });
  return { branch, baseSha: opts.baseSha };
}

/** Read-only helpers */
export function gitHead(ctx: RunGitContext): string {
  return runGit(ctx, ["rev-parse", "HEAD"], { mutate: false });
}

export function gitBranch(ctx: RunGitContext): string {
  return runGit(ctx, ["branch", "--show-current"], { mutate: false });
}

export function branchExists(ctx: RunGitContext, name: string): boolean {
  try {
    runGit(ctx, ["rev-parse", "--verify", name], { mutate: false });
    return true;
  } catch {
    return false;
  }
}
