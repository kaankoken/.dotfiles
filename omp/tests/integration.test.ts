import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createTempRepo, ensureIgnored, type TempRepo } from "./fixtures/git-repo";
import { WorktreeManager } from "../extensions/goal-harness/worktrees";
import {
  assertEligibleRange,
  assertNoRewriteIntegrationArgs,
  integrateReviewedLanes,
  orderByDependencies,
  IntegrationError,
  type ReviewedRange,
} from "../extensions/goal-harness/integration";
import {
  createLaneReviewState,
  type LaneReviewState,
} from "../extensions/goal-harness/task-review";

const repos: TempRepo[] = [];
afterEach(() => {
  while (repos.length) repos.pop()?.dispose();
});

function approvedReview(base: string, head: string, issueId: string): LaneReviewState {
  return {
    issueId,
    implementerAgent: "implementer",
    baseSha: base,
    headSha: head,
    status: "approved",
    selfReview: {
      ok: true,
      feedback: "ok",
      blocking: [],
      headShaAtReview: head,
      kind: "self",
      agentName: "self",
    },
    specReview: {
      ok: true,
      feedback: "ok",
      blocking: [],
      headShaAtReview: head,
      kind: "spec",
      agentName: "spec-compliance-reviewer",
    },
    qualityReview: {
      ok: true,
      feedback: "ok",
      blocking: [],
      headShaAtReview: head,
      kind: "quality",
      agentName: "code-reviewer",
    },
  };
}

function setupRun() {
  const r = createTempRepo();
  repos.push(r);
  ensureIgnored(r, ".worktrees");
  const mgr = new WorktreeManager({ repoRoot: r.root });
  mgr.resolveRoot();
  const base = r.head();
  const integ = mgr.ensureIntegration("run1", base);
  return { r, mgr, base, integ };
}

function commitInLane(
  path: string,
  file: string,
  content: string,
  msg: string,
): string {
  writeFileSync(join(path, file), content);
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  execFileSync("git", ["-C", path, "add", file], { env });
  execFileSync("git", ["-C", path, "commit", "-m", msg], { env });
  return execFileSync("git", ["-C", path, "rev-parse", "HEAD"], {
    encoding: "utf8",
    env,
  }).trim();
}

describe("dependency-ordered integration", () => {
  test("only reviewed BASE..HEAD range is eligible", () => {
    const bad = createLaneReviewState({
      issueId: "x",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
    });
    expect(() =>
      assertEligibleRange({
        issueId: "x",
        branch: "b",
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        worktreePath: "/p",
        dependsOn: [],
        review: bad,
      }),
    ).toThrow(/reviews required/i);
  });

  test("Beads dependency order determines cherry-pick order", () => {
    const mk = (id: string, deps: string[]): ReviewedRange => ({
      issueId: id,
      branch: `harness/run1/${id}`,
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      worktreePath: `/p/${id}`,
      dependsOn: deps,
      review: approvedReview("a".repeat(40), "b".repeat(40), id),
    });
    const ordered = orderByDependencies([
      mk("child", ["parent"]),
      mk("parent", []),
      mk("other", ["parent"]),
    ]);
    expect(ordered.map((r) => r.issueId)).toEqual([
      "parent",
      "child",
      "other",
    ]);
  });

  test("cherry-picks reviewed range and records source-to-integrated mapping", () => {
    const { r, mgr, base, integ } = setupRun();
    const lane = mgr.createLane({
      runId: "run1",
      issueId: "iss1",
      baseSha: base,
      dependsOn: [],
    });
    const head = commitInLane(lane.path, "feat.ts", "export const a = 1\n", "feat");
    const range: ReviewedRange = {
      issueId: "iss1",
      branch: lane.branch,
      baseSha: base,
      headSha: head,
      worktreePath: lane.path,
      dependsOn: [],
      review: approvedReview(base, head, "iss1"),
    };
    const result = integrateReviewedLanes({
      repoRoot: r.root,
      integrationWorktreePath: integ.path,
      integrationBranch: integ.branch,
      ranges: [range],
      affectedCheck: () => ({ command: "true", exitCode: 0 }),
    });
    expect(result.integrated).toHaveLength(1);
    expect(result.integrated[0]!.sourceSha).toBe(head);
    expect(result.integrated[0]!.integratedSha).toMatch(/^[0-9a-f]+$/);
    expect(result.checks).toHaveLength(1);
    expect(existsSync(join(integ.path, "feat.ts"))).toBe(true);
  });

  test("affected checks rerun after every integration", () => {
    const { r, mgr, base, integ } = setupRun();
    const lane = mgr.createLane({
      runId: "run1",
      issueId: "iss1",
      baseSha: base,
      dependsOn: [],
    });
    const head = commitInLane(lane.path, "a.ts", "1\n", "a");
    let checks = 0;
    integrateReviewedLanes({
      repoRoot: r.root,
      integrationWorktreePath: integ.path,
      integrationBranch: integ.branch,
      ranges: [
        {
          issueId: "iss1",
          branch: lane.branch,
          baseSha: base,
          headSha: head,
          worktreePath: lane.path,
          dependsOn: [],
          review: approvedReview(base, head, "iss1"),
        },
      ],
      affectedCheck: () => {
        checks++;
        return { command: "check", exitCode: 0 };
      },
    });
    expect(checks).toBe(1);
  });

  test("cherry-pick conflict creates blocking work and preserves both sides", () => {
    const { r, mgr, base, integ } = setupRun();
    // conflict: same file different content on integration and lane
    writeFileSync(join(integ.path, "clash.txt"), "integration\n");
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    };
    execFileSync("git", ["-C", integ.path, "add", "clash.txt"], { env });
    execFileSync("git", ["-C", integ.path, "commit", "-m", "integ clash"], {
      env,
    });

    const lane = mgr.createLane({
      runId: "run1",
      issueId: "iss2",
      baseSha: base,
      dependsOn: [],
    });
    // lane from base without integ commit — add different clash
    writeFileSync(join(lane.path, "clash.txt"), "lane\n");
    execFileSync("git", ["-C", lane.path, "add", "clash.txt"], { env });
    execFileSync("git", ["-C", lane.path, "commit", "-m", "lane clash"], {
      env,
    });
    const head = execFileSync("git", ["-C", lane.path, "rev-parse", "HEAD"], {
      encoding: "utf8",
      env,
    }).trim();

    const result = integrateReviewedLanes({
      repoRoot: r.root,
      integrationWorktreePath: integ.path,
      integrationBranch: integ.branch,
      ranges: [
        {
          issueId: "iss2",
          branch: lane.branch,
          baseSha: base,
          headSha: head,
          worktreePath: lane.path,
          dependsOn: [],
          review: approvedReview(base, head, "iss2"),
        },
      ],
    });
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.preservedFailedLanes).toContain(lane.path);
    expect(result.conflicts[0]!.preservedSourceBranch).toBe(lane.branch);
    expect(existsSync(lane.path)).toBe(true);
  });

  test("no automatic rebase or force-push", () => {
    expect(() => assertNoRewriteIntegrationArgs(["push", "--force"])).toThrow();
    expect(() => assertNoRewriteIntegrationArgs(["rebase", "main"])).toThrow();
  });

  test("successful cleanup is non-forced after clean integrated rechecked state", () => {
    const { r, mgr, base, integ } = setupRun();
    const lane = mgr.createLane({
      runId: "run1",
      issueId: "iss1",
      baseSha: base,
      dependsOn: [],
    });
    const head = commitInLane(lane.path, "z.ts", "z\n", "z");
    const path = lane.path;
    const result = integrateReviewedLanes({
      repoRoot: r.root,
      integrationWorktreePath: integ.path,
      integrationBranch: integ.branch,
      ranges: [
        {
          issueId: "iss1",
          branch: lane.branch,
          baseSha: base,
          headSha: head,
          worktreePath: path,
          dependsOn: [],
          review: approvedReview(base, head, "iss1"),
        },
      ],
      affectedCheck: () => ({ command: "true", exitCode: 0 }),
      cleanupSuccessful: true,
      prOpen: false,
    });
    expect(result.cleanedLanes).toContain(path);
    expect(existsSync(path)).toBe(false);
  });

  test("integration worktree remains while PR open", () => {
    const { r, mgr, base, integ } = setupRun();
    const lane = mgr.createLane({
      runId: "run1",
      issueId: "iss1",
      baseSha: base,
      dependsOn: [],
    });
    const head = commitInLane(lane.path, "p.ts", "p\n", "p");
    integrateReviewedLanes({
      repoRoot: r.root,
      integrationWorktreePath: integ.path,
      integrationBranch: integ.branch,
      ranges: [
        {
          issueId: "iss1",
          branch: lane.branch,
          baseSha: base,
          headSha: head,
          worktreePath: lane.path,
          dependsOn: [],
          review: approvedReview(base, head, "iss1"),
        },
      ],
      cleanupSuccessful: true,
      prOpen: true,
    });
    expect(existsSync(integ.path)).toBe(true);
  });
});
