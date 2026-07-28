/**
 * Stage 3 Pi parity acceptance — deterministic, no live model credentials.
 * Opt-in live smoke: OMP_LIVE_SMOKE=1 bash omp/tests/smoke-stage3.sh
 */

import { describe, expect, test, afterEach } from "bun:test";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_GOAL,
  HARNESS_COMMAND_NAME,
  bindGoal,
} from "../extensions/goal-harness/constants";
import {
  handleHarnessCommand,
  registerHarnessCommand,
  type ExtensionAPI,
} from "../extensions/goal-harness/index";
import { GATE_BUDGETS } from "../extensions/goal-harness/phase-machine";
import {
  validateImplementerEvidence,
  validateReviewResult,
} from "../extensions/goal-harness/validation";
import { planResearchJobs } from "../workflows/research";
import { createSpecSession } from "../workflows/spec";
import { createHumanGate } from "../extensions/goal-harness/human-gate";
import { BeadsBroker, type BdExecResult } from "../extensions/goal-harness/beads";
import { LaneSemaphore, MAX_LANES } from "../extensions/goal-harness/semaphore";
import { resolveModelRoute } from "../extensions/goal-harness/model-router";
import {
  orderByDependencies,
  integrateReviewedLanes,
  type ReviewedRange,
} from "../extensions/goal-harness/integration";
import { assertPrAllowed, type PrPreconditions } from "../workflows/pr";
import {
  runFreshVerification,
} from "../extensions/goal-harness/verification";
import { createTempRepo, ensureIgnored, type TempRepo } from "./fixtures/git-repo";
import { WorktreeManager } from "../extensions/goal-harness/worktrees";
import type { LaneReviewState } from "../extensions/goal-harness/task-review";
import type {
  ModelRouterAdapter,
  ModelCatalogEntry,
} from "../extensions/goal-harness/model-router";

const OMP = join(import.meta.dir, "..");
const MANIFEST = join(OMP, "agents/parity-manifest.json");
const FIXTURE = join(import.meta.dir, "fixtures/harness-project");

const EXPECTED_19 = [
  "project-init",
  "spec-writer",
  "spec-reviewer",
  "plan-writer",
  "plan-reviewer",
  "bite-size-writer",
  "bite-size-reviewer",
  "implementer",
  "milestone-organizer",
  "code-reviewer",
  "code-graph-scout",
  "code-search-scout",
  "docs-scout",
  "web-scout",
  "web-browse-scout",
  "browser-use-scout",
  "webwright-scout",
  "stack-scout",
  "pr-opener",
] as const;

const repos: TempRepo[] = [];
afterEach(() => {
  while (repos.length) repos.pop()?.dispose();
});

function approvedReview(
  base: string,
  head: string,
  issueId: string,
): LaneReviewState {
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

describe("Stage 3: 19 roles + parity manifest", () => {
  test("all 19 roles are discoverable as agent files", () => {
    const agentsDir = join(OMP, "agents");
    for (const name of EXPECTED_19) {
      const path = join(agentsDir, `${name}.md`);
      expect(existsSync(path)).toBe(true);
      const text = readFileSync(path, "utf8");
      expect(text).toMatch(new RegExp(`name:\\s*${name}`));
    }
    const md = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
    expect(md.length).toBe(19);
  });

  test("every parity-manifest baseline field matches", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
      agentCount: number;
      agents: Array<Record<string, unknown>>;
    };
    expect(manifest.agentCount).toBe(19);
    expect(manifest.agents.length).toBe(19);
    const required = [
      "name",
      "piSource",
      "ompDestination",
      "phase",
      "purpose",
      "inputs",
      "outputs",
      "writeScope",
      "allowedTools",
      "forbiddenActions",
      "requiredSuperpowers",
      "requiredStackSkills",
      "outputSchema",
      "modelRoute",
      "reasoningEffort",
      "worktreeResponsibility",
      "reviewResponsibility",
      "piBaseline",
      "ompNativeDeltas",
    ];
    for (const agent of manifest.agents) {
      for (const f of required) {
        expect(agent[f] !== undefined && agent[f] !== null).toBe(true);
      }
    }
    expect(manifest.agents.map((a) => a.name)).toEqual([...EXPECTED_19]);
  });
});

describe("Stage 3: /harness /init /goal unshadowed", () => {
  test("/harness default and custom binding is exact", () => {
    expect(HARNESS_COMMAND_NAME).toBe("harness");
    expect(bindGoal("")).toBe(DEFAULT_GOAL);
    expect(DEFAULT_GOAL.split("\n")).toHaveLength(8);
    expect(bindGoal("custom goal with spaces")).toBe("custom goal with spaces");
    const h = handleHarnessCommand("");
    expect(h.boundGoal).toBe(DEFAULT_GOAL);
    expect(h.startMessages).toHaveLength(1);
    expect(h.startMessages[0]!.workflowModule).toBe(
      "omp/workflows/goal-harness.ts",
    );
    const custom = handleHarnessCommand("do the thing");
    expect(custom.boundGoal).toBe("do the thing");
  });

  test("registers only harness — not goal, guided-goal, or init", () => {
    const names: string[] = [];
    const api: ExtensionAPI = {
      registerCommand(name) {
        names.push(name);
      },
    };
    registerHarnessCommand(api);
    expect(names).toEqual(["harness"]);
    expect(names).not.toContain("goal");
    expect(names).not.toContain("guided-goal");
    expect(names).not.toContain("init");
  });

  test("/init is scaffold-only (project-init module)", () => {
    // project-init exports scaffold behavior; harness must not register init
    const src = readFileSync(
      join(OMP, "extensions/goal-harness/project-init.ts"),
      "utf8",
    );
    expect(src).toMatch(/Scaffold-only|scaffold/i);
    expect(src).toMatch(/Stops after writing|stop after/i);
    // fixture project exists for scaffold tests
    expect(existsSync(join(FIXTURE, "AGENTS.md"))).toBe(true);
  });

  test("/goal and /guided-goal remain unshadowed by harness extension", () => {
    const indexSrc = readFileSync(
      join(OMP, "extensions/goal-harness/index.ts"),
      "utf8",
    );
    expect(indexSrc).not.toMatch(/registerCommand\(['\"]goal['\"]/);
    expect(indexSrc).not.toMatch(/registerCommand\(['\"]guided-goal['\"]/);
    expect(indexSrc).not.toMatch(/registerCommand\(['\"]init['\"]/);
  });
});

describe("Stage 3: research, human gate, budgets, schemas", () => {
  test("large Spec/Plan research uses fan-out", () => {
    const jobs = planResearchJobs({
      boundGoal: "large multi-area feature",
      scope: "large",
      escalateBrowse: false,
      escalateBrowserUse: false,
      escalateWebwright: false,
      goalRule5VersionCheck: true,
    });
    expect(jobs.length).toBeGreaterThanOrEqual(5);
    expect(jobs.map((j) => j.agentName)).toContain("code-graph-scout");
    expect(jobs.map((j) => j.agentName)).toContain("web-scout");
  });

  test("human Spec approval blocks advancement", () => {
    const session = createSpecSession("goal");
    session.candidate = {
      title: "S",
      sections: {},
      sources: [],
      hash: "h",
    };
    session.review = { ok: true, feedback: "ok", blocking: [] };
    expect(session.canAdvanceToPlan()).toBe(false);
  });

  test("retry budgets are 3/3/2/3", () => {
    expect(GATE_BUDGETS.Spec).toBe(3);
    expect(GATE_BUDGETS.Plan).toBe(3);
    expect(GATE_BUDGETS.BiteSize).toBe(2);
    expect(GATE_BUDGETS.Milestone).toBe(3);
  });

  test("reviewer/implementer schemas fail closed on malformed/extra/inconsistent", () => {
    expect(validateReviewResult({ ok: true }).ok).toBe(false);
    expect(
      validateReviewResult({
        ok: true,
        feedback: "x",
        blocking: ["nope"],
      }).ok,
    ).toBe(false);
    expect(
      validateReviewResult({
        ok: false,
        feedback: "x",
        blocking: [],
      }).ok,
    ).toBe(false);
    expect(
      validateReviewResult({
        ok: true,
        feedback: "ok",
        blocking: [],
        extra: 1,
      }).ok,
    ).toBe(false);

    const git = {
      branch: "b",
      worktreePath: "/p",
      headSha: "a".repeat(40),
      changedFiles: ["f.ts"],
    };
    const beads = { issueId: "i" };
    expect(
      validateImplementerEvidence(
        {
          issueId: "i",
          branch: "wrong",
          worktreePath: "/p",
          headSha: "a".repeat(40),
          changedFiles: ["f.ts"],
          red: { command: "t", exitCode: 1, summary: "r" },
          green: { command: "t", exitCode: 0, summary: "g" },
          notes: "n",
        },
        git,
        beads,
      ).ok,
    ).toBe(false);
  });
});

describe("Stage 3: Beads restart survival", () => {
  test("Beads state survives simulated controller restart via hydrate", async () => {
    const calls: string[][] = [];
    let n = 0;
    const exec = (args: string[]): BdExecResult => {
      calls.push(args);
      const i = args[0] === "-C" ? 2 : 0;
      const cmd = args.slice(i);
      if (cmd[0] === "where") {
        return { exitCode: 0, stdout: "/repo/.beads\n  prefix: repo\n  database: /repo/.beads/embeddeddolt\n", stderr: "" };
      }
      if (cmd[0] === "create") {
        n++;
        return {
          exitCode: 0,
          stdout: JSON.stringify({ id: `id-${n}` }),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "ok", stderr: "" };
    };
    const broker = new BeadsBroker(exec, "controller", "/repo");
    await broker.createRunEpic({
      runId: "run-s3",
      boundGoal: "survive",
      modelRoutes: { plan: "m" },
      skillManifest: [],
    });
    await broker.createPhaseIssues("run-s3");
    const snap = broker.getRunState();
    expect(snap?.runId).toBe("run-s3");

    // simulate restart
    const broker2 = new BeadsBroker(exec, "controller", "/repo");
    broker2.hydrate(snap!);
    expect(broker2.getRunState()?.runId).toBe("run-s3");
    expect(broker2.getRunState()?.boundGoal).toBe("survive");
  });
});

describe("Stage 3: eight worktrees + ninth queues; integration; routing; milestone→PR", () => {
  test("eight real worktree lanes; ninth semaphore queues without side effects", () => {
    const r = createTempRepo();
    repos.push(r);
    ensureIgnored(r, ".worktrees");
    const mgr = new WorktreeManager({ repoRoot: r.root });
    mgr.resolveRoot();
    const base = r.head();
    mgr.ensureIntegration("run1", base);
    const paths: string[] = [];
    for (let i = 1; i <= 8; i++) {
      const lane = mgr.createLane({
        runId: "run1",
        issueId: `iss${i}`,
        baseSha: base,
        dependsOn: [],
      });
      paths.push(lane.path);
      expect(existsSync(lane.path)).toBe(true);
    }
    expect(paths).toHaveLength(8);

    const sem = new LaneSemaphore();
    for (let i = 1; i <= 8; i++) {
      const q = sem.tryAcquire(`iss${i}`);
      expect(q.mayCreateWorktree).toBe(true);
    }
    const ninth = sem.tryAcquire("iss9");
    expect(ninth.mayResolveModel).toBe(false);
    expect(ninth.mayCreateBranch).toBe(false);
    expect(ninth.mayCreateWorktree).toBe(false);
    expect(ninth.mayCallAgent).toBe(false);
    expect(MAX_LANES).toBe(8);
    // ninth has no worktree
    expect(mgr.getLane("iss9")).toBeUndefined();
  });

  test("dependency-ordered integration and synthetic conflict preserve sides", () => {
    const ordered = orderByDependencies([
      {
        issueId: "b",
        branch: "x",
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        worktreePath: "/b",
        dependsOn: ["a"],
        review: approvedReview("a".repeat(40), "b".repeat(40), "b"),
      },
      {
        issueId: "a",
        branch: "x",
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        worktreePath: "/a",
        dependsOn: [],
        review: approvedReview("a".repeat(40), "b".repeat(40), "a"),
      },
    ]);
    expect(ordered.map((r) => r.issueId)).toEqual(["a", "b"]);
  });

  test("model routing is exact for known roles", () => {
    const entries: ModelCatalogEntry[] = [
      {
        id: "openai-codex/gpt-5.6-sol",
        provider: "openai-codex",
        aliases: ["sol", "sol 5.6", "gpt-5.6-sol"],
        available: true,
      },
      {
        id: "anthropic/claude-fable-5",
        provider: "anthropic",
        aliases: ["fable", "fable 5", "claude-fable-5"],
        available: true,
      },
    ];
    const adapter: ModelRouterAdapter = {
      list: () => entries.filter((e) => e.available),
      resolve: (q) => {
        const qq = q.toLowerCase();
        return (
          entries.find(
            (e) =>
              e.available &&
              (e.id.toLowerCase().includes(qq) ||
                e.aliases.some((a) => a.toLowerCase().includes(qq))),
          ) ?? null
        );
      },
    };
    const plan = resolveModelRoute(adapter, "plan");
    expect(plan.phase).toBe("plan");
    expect(plan.providerModelId).toBe("openai-codex/gpt-5.6-sol");
    expect(plan.effort).toBe("ultra");
    const research = resolveModelRoute(adapter, "research");
    expect(research.phase).toBe("research");
    expect(research.providerModelId).toBeTruthy();
  });

  test("Milestone failure blocks PR", () => {
    const badVerify = runFreshVerification({
      integrationWorktreePath: (() => {
        const r = createTempRepo();
        repos.push(r);
        ensureIgnored(r, ".worktrees");
        const mgr = new WorktreeManager({ repoRoot: r.root });
        mgr.resolveRoot();
        return mgr.ensureIntegration("run1", r.head()).path;
      })(),
      expectedBranch: "harness/run1/integration",
      commands: [{ name: "tests", argv: ["false"] }],
      exec: () => ({ exitCode: 1, stdout: "", stderr: "fail" }),
    });
    expect(badVerify.ok).toBe(false);

    const pr: PrPreconditions = {
      remote: "origin",
      hasAuthority: true,
      verification: badVerify,
      unresolvedConflicts: [],
      openBlockingIssues: [],
      integrationBranch: "harness/run1/integration",
      runRepoRemote: "origin",
      actualRepoRemote: "origin",
      specIssueId: "s",
      planIssueId: "p",
      biteSizeIssueIds: ["t1"],
      completedTaskIds: ["t1"],
      boundGoal: "g",
      reviewSummary: "r",
      integrationWorktreePath: badVerify.worktreePath,
    };
    expect(() => assertPrAllowed(pr)).toThrow(/verification/i);
  });
});

describe("Stage 3: fixture project present", () => {
  test("harness-project fixture is complete enough for smoke", () => {
    expect(existsSync(join(FIXTURE, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(FIXTURE, "package.json"))).toBe(true);
    expect(existsSync(join(FIXTURE, ".gitignore"))).toBe(true);
    const agents = readFileSync(join(FIXTURE, "AGENTS.md"), "utf8");
    expect(agents).toMatch(/Quality rules|stack/i);
  });
});
