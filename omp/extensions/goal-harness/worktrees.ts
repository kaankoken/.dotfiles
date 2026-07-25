/**
 * Real git-worktree lifecycle for harness lanes.
 * Isolation is git worktree only — never OMP copy/reflink/overlay.
 */

import { existsSync, mkdirSync, realpathSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  GitHarnessError,
  createIntegrationBranch,
  createIssueBranch,
  gitHead,
  integrationBranchName,
  issueBranchName,
  resolveCanonicalRepo,
  runGit,
  validateSafeComponent,
  type RunGitContext,
} from "./git";

export class WorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktreeError";
  }
}

export type WorktreeRootChoice =
  | { kind: "existing"; dir: ".worktrees" | "worktrees"; path: string }
  | { kind: "project-instruction"; path: string }
  | { kind: "user-choice"; path: string };

export type IntegrationWorktree = {
  runId: string;
  path: string;
  branch: string;
  baseSha: string;
};

export type LaneWorktree = {
  runId: string;
  issueId: string;
  path: string;
  branch: string;
  baseSha: string;
};

export type WorktreeManagerOpts = {
  repoRoot: string;
  /** Project instruction path (e.g. from AGENTS.md). */
  projectInstructionRoot?: string;
  /** When no existing root / instruction: single focused choice. */
  userChoiceRoot?: string;
  /** Integrated dependency SHAs keyed by issue id (must be on integration). */
  integratedShas?: Record<string, string>;
};

const OMP_ISOLATION_MODES = new Set([
  "copy",
  "reflink",
  "apfs",
  "overlay",
  "omp-copy",
]);

/** Reject OMP copy isolation substitutes. */
export function assertRealGitWorktreeIsolation(mode?: string): void {
  if (mode && OMP_ISOLATION_MODES.has(mode.toLowerCase())) {
    throw new WorktreeError(
      "OMP copy/reflink/APFS/overlay isolation is not a git worktree substitute",
    );
  }
}

/**
 * Root order: existing .worktrees/ → existing worktrees/ → project
 * instruction → one focused user choice.
 */
export function resolveWorktreeRoot(
  repoRoot: string,
  opts?: {
    projectInstructionRoot?: string;
    userChoiceRoot?: string;
  },
): WorktreeRootChoice {
  const root = resolveCanonicalRepo(repoRoot);
  const hidden = join(root, ".worktrees");
  const plain = join(root, "worktrees");
  if (existsSync(hidden)) {
    return { kind: "existing", dir: ".worktrees", path: hidden };
  }
  if (existsSync(plain)) {
    return { kind: "existing", dir: "worktrees", path: plain };
  }
  if (opts?.projectInstructionRoot) {
    return {
      kind: "project-instruction",
      path: resolve(opts.projectInstructionRoot),
    };
  }
  if (opts?.userChoiceRoot) {
    return { kind: "user-choice", path: resolve(opts.userChoiceRoot) };
  }
  throw new WorktreeError(
    "no worktree root: need existing .worktrees/ or worktrees/, project instruction, or one focused user choice",
  );
}

/** Project-local roots must pass git check-ignore. */
export function assertProjectLocalIgnored(
  ctx: RunGitContext,
  relativeRoot: string,
): void {
  const name = relativeRoot.replace(/^\.\//, "").replace(/\/$/, "");
  try {
    runGit(ctx, ["check-ignore", "-q", name], { mutate: false });
  } catch {
    // check-ignore exits 1 when not ignored
    throw new WorktreeError(
      `project-local worktree root ${name} must pass git check-ignore`,
    );
  }
}

export function integrationPath(root: string, runId: string): string {
  validateSafeComponent(runId, "runId");
  return join(root, runId, "integration");
}

export function lanePath(root: string, runId: string, issueId: string): string {
  validateSafeComponent(runId, "runId");
  validateSafeComponent(issueId, "issueId");
  return join(root, runId, issueId);
}

export class WorktreeManager {
  readonly repoRoot: string;
  readonly ctx: RunGitContext;
  private worktreeRoot: string | null = null;
  private integration: IntegrationWorktree | null = null;
  private lanes = new Map<string, LaneWorktree>();
  private integratedShas: Record<string, string>;

  constructor(private readonly opts: WorktreeManagerOpts) {
    this.repoRoot = resolveCanonicalRepo(opts.repoRoot);
    this.ctx = { repoRoot: this.repoRoot, evidence: [] };
    this.integratedShas = { ...(opts.integratedShas ?? {}) };
  }

  resolveRoot(): WorktreeRootChoice {
    const choice = resolveWorktreeRoot(this.repoRoot, {
      projectInstructionRoot: this.opts.projectInstructionRoot,
      userChoiceRoot: this.opts.userChoiceRoot,
    });
    // Project-local under repo must be ignored
    if (choice.kind === "existing") {
      assertProjectLocalIgnored(this.ctx, choice.dir);
    } else if (
      choice.path.startsWith(this.repoRoot) ||
      choice.path.startsWith(this.repoRoot + "/")
    ) {
      // relative check-ignore on basename if under repo
      const rel = choice.path.slice(this.repoRoot.length).replace(/^\//, "");
      const top = rel.split("/")[0];
      if (top) assertProjectLocalIgnored(this.ctx, top);
    }
    this.worktreeRoot = choice.path;
    mkdirSync(choice.path, { recursive: true });
    return choice;
  }

  ensureIntegration(runId: string, baseSha: string): IntegrationWorktree {
    validateSafeComponent(runId, "runId");
    if (!this.worktreeRoot) this.resolveRoot();
    const root = this.worktreeRoot!;
    const path = integrationPath(root, runId);
    const branch = integrationBranchName(runId);

    if (!this.branchExists(branch)) {
      createIntegrationBranch(this.ctx, { runId, baseSha });
    }

    if (!existsSync(path)) {
      mkdirSync(join(root, runId), { recursive: true });
      runGit(
        this.ctx,
        ["worktree", "add", path, branch],
        { allowOnProtected: true, mutate: true },
      );
    }

    this.integration = { runId, path: realpathSync(path), branch, baseSha };
    return this.integration;
  }

  /**
   * Create lane only after all dependency SHAs are present on integration.
   */
  createLane(input: {
    runId: string;
    issueId: string;
    baseSha: string;
    dependsOn: string[];
    /** Reject dirty baseline if true and worktree is dirty after create */
    requireCleanBaseline?: boolean;
  }): LaneWorktree {
    assertRealGitWorktreeIsolation();
    validateSafeComponent(input.runId, "runId");
    validateSafeComponent(input.issueId, "issueId");
    if (!this.worktreeRoot) this.resolveRoot();
    if (!this.integration || this.integration.runId !== input.runId) {
      throw new WorktreeError(
        "create integration worktree before lanes for this run",
      );
    }

    for (const dep of input.dependsOn) {
      const sha = this.integratedShas[dep];
      if (!sha) {
        throw new WorktreeError(
          `lane ${input.issueId}: dependency ${dep} not integrated`,
        );
      }
      if (!this.shaOnBranch(this.integration.branch, sha)) {
        throw new WorktreeError(
          `lane ${input.issueId}: dependency ${dep} SHA ${sha.slice(0, 8)} not on integration`,
        );
      }
    }

    const root = this.worktreeRoot!;
    const path = lanePath(root, input.runId, input.issueId);
    const branch = issueBranchName(input.runId, input.issueId);

    if (!this.branchExists(branch)) {
      createIssueBranch(this.ctx, {
        runId: input.runId,
        issueId: input.issueId,
        baseSha: input.baseSha,
      });
    }

    if (!existsSync(path)) {
      runGit(
        this.ctx,
        ["worktree", "add", path, branch],
        { allowOnProtected: true, mutate: true },
      );
    }

    if (input.requireCleanBaseline !== false) {
      const dirty = this.isDirty(path);
      if (dirty) {
        throw new WorktreeError(
          `lane ${input.issueId}: dirty/failing baseline blocks only this lane`,
        );
      }
    }

    const lane: LaneWorktree = {
      runId: input.runId,
      issueId: input.issueId,
      path: realpathSync(path),
      branch,
      baseSha: input.baseSha,
    };
    this.lanes.set(input.issueId, lane);
    return lane;
  }

  markIntegrated(issueId: string, sha: string): void {
    this.integratedShas[issueId] = sha;
  }

  getLane(issueId: string): LaneWorktree | undefined {
    return this.lanes.get(issueId);
  }

  getIntegration(): IntegrationWorktree | null {
    return this.integration;
  }

  private branchExists(name: string): boolean {
    try {
      runGit(this.ctx, ["rev-parse", "--verify", name], { mutate: false });
      return true;
    } catch {
      return false;
    }
  }

  private shaOnBranch(branch: string, sha: string): boolean {
    try {
      runGit(
        this.ctx,
        ["merge-base", "--is-ancestor", sha, branch],
        { mutate: false },
      );
      return true;
    } catch {
      return false;
    }
  }

  private isDirty(worktreePath: string): boolean {
    try {
      const out = runGit(
        { repoRoot: worktreePath, evidence: this.ctx.evidence },
        ["status", "--porcelain"],
        { mutate: false },
      );
      return out.length > 0;
    } catch {
      return true;
    }
  }
}

/** Read CLAUDE.md / AGENTS.md for worktree directory preference (best-effort). */
export function readProjectWorktreeInstruction(
  repoRoot: string,
): string | undefined {
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const p = join(repoRoot, name);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    const m = text.match(/worktree[s]?\s*(?:director(?:y|ies))?\s*[:=]\s*(\S+)/i);
    if (m?.[1]) return resolve(repoRoot, m[1]);
  }
  return undefined;
}
