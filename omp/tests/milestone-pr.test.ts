import { describe, expect, test, afterEach } from "bun:test";
import { join } from "node:path";
import { createTempRepo, ensureIgnored, type TempRepo } from "./fixtures/git-repo";
import { WorktreeManager } from "../extensions/goal-harness/worktrees";
import {
  assertFreshReport,
  rejectModelOnlyEvidence,
  runFreshVerification,
  VerificationError,
  type FreshVerificationReport,
} from "../extensions/goal-harness/verification";
import {
  MILESTONE_ANGLES,
  MILESTONE_BUDGET,
  runMilestoneGate,
} from "../workflows/milestone";
import {
  assertPrAllowed,
  buildPrBody,
  createCurrentProjectPr,
  PrPolicyError,
  recordPrOnEpic,
  type PrPreconditions,
} from "../workflows/pr";
import type { Workflowz } from "../extensions/goal-harness/workflow-adapter";

const repos: TempRepo[] = [];
afterEach(() => {
  while (repos.length) repos.pop()?.dispose();
});

function setupInteg() {
  const r = createTempRepo();
  repos.push(r);
  ensureIgnored(r, ".worktrees");
  const mgr = new WorktreeManager({ repoRoot: r.root });
  mgr.resolveRoot();
  const base = r.head();
  const integ = mgr.ensureIntegration("run1", base);
  return { r, integ };
}

function okVerify(over?: Partial<FreshVerificationReport>): FreshVerificationReport {
  return {
    ok: true,
    branch: "harness/run1/integration",
    worktreePath: "/wt",
    ranAt: new Date().toISOString(),
    results: [
      {
        name: "tests",
        argv: ["true"],
        cwd: "/wt",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        exitCode: 0,
        summary: "ok",
      },
    ],
    processEvidence: true,
    blocking: [],
    ...over,
  };
}

function basePr(over?: Partial<PrPreconditions>): PrPreconditions {
  return {
    remote: "origin",
    hasAuthority: true,
    verification: okVerify(),
    unresolvedConflicts: [],
    openBlockingIssues: [],
    integrationBranch: "harness/run1/integration",
    runRepoRemote: "origin",
    actualRepoRemote: "origin",
    specIssueId: "spec-1",
    planIssueId: "plan-1",
    biteSizeIssueIds: ["t1", "t2"],
    completedTaskIds: ["t1", "t2"],
    boundGoal: "ship feature",
    reviewSummary: "all angles pass",
    integrationWorktreePath: "/wt",
    ...over,
  };
}

describe("fresh verification", () => {
  test("runs injected tests/lint/typecheck/build/stack on integration branch", () => {
    const { integ } = setupInteg();
    const seen: string[] = [];
    const report = runFreshVerification({
      integrationWorktreePath: integ.path,
      expectedBranch: integ.branch,
      commands: [
        { name: "tests", argv: ["true"] },
        { name: "lint", argv: ["true"] },
        { name: "typecheck", argv: ["true"] },
        { name: "build", argv: ["true"] },
        { name: "stack", argv: ["true"] },
      ],
      exec: (argv, cwd) => {
        seen.push(argv.join(" "));
        expect(cwd).toBe(integ.path);
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    });
    expect(report.ok).toBe(true);
    expect(report.processEvidence).toBe(true);
    expect(report.results).toHaveLength(5);
    expect(seen).toEqual(["true", "true", "true", "true", "true"]);
    expect(report.results[0]!.startedAt).toBeTruthy();
    expect(report.results[0]!.endedAt).toBeTruthy();
  });

  test("rejects non-zero command exit", () => {
    const { integ } = setupInteg();
    const report = runFreshVerification({
      integrationWorktreePath: integ.path,
      expectedBranch: integ.branch,
      commands: [{ name: "tests", argv: ["false"] }],
      exec: () => ({ exitCode: 1, stdout: "", stderr: "fail" }),
    });
    expect(report.ok).toBe(false);
    expect(report.blocking[0]).toMatch(/tests exit 1/);
  });

  test("rejects wrong-branch", () => {
    const { integ } = setupInteg();
    const report = runFreshVerification({
      integrationWorktreePath: integ.path,
      expectedBranch: "harness/other/integration",
      commands: [{ name: "tests", argv: ["true"] }],
      exec: () => ({ exitCode: 0, stdout: "", stderr: "" }),
    });
    expect(report.ok).toBe(false);
    expect(report.blocking.some((b) => /wrong-branch/i.test(b))).toBe(true);
    expect(report.results).toHaveLength(0);
  });

  test("rejects model-reported success without process evidence", () => {
    expect(() =>
      rejectModelOnlyEvidence({ ok: true, message: "all good" }),
    ).toThrow(VerificationError);
  });

  test("rejects stale verification reports", () => {
    const old = okVerify({
      ranAt: new Date(Date.now() - 10_000).toISOString(),
    });
    expect(() => assertFreshReport(old, 1000, Date.now())).toThrow(/stale/i);
  });
});

describe("Milestone", () => {
  function wzAllOk(): Workflowz {
    return {
      phase() {},
      async agent() {
        return { ok: true, feedback: "ok", blocking: [] };
      },
      async parallel(jobs) {
        return Promise.all(jobs.map((j) => j()));
      },
      async pipeline(items, ...stages) {
        let cur = items;
        for (const st of stages) cur = await Promise.all(cur.map((i) => st(i)));
        return cur;
      },
    };
  }

  test("runs all parallel review angles", async () => {
    const { integ } = setupInteg();
    const agents: string[] = [];
    const wz: Workflowz = {
      phase() {},
      async agent(_p, options) {
        agents.push(options.agentName);
        expect(options.schemaMode).toBe("strict");
        return { ok: true, feedback: "ok", blocking: [] };
      },
      async parallel(jobs) {
        return Promise.all(jobs.map((j) => j()));
      },
      async pipeline(items, ...stages) {
        let cur = items;
        for (const st of stages) cur = await Promise.all(cur.map((i) => st(i)));
        return cur;
      },
    };
    const result = await runMilestoneGate(wz, {
      model: "m",
      context: "integration ready",
      verification: {
        integrationWorktreePath: integ.path,
        expectedBranch: integ.branch,
        commands: [{ name: "tests", argv: ["true"] }],
        exec: () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
      },
    });
    expect(result.ok).toBe(true);
    expect(result.angles).toHaveLength(MILESTONE_ANGLES.length);
    for (const angle of MILESTONE_ANGLES) {
      expect(result.angles.some((a) => a.angle === angle)).toBe(true);
    }
    expect(result.verification?.ok).toBe(true);
    expect(agents.length).toBe(MILESTONE_ANGLES.length);
  });

  test("model consensus alone does not pass without fresh verification", async () => {
    const { integ } = setupInteg();
    const result = await runMilestoneGate(wzAllOk(), {
      model: "m",
      context: "x",
      maxAttempts: 1,
      verification: {
        integrationWorktreePath: integ.path,
        expectedBranch: integ.branch,
        commands: [{ name: "tests", argv: ["false"] }],
        exec: () => ({ exitCode: 1, stdout: "", stderr: "boom" }),
      },
    });
    expect(result.ok).toBe(false);
    expect(result.angles.every((a) => a.ok)).toBe(true);
    expect(result.verification?.ok).toBe(false);
    expect(result.blocking.some((b) => /verify/i.test(b))).toBe(true);
  });

  test("budget is exactly three", () => {
    expect(MILESTONE_BUDGET).toBe(3);
  });

  test("angle failure blocks even when verification passes", async () => {
    const { integ } = setupInteg();
    let n = 0;
    const wz: Workflowz = {
      phase() {},
      async agent() {
        n++;
        // fail first angle only
        if (n === 1) {
          return { ok: false, feedback: "bad", blocking: ["correctness issue"] };
        }
        return { ok: true, feedback: "ok", blocking: [] };
      },
      async parallel(jobs) {
        return Promise.all(jobs.map((j) => j()));
      },
      async pipeline(items, ...stages) {
        let cur = items;
        for (const st of stages) cur = await Promise.all(cur.map((i) => st(i)));
        return cur;
      },
    };
    const result = await runMilestoneGate(wz, {
      model: "m",
      context: "x",
      maxAttempts: 1,
      verification: {
        integrationWorktreePath: integ.path,
        expectedBranch: integ.branch,
        commands: [{ name: "tests", argv: ["true"] }],
        exec: () => ({ exitCode: 0, stdout: "", stderr: "" }),
      },
    });
    expect(result.ok).toBe(false);
  });
});

describe("current-project PR", () => {
  test("blocks on missing remote", () => {
    expect(() => assertPrAllowed(basePr({ remote: null }))).toThrow(
      /missing remote/i,
    );
  });

  test("blocks on missing authority", () => {
    expect(() => assertPrAllowed(basePr({ hasAuthority: false }))).toThrow(
      /authority/i,
    );
  });

  test("blocks on failed/stale verification", () => {
    expect(() =>
      assertPrAllowed(
        basePr({
          verification: okVerify({ ok: false, blocking: ["fail"] }),
        }),
      ),
    ).toThrow(/verification/i);
    expect(() =>
      assertPrAllowed(
        basePr({
          verification: okVerify({
            ranAt: new Date(Date.now() - 999_999).toISOString(),
          }),
          verificationMaxAgeMs: 100,
        }),
      ),
    ).toThrow(/stale|verification/i);
  });

  test("blocks on unresolved conflict", () => {
    expect(() =>
      assertPrAllowed(basePr({ unresolvedConflicts: ["file.ts"] })),
    ).toThrow(/conflict/i);
  });

  test("blocks on open blocking issue", () => {
    expect(() =>
      assertPrAllowed(basePr({ openBlockingIssues: ["bug-1"] })),
    ).toThrow(/blocking issue/i);
  });

  test("blocks on protected-branch mutation", () => {
    expect(() =>
      assertPrAllowed(basePr({ integrationBranch: "main" })),
    ).toThrow(/protected/i);
  });

  test("blocks on missing Spec/Plan/BiteSize IDs", () => {
    expect(() =>
      assertPrAllowed(basePr({ specIssueId: null })),
    ).toThrow(/Spec\/Plan/i);
    expect(() =>
      assertPrAllowed(basePr({ biteSizeIssueIds: [] })),
    ).toThrow(/BiteSize/i);
  });

  test("blocks when repository/remote does not match harness run", () => {
    expect(() =>
      assertPrAllowed(
        basePr({ runRepoRemote: "origin", actualRepoRemote: "fork" }),
      ),
    ).toThrow(/does not match/i);
  });

  test("success: exactly one PR with required body fields; no partner lookup", () => {
    const p = basePr();
    const body = buildPrBody(p);
    expect(body).toContain(p.boundGoal);
    expect(body).toContain("spec-1");
    expect(body).toContain("plan-1");
    expect(body).toContain("t1");
    expect(body).toContain("Fresh verification");
    expect(body).not.toMatch(/partner|dotfiles|nixup/i);

    const calls: string[][] = [];
    const result = createCurrentProjectPr(p, {
      fakeUrl: "https://github.com/org/repo/pull/1",
      exec: (argv) => {
        calls.push(argv);
        return { exitCode: 0, stdout: "https://github.com/org/repo/pull/1\n", stderr: "" };
      },
    });
    expect(result.url).toMatch(/pull\/1/);
    expect(result.body).toContain(p.boundGoal);
    // no partner discovery commands
    expect(calls.every((c) => !c.join(" ").includes("partner"))).toBe(true);

    let stored = "";
    recordPrOnEpic((url) => {
      stored = url;
    }, result.url);
    expect(stored).toBe(result.url);
  });
});
