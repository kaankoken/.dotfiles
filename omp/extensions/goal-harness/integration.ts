/**
 * Dependency-ordered integration of reviewed lane commit ranges into
 * harness/<run-id>/integration. No rebase, force-push, or silent conflict resolution.
 */

import { existsSync, realpathSync } from "node:fs";
import {
  GitHarnessError,
  assertNoForceOrRewrite,
  runGit,
  type RunGitContext,
} from "./git";
import type { LaneReviewState } from "./task-review";
import { isLaneApproved } from "./task-review";

export class IntegrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationError";
  }
}

export type ReviewedRange = {
  issueId: string;
  branch: string;
  baseSha: string;
  headSha: string;
  worktreePath: string;
  dependsOn: string[];
  review: LaneReviewState;
};

export type ShaMapping = {
  issueId: string;
  sourceSha: string;
  integratedSha: string;
};

export type IntegrationConflict = {
  issueId: string;
  message: string;
  preservedSourceBranch: string;
  preservedIntegrationBranch: string;
};

export type IntegrationResult = {
  integrated: ShaMapping[];
  conflicts: IntegrationConflict[];
  checks: Array<{ issueId: string; command: string; exitCode: number }>;
  cleanedLanes: string[];
  preservedFailedLanes: string[];
};

export type IntegrationOpts = {
  repoRoot: string;
  integrationWorktreePath: string;
  integrationBranch: string;
  /** Ordered by Beads dependency (parents first). */
  ranges: ReviewedRange[];
  /** Re-run after each successful cherry-pick. */
  affectedCheck?: (integrationCwd: string) => {
    command: string;
    exitCode: number;
  };
  /** Whether a PR is still open for this run (keeps integration worktree). */
  prOpen?: boolean;
  /** Cleanup successful lanes only when true after all gates. */
  cleanupSuccessful?: boolean;
};

function ctxFor(path: string, evidence: RunGitContext["evidence"]): RunGitContext {
  return { repoRoot: path, evidence };
}

/**
 * Only reviewed BASE..HEAD ranges that are approved are eligible.
 */
export function assertEligibleRange(range: ReviewedRange): void {
  if (!isLaneApproved(range.review)) {
    throw new IntegrationError(
      `issue ${range.issueId}: both reviews required before integration`,
    );
  }
  if (range.review.baseSha !== range.baseSha) {
    throw new IntegrationError(`issue ${range.issueId}: baseSha mismatch`);
  }
  if (range.review.headSha !== range.headSha) {
    throw new IntegrationError(`issue ${range.issueId}: headSha mismatch`);
  }
  if (!/^[0-9a-f]{7,40}$/i.test(range.baseSha) || !/^[0-9a-f]{7,40}$/i.test(range.headSha)) {
    throw new IntegrationError(`issue ${range.issueId}: invalid sha range`);
  }
}

/**
 * Topological order by dependsOn (Beads dependency order).
 * Throws on cycles / missing nodes.
 */
export function orderByDependencies(ranges: ReviewedRange[]): ReviewedRange[] {
  const byId = new Map(ranges.map((r) => [r.issueId, r]));
  const sorted: ReviewedRange[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();

  function visit(id: string): void {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      throw new IntegrationError(`dependency cycle at ${id}`);
    }
    const r = byId.get(id);
    if (!r) {
      // external dep already integrated — skip
      done.add(id);
      return;
    }
    visiting.add(id);
    for (const d of r.dependsOn) visit(d);
    visiting.delete(id);
    done.add(id);
    sorted.push(r);
  }

  for (const r of ranges) visit(r.issueId);
  return sorted;
}

export function integrateReviewedLanes(opts: IntegrationOpts): IntegrationResult {
  const evidence: RunGitContext["evidence"] = [];
  const integPath = realpathSync(opts.integrationWorktreePath);
  const integ = ctxFor(integPath, evidence);

  // Refuse force / rewrite on any planned args
  assertNoForceOrRewrite(["cherry-pick", "HEAD"]);

  const ordered = orderByDependencies(opts.ranges);
  const integrated: ShaMapping[] = [];
  const conflicts: IntegrationConflict[] = [];
  const checks: IntegrationResult["checks"] = [];
  const cleanedLanes: string[] = [];
  const preservedFailedLanes: string[] = [];
  const doneIds = new Set<string>();

  for (const range of ordered) {
    try {
      assertEligibleRange(range);
    } catch (err) {
      preservedFailedLanes.push(range.worktreePath);
      conflicts.push({
        issueId: range.issueId,
        message: err instanceof Error ? err.message : String(err),
        preservedSourceBranch: range.branch,
        preservedIntegrationBranch: opts.integrationBranch,
      });
      continue;
    }

    // Dependencies must already be integrated if in this batch
    for (const d of range.dependsOn) {
      if (byIdHas(opts.ranges, d) && !doneIds.has(d)) {
        throw new IntegrationError(
          `issue ${range.issueId}: dependency ${d} not yet integrated`,
        );
      }
    }

    // List commits in BASE..HEAD (exclusive base)
    let commits: string[] = [];
    try {
      const out = runGit(
        ctxFor(range.worktreePath, evidence),
        ["rev-list", "--reverse", `${range.baseSha}..${range.headSha}`],
        { mutate: false },
      );
      commits = out ? out.split("\n").filter(Boolean) : [];
    } catch (err) {
      throw new IntegrationError(
        `issue ${range.issueId}: cannot list range: ${err}`,
      );
    }

    if (commits.length === 0) {
      preservedFailedLanes.push(range.worktreePath);
      conflicts.push({
        issueId: range.issueId,
        message: "empty reviewed range",
        preservedSourceBranch: range.branch,
        preservedIntegrationBranch: opts.integrationBranch,
      });
      continue;
    }

    let lastIntegrated = "";
    let failed = false;
    for (const sha of commits) {
      try {
        runGit(integ, ["cherry-pick", sha], {
          allowOnProtected: true,
          mutate: true,
        });
        lastIntegrated = runGit(integ, ["rev-parse", "HEAD"], { mutate: false });
      } catch (err) {
        // abort cherry-pick, preserve both sides — no silent choice
        try {
          runGit(integ, ["cherry-pick", "--abort"], {
            allowOnProtected: true,
            mutate: true,
          });
        } catch {
          /* may not be in progress */
        }
        failed = true;
        conflicts.push({
          issueId: range.issueId,
          message: `cherry-pick conflict on ${sha.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`,
          preservedSourceBranch: range.branch,
          preservedIntegrationBranch: opts.integrationBranch,
        });
        preservedFailedLanes.push(range.worktreePath);
        break;
      }
    }

    if (failed) continue;

    integrated.push({
      issueId: range.issueId,
      sourceSha: range.headSha,
      integratedSha: lastIntegrated,
    });
    doneIds.add(range.issueId);

    if (opts.affectedCheck) {
      const c = opts.affectedCheck(integPath);
      checks.push({ issueId: range.issueId, ...c });
      if (c.exitCode !== 0) {
        // leave integrated commits; block cleanup for this lane
        preservedFailedLanes.push(range.worktreePath);
        conflicts.push({
          issueId: range.issueId,
          message: `affected check failed: ${c.command}`,
          preservedSourceBranch: range.branch,
          preservedIntegrationBranch: opts.integrationBranch,
        });
        continue;
      }
    }

    if (opts.cleanupSuccessful && !opts.prOpen) {
      // non-forced worktree remove only when clean+integrated+rechecked
      try {
        assertNoForceOrRewrite(["worktree", "remove", range.worktreePath]);
        runGit(
          { repoRoot: opts.repoRoot, evidence },
          ["worktree", "remove", range.worktreePath],
          { allowOnProtected: true, mutate: true },
        );
        cleanedLanes.push(range.worktreePath);
      } catch {
        preservedFailedLanes.push(range.worktreePath);
      }
    } else if (opts.cleanupSuccessful && opts.prOpen) {
      // keep integration; successful lane may still clean if recorded
      try {
        runGit(
          { repoRoot: opts.repoRoot, evidence },
          ["worktree", "remove", range.worktreePath],
          { allowOnProtected: true, mutate: true },
        );
        cleanedLanes.push(range.worktreePath);
      } catch {
        /* keep */
      }
    }
  }

  // Integration worktree remains while PR open
  if (opts.prOpen && !existsSync(integPath)) {
    throw new IntegrationError(
      "integration worktree must remain while PR is open",
    );
  }

  return {
    integrated,
    conflicts,
    checks,
    cleanedLanes,
    preservedFailedLanes,
  };
}

function byIdHas(ranges: ReviewedRange[], id: string): boolean {
  return ranges.some((r) => r.issueId === id);
}

/** Explicit policy: never rebase or force-push lanes. */
export function assertNoRewriteIntegrationArgs(args: string[]): void {
  assertNoForceOrRewrite(args);
  if (args.includes("rebase")) {
    throw new IntegrationError("automatic rebase is forbidden");
  }
}
