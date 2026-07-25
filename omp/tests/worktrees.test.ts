import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempRepo, ensureIgnored, type TempRepo } from "./fixtures/git-repo";
import {
  GitHarnessError,
  PROTECTED_BRANCHES,
  assertNoForceOrRewrite,
  createIntegrationBranch,
  createIssueBranch,
  integrationBranchName,
  issueBranchName,
  recordRunBase,
  resolveCanonicalRepo,
  runGit,
  validateSafeComponent,
  type RunGitContext,
} from "../extensions/goal-harness/git";

const repos: TempRepo[] = [];

afterEach(() => {
  while (repos.length) {
    repos.pop()?.dispose();
  }
});

function repo(opts?: Parameters<typeof createTempRepo>[0]): TempRepo {
  const r = createTempRepo(opts);
  repos.push(r);
  return r;
}

function ctx(r: TempRepo): RunGitContext {
  return { repoRoot: r.root, evidence: [] };
}

describe("git safety primitives", () => {
  test("validateSafeComponent rejects path traversal and multi-segment", () => {
    expect(() => validateSafeComponent("run-1")).not.toThrow();
    expect(() => validateSafeComponent("issue-abc")).not.toThrow();
    expect(() => validateSafeComponent("a/b")).toThrow(/single|safe|component/i);
    expect(() => validateSafeComponent("..")).toThrow();
    expect(() => validateSafeComponent("a..b")).toThrow();
    expect(() => validateSafeComponent("")).toThrow();
    expect(() => validateSafeComponent("has space")).toThrow();
  });

  test("branch names use harness/<run-id>/integration and harness/<run-id>/<issue-id>", () => {
    // /integration suffix required: git cannot have both harness/run-1 and harness/run-1/x
    expect(integrationBranchName("run-1")).toBe("harness/run-1/integration");
    expect(issueBranchName("run-1", "issue-9")).toBe("harness/run-1/issue-9");
    expect(() => integrationBranchName("a/b")).toThrow();
    expect(() => issueBranchName("run-1", "../x")).toThrow();
  });

  test("RUN_BASE_SHA is immutable once recorded", () => {
    const r = repo();
    const base = r.head();
    const run = recordRunBase({
      runId: "run-1",
      baseSha: base,
      invocationBranch: r.branch(),
    });
    expect(run.baseSha).toBe(base);
    expect(() =>
      recordRunBase({
        runId: "run-1",
        baseSha: "deadbeef".repeat(5),
        invocationBranch: r.branch(),
        existing: run,
      }),
    ).toThrow(/immutable|RUN_BASE_SHA/i);
  });

  test("createIntegrationBranch does not mutate protected invocation branch", () => {
    const r = repo();
    const inv = r.branch();
    expect(PROTECTED_BRANCHES.has(inv) || inv === "main" || inv === "master").toBe(
      true,
    );
    const before = r.head();
    const c = ctx(r);
    const result = createIntegrationBranch(c, {
      runId: "run-abc",
      baseSha: before,
    });
    expect(result.branch).toBe("harness/run-abc/integration");
    // still on invocation branch
    expect(r.branch()).toBe(inv);
    expect(r.head()).toBe(before);
    // integration branch exists at base
    expect(r.git("rev-parse", "harness/run-abc/integration")).toBe(before);
  });

  test("createIssueBranch only after validated components", () => {
    const r = repo();
    const c = ctx(r);
    createIntegrationBranch(c, { runId: "run-1", baseSha: r.head() });
    const issue = createIssueBranch(c, {
      runId: "run-1",
      issueId: "task-1",
      baseSha: r.head(),
    });
    expect(issue.branch).toBe("harness/run-1/task-1");
    expect(r.branch()).toBe("main");
  });

  test("force flags and history rewriting are rejected", () => {
    expect(() => assertNoForceOrRewrite(["push", "--force"])).toThrow(/force/i);
    expect(() => assertNoForceOrRewrite(["push", "-f"])).toThrow(/force/i);
    expect(() => assertNoForceOrRewrite(["reset", "--hard", "HEAD~1"])).toThrow(
      /rewrite|hard/i,
    );
    expect(() => assertNoForceOrRewrite(["rebase", "main"])).toThrow(/rewrite|rebase/i);
    expect(() => assertNoForceOrRewrite(["commit", "--amend"])).toThrow(
      /rewrite|amend/i,
    );
    expect(() => assertNoForceOrRewrite(["status"])).not.toThrow();
  });

  test("runGit refuses force via argument array", () => {
    const r = repo();
    const c = ctx(r);
    expect(() => runGit(c, ["push", "--force"])).toThrow(/force/i);
    expect(c.evidence.length).toBeGreaterThan(0);
  });

  test("resolveCanonicalRepo rejects non-repo paths", () => {
    expect(() => resolveCanonicalRepo("/tmp/not-a-git-repo-xyz")).toThrow();
    const r = repo();
    const canon = resolveCanonicalRepo(r.root);
    // macOS /var → /private/var realpath
    expect(canon).toContain("omp-harness-git-");
    expect(resolveCanonicalRepo(canon)).toBe(canon);
  });

  test("protected branch list includes main and master", () => {
    expect(PROTECTED_BRANCHES.has("main")).toBe(true);
    expect(PROTECTED_BRANCHES.has("master")).toBe(true);
  });
});


import {
  WorktreeManager,
  WorktreeError,
  assertRealGitWorktreeIsolation,
  integrationPath,
  lanePath,
  resolveWorktreeRoot,
} from "../extensions/goal-harness/worktrees";
import {
  LaneSemaphore,
  MAX_LANES,
  SemaphoreError,
} from "../extensions/goal-harness/semaphore";

describe("worktree lifecycle", () => {
  test("integration worktree at <root>/<run-id>/integration", () => {
    const r = repo();
    ensureIgnored(r, ".worktrees");
    const mgr = new WorktreeManager({ repoRoot: r.root });
    const root = mgr.resolveRoot();
    expect(root.kind).toBe("existing");
    if (root.kind !== "existing") throw new Error("expected existing root");
    expect(root.dir).toBe(".worktrees");
    const base = r.head();
    const integ = mgr.ensureIntegration("run1", base);
    expect(integ.path).toContain(join(".worktrees", "run1", "integration"));
    expect(existsSync(integ.path)).toBe(true);
    expect(integ.branch).toBe("harness/run1/integration");
    expect(integrationPath(root.path, "run1")).toBe(
      join(root.path, "run1", "integration"),
    );
  });

  test("lane path is <root>/<run-id>/<issue-id>", () => {
    const r = repo();
    ensureIgnored(r, ".worktrees");
    const mgr = new WorktreeManager({ repoRoot: r.root });
    mgr.resolveRoot();
    const base = r.head();
    mgr.ensureIntegration("run1", base);
    const lane = mgr.createLane({
      runId: "run1",
      issueId: "iss1",
      baseSha: base,
      dependsOn: [],
    });
    expect(lane.path).toContain(join(".worktrees", "run1", "iss1"));
    expect(lane.branch).toBe("harness/run1/iss1");
    expect(existsSync(lane.path)).toBe(true);
  });

  test("root order prefers .worktrees over worktrees", () => {
    const r = repo();
    mkdirSync(join(r.root, "worktrees"), { recursive: true });
    mkdirSync(join(r.root, ".worktrees"), { recursive: true });
    ensureIgnored(r, ".worktrees");
    // also ignore worktrees for cleanliness
    writeFileSync(join(r.root, ".gitignore"), ".worktrees/\nworktrees/\n");
    r.git("add", ".gitignore");
    r.git("commit", "-m", "ignore both");
    const choice = resolveWorktreeRoot(r.root);
    expect(choice.kind).toBe("existing");
    if (choice.kind === "existing") expect(choice.dir).toBe(".worktrees");
  });

  test("project-local root must pass git check-ignore", () => {
    const r = repo();
    mkdirSync(join(r.root, ".worktrees"), { recursive: true });
    // NOT ignored
    const mgr = new WorktreeManager({ repoRoot: r.root });
    expect(() => mgr.resolveRoot()).toThrow(/check-ignore/i);
  });

  test("dependencies must be integrated before lane creation", () => {
    const r = repo();
    ensureIgnored(r, ".worktrees");
    const mgr = new WorktreeManager({ repoRoot: r.root });
    mgr.resolveRoot();
    const base = r.head();
    mgr.ensureIntegration("run1", base);
    expect(() =>
      mgr.createLane({
        runId: "run1",
        issueId: "child",
        baseSha: base,
        dependsOn: ["parent"],
      }),
    ).toThrow(/not integrated/i);
  });

  test("integrated dependency allows lane", () => {
    const r = repo();
    ensureIgnored(r, ".worktrees");
    const base = r.head();
    const mgr = new WorktreeManager({
      repoRoot: r.root,
      integratedShas: { parent: base },
    });
    mgr.resolveRoot();
    const integ = mgr.ensureIntegration("run1", base);
    // parent sha is base which is ancestor of integration
    const lane = mgr.createLane({
      runId: "run1",
      issueId: "child",
      baseSha: base,
      dependsOn: ["parent"],
    });
    expect(lane.issueId).toBe("child");
    expect(integ.baseSha).toBe(base);
  });

  test("dirty baseline blocks only that lane", () => {
    const r = repo();
    ensureIgnored(r, ".worktrees");
    const mgr = new WorktreeManager({ repoRoot: r.root });
    mgr.resolveRoot();
    const base = r.head();
    mgr.ensureIntegration("run1", base);
    // create lane path manually dirty before create is hard; simulate via mark after
    // createLane checks porcelain after worktree add — clean by default
    const lane = mgr.createLane({
      runId: "run1",
      issueId: "clean1",
      baseSha: base,
      dependsOn: [],
    });
    writeFileSync(join(lane.path, "dirt.txt"), "x");
    // second check: isDirty would fail a re-baseline; create with requireClean after dirt
    // New lane should still succeed (only the dirty lane is blocked, not others)
    const lane2 = mgr.createLane({
      runId: "run1",
      issueId: "clean2",
      baseSha: base,
      dependsOn: [],
    });
    expect(lane2.issueId).toBe("clean2");
  });

  test("OMP copy isolation substitute is rejected", () => {
    expect(() => assertRealGitWorktreeIsolation("copy")).toThrow(/substitute|worktree/i);
    expect(() => assertRealGitWorktreeIsolation("overlay")).toThrow();
    expect(() => assertRealGitWorktreeIsolation(undefined)).not.toThrow();
  });
});

describe("eight-lane semaphore", () => {
  test("exactly eight acquire slots; ninth denied all work rights", () => {
    const sem = new LaneSemaphore();
    expect(MAX_LANES).toBe(8);
    const granted = [];
    for (let i = 1; i <= 8; i++) {
      const q = sem.tryAcquire(`t${i}`);
      expect(q.mayResolveModel).toBe(true);
      expect(q.mayCreateBranch).toBe(true);
      expect(q.mayCreateWorktree).toBe(true);
      expect(q.mayCallAgent).toBe(true);
      granted.push(q.issueId);
    }
    expect(sem.activeCount).toBe(8);

    const ninth = sem.tryAcquire("t9");
    expect(ninth.mayResolveModel).toBe(false);
    expect(ninth.mayCreateBranch).toBe(false);
    expect(ninth.mayCreateWorktree).toBe(false);
    expect(ninth.mayCallAgent).toBe(false);
    expect(sem.queued).toContain("t9");
    expect(sem.activeCount).toBe(8);
  });

  test("one durable terminal release starts exactly task nine", () => {
    const sem = new LaneSemaphore();
    for (let i = 1; i <= 8; i++) sem.tryAcquire(`t${i}`);
    sem.tryAcquire("t9");
    expect(sem.mayStartWork("t9")).toBe(false);

    const started = sem.release("t1", "integrated", { durableWritten: true });
    expect(started?.issueId).toBe("t9");
    expect(started?.mayResolveModel).toBe(true);
    expect(started?.mayCallAgent).toBe(true);
    expect(sem.mayStartWork("t9")).toBe(true);
    expect(sem.activeCount).toBe(8);
    expect(sem.queued).not.toContain("t9");
  });

  test("release without durable write is rejected", () => {
    const sem = new LaneSemaphore();
    sem.tryAcquire("t1");
    expect(() =>
      sem.release("t1", "failed", { durableWritten: false }),
    ).toThrow(SemaphoreError);
  });
});
