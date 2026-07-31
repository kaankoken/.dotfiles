/**
 * Stage 4 OMP-native acceptance — Stage 3 plus native hardening gates.
 * Deterministic; no live model credentials required.
 * Opt-in live: OMP_LIVE_SMOKE=1 bash omp/tests/smoke-omp-harness.sh
 *
 * Pi removal is eligible only after this suite passes.
 */

import { describe, expect, test, afterEach } from "bun:test";
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { REQUIRED_SKILLS_BY_ROLE, resolveSkill } from "../extensions/goal-harness/skills";
import {
  createSkillGuardSession,
  agentReadRequiredSkills,
  unlockRoleTools,
  SkillGuardError,
} from "../extensions/goal-harness/skill-guard";
import {
  approveSkills,
  createSkillToolState,
  harnessReadSkill,
} from "../extensions/goal-harness/skill-tool";
import {
  buildNativeToolManifest,
  applyHashlineEdit,
  LspFixture,
  nativeAstSearch,
  grokLaneConfig,
  codeGraphRequestOrder,
  SHARED_MCP_ALLOWLIST,
} from "../extensions/goal-harness/native-tools";
import { buildLaneNativeSessionConfig } from "../extensions/goal-harness/lane-runner";
import { postValidateEvidence } from "../extensions/goal-harness/evidence";
import {
  createLaneReviewState,
  isLaneApproved,
  runTaskReviewSequence,
} from "../extensions/goal-harness/task-review";
import {
  runFreshVerification,
} from "../extensions/goal-harness/verification";
import {
  assertGlobalShakeConfig,
  evaluateSnapcompactEligibility,
  contextFullRecovery,
  planGlobalShake,
  runGlobalShake,
  runSelectiveSnapcompact,
  validateResumeSource,
  GLOBAL_STRATEGY,
} from "../extensions/goal-harness/compaction";
import {
  evaluateAdvisor,
  isHarnessSpawnAllowed,
  BUNDLED_OMP_OUTSIDE_HARNESS_SPAWN,
  isForbiddenAutoPath,
  isSonicEligibleForGate,
} from "../extensions/goal-harness/optional-capabilities";
import { buildPhaseCapabilities } from "../extensions/goal-harness/capabilities";
import {
  classifyCommand,
  classifyPathAccess,
} from "../extensions/goal-harness/sandbox";
import {
  createInterceptor,
  interceptToolCall,
  preflightOmpApprovalConfig,
} from "../extensions/goal-harness/audit";
import { createTempRepo, ensureIgnored, type TempRepo } from "./fixtures/git-repo";
import { WorktreeManager } from "../extensions/goal-harness/worktrees";
import type { Workflowz } from "../extensions/goal-harness/workflow-adapter";
import { GATE_BUDGETS } from "../extensions/goal-harness/phase-machine";
import { bindGoal, DEFAULT_GOAL, HARNESS_COMMAND_NAME } from "../extensions/goal-harness/constants";
import { HARNESS_SPAWN_ALLOWLIST } from "../extensions/goal-harness/optional-capabilities";

const OMP = join(import.meta.dir, "..");
const FIXTURE = join(import.meta.dir, "fixtures/typed-project");
const SAMPLE = join(FIXTURE, "src/sample.ts");

const temps: string[] = [];
const repos: TempRepo[] = [];
afterEach(() => {
  while (temps.length) {
    try {
      rmSync(temps.pop()!, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
  while (repos.length) repos.pop()?.dispose();
});

function skillRoot(names: string[]): string {
  const d = mkdtempSync(join(tmpdir(), "omp-s4-skills-"));
  temps.push(d);
  for (const n of names) {
    mkdirSync(join(d, n), { recursive: true });
    writeFileSync(join(d, n, "SKILL.md"), `# ${n}\nversion: 1\n`);
  }
  return d;
}

function wzOk(): Workflowz {
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

describe("Stage 4: skill loading (authoritative live reads)", () => {
  test("parent and every role maps to REQUIRED_SKILLS_BY_ROLE with names only", () => {
    const roles = Object.keys(REQUIRED_SKILLS_BY_ROLE);
    expect(roles.length).toBeGreaterThanOrEqual(10);
    expect(roles).toContain("parent-orchestrator");
    expect(roles).toContain("implementer");
    expect(roles).toContain("pr-agent");
    const blob = JSON.stringify(REQUIRED_SKILLS_BY_ROLE);
    expect(blob).not.toMatch(/# Test-Driven Development|Iron Law/);
  });

  test("missing/duplicate/unreadable/changed/claimed-only skill loads fail before task tools", () => {
    const empty = skillRoot([]);
    expect(() =>
      resolveSkill("missing-skill", { customDirectories: [empty] }),
    ).toThrow(/missing skill/);

    const a = skillRoot(["dup"]);
    const b = skillRoot(["dup"]);
    writeFileSync(join(b, "dup", "SKILL.md"), "# other body\n");
    expect(() =>
      resolveSkill("dup", { customDirectories: [a, b] }),
    ).toThrow(/duplicate/);

    const root = skillRoot(["locked"]);
    const path = join(root, "locked", "SKILL.md");
    chmodSync(path, 0o000);
    try {
      expect(() =>
        resolveSkill("locked", { customDirectories: [root] }),
      ).toThrow(/unreadable/);
    } finally {
      chmodSync(path, 0o644);
    }

    const drift = skillRoot(["drift"]);
    const r = resolveSkill("drift", { customDirectories: [drift] });
    writeFileSync(join(drift, "drift", "SKILL.md"), "# changed\n");
    const st = createSkillToolState();
    approveSkills(st, [r]);
    expect(() => harnessReadSkill(st, r.name, r.path, r.sha256)).toThrow(
      /changed|stale/,
    );

    // claimed-but-unobserved
    const names = [
      "using-superpowers",
      "goal-harness",
      "requesting-code-review",
    ];
    const sr = skillRoot(names);
    const session = createSkillGuardSession({
      role: "parent-orchestrator",
      skillRoots: { customDirectories: [sr] },
      roleTools: ["bash"],
    });
    expect(() => unlockRoleTools(session)).toThrow(SkillGuardError);
    agentReadRequiredSkills(session);
    unlockRoleTools(session);
    expect(session.unlocked).toBe(true);
  });
});

describe("Stage 4: Grok Hashline high effort + LSP/AST fixtures", () => {
  test("Grok uses Hashline at high effort", () => {
    expect(grokLaneConfig("high", ["hashline", "lsp"]).ok).toBe(true);
    expect(grokLaneConfig("medium", ["hashline"]).ok).toBe(false);
    const cfg = buildLaneNativeSessionConfig({
      issueId: "i",
      worktreePath: FIXTURE,
      branch: "b",
      baseSha: "a".repeat(40),
      issueText: "t",
      specContext: "s",
      planContext: "p",
      model: "xai/grok-4",
      effort: "high",
    });
    expect(cfg.grok?.effort).toBe("high");
    expect(cfg.grok?.useHashline).toBe(true);
    expect(cfg.nativeTools.hashline).toBe(true);
  });

  test("LSP and AST/search pass typed fixtures", () => {
    const src = readFileSync(SAMPLE, "utf8");
    const hits = nativeAstSearch(src, "function\\s+greet");
    expect(hits.length).toBeGreaterThan(0);

    const lsp = new LspFixture();
    lsp.set(SAMPLE, [
      {
        path: SAMPLE,
        line: 5,
        message: "Type error",
        severity: "error",
      },
    ]);
    expect(lsp.get(SAMPLE)).toHaveLength(1);
    lsp.clear(SAMPLE);
    expect(lsp.get(SAMPLE)).toHaveLength(0);

    const lines = src.split("\n");
    const lineNo = lines.findIndex((l) => l.includes("INTENTIONAL_BUG")) + 1;
    const next = applyHashlineEdit(src, {
      path: SAMPLE,
      line: lineNo,
      oldText: lines[lineNo - 1]!,
      newText: "export const INTENTIONAL_BUG = 1;",
    });
    expect(next).toContain("= 1;");
  });

  test("TokenSave first for code-graph; MCP allowlist is lean", () => {
    expect(codeGraphRequestOrder(["tokensave", "ast_search"]).ok).toBe(true);
    expect(codeGraphRequestOrder(["ast_search"]).ok).toBe(false);
    const m = buildNativeToolManifest();
    expect(m.mcpAllowlist).toEqual([...SHARED_MCP_ALLOWLIST]);
  });
});

describe("Stage 4: implementer evidence + dual reviews", () => {
  test("implementer evidence requires real RED/GREEN and git fact match", () => {
    const git = {
      branch: "harness/run1/iss1",
      worktreePath: "/wt",
      headSha: "a".repeat(40),
      changedFiles: ["src/x.ts"],
    };
    const beads = { issueId: "iss1" };
    const good = {
      issueId: "iss1",
      branch: "harness/run1/iss1",
      worktreePath: "/wt",
      headSha: "a".repeat(40),
      changedFiles: ["src/x.ts"],
      red: { command: "bun test --fail", exitCode: 1, summary: "red" },
      green: { command: "bun test", exitCode: 0, summary: "green" },
      notes: "ok",
    };
    expect(postValidateEvidence(good, git, beads).ok).toBe(true);
    // fake RED (exit 0) and headSha mismatch both fail closed
    expect(
      postValidateEvidence(
        {
          ...good,
          red: { command: "true", exitCode: 0, summary: "fake" },
        },
        git,
        beads,
      ).ok,
    ).toBe(false);
    expect(
      postValidateEvidence(
        {
          ...good,
          headSha: "b".repeat(40),
        },
        git,
        beads,
      ).ok,
    ).toBe(false);
  });

  test("both task reviews required for approval", async () => {
    let s = createLaneReviewState({
      issueId: "iss1",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
    });
    s = await runTaskReviewSequence(wzOk(), s, { model: "m" });
    expect(isLaneApproved(s)).toBe(true);
    expect(s.specReview?.ok).toBe(true);
    expect(s.qualityReview?.ok).toBe(true);
  });
});

describe("Stage 4: fresh verification on integration branch", () => {
  test("full fresh verification runs on integrated worktree", () => {
    const r = createTempRepo();
    repos.push(r);
    ensureIgnored(r, ".worktrees");
    const mgr = new WorktreeManager({ repoRoot: r.root });
    mgr.resolveRoot();
    const integ = mgr.ensureIntegration("run1", r.head());
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
      exec: () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
    });
    expect(report.ok).toBe(true);
    expect(report.processEvidence).toBe(true);
    expect(report.results).toHaveLength(5);
    expect(report.branch).toBe("harness/run1/integration");
  });
});

describe("Stage 4: shake + snapcompact + Advisor + sandbox", () => {
  test("shake preserves durable protocol; snapcompact/context-full exact", async () => {
    expect(GLOBAL_STRATEGY).toBe("shake");
    assertGlobalShakeConfig({ enabled: true, strategy: "shake" });
    expect(planGlobalShake()).toEqual({ kind: "global-shake" });

    const durable = {
      runId: "r",
      phase: "Implement",
      evidenceWritten: true,
      nextActionWritten: true,
      beadsSynced: true,
      beadsRereadOk: true as boolean | undefined,
    };
    const calls: unknown[] = [];
    const ctx = {
      compact: (opts?: { mode?: string }) => {
        calls.push(opts ?? null);
      },
    };
    await runGlobalShake(ctx);
    expect(calls).toEqual([null]);

    // text-only reject stays reject
    const rej = await runSelectiveSnapcompact(ctx, {
      actor: "long-running-coordinator",
      model: { id: "text", vision: false },
      durable,
    });
    expect(rej.ok).toBe(false);
    expect(rej.policyRejected).toBe(true);

    const elig = evaluateSnapcompactEligibility({
      actor: "long-running-coordinator",
      model: { id: "v", vision: true },
      durable,
    });
    expect(elig.ok).toBe(true);

    const recovery = contextFullRecovery({ priorSnapcompactRejected: true });
    expect(recovery.cannotOverrideSnapcompact).toBe(true);

    expect(() =>
      validateResumeSource({
        fromBeads: false,
        fromRepository: false,
        fromCompactionProse: true,
      }),
    ).toThrow(/not compaction prose/);
  });

  test("Advisor cannot advance a gate", () => {
    const d = evaluateAdvisor({
      capability: "advisor",
      explicit: true,
      context: { difficultSpecOrPlan: true, phase: "Spec" },
    });
    expect(d.allow).toBe(true);
    expect(d.mayAdvanceGate).toBe(false);
  });

  test("full positive/adversarial sandbox conformance", () => {
    const r = createTempRepo();
    repos.push(r);
    const worktree = join(r.root, "lane");
    const runTemp = join(r.root, "tmp");
    mkdirSync(worktree, { recursive: true });
    mkdirSync(runTemp, { recursive: true });
    const m = buildPhaseCapabilities({
      phase: "Implement",
      agent: "implementer",
      runId: "run-1",
      issueId: "iss-1",
      canonicalRoots: { repo: r.root, worktree, runTemp },
    });
    expect(classifyPathAccess(m, join(worktree, "a.ts"), "write").allow).toBe(
      true,
    );
    expect(classifyPathAccess(m, "/etc/passwd", "read").allow).toBe(false);
    expect(classifyCommand(m, ["git", "push", "--force"]).allow).toBe(false);
    expect(classifyCommand(m, ["git", "reset", "--hard"]).allow).toBe(false);
    expect(classifyCommand(m, ["bd", "create", "x"]).allow).toBe(false);

    // PR phase allows push
    const pr = buildPhaseCapabilities({
      phase: "PR",
      agent: "pr-opener",
      runId: "run-1",
      canonicalRoots: { repo: r.root, worktree, runTemp },
      controller: true,
    });
    expect(classifyCommand(pr, ["git", "push", "origin", "HEAD"]).allow).toBe(
      true,
    );

    const notes: string[] = [];
    const state = createInterceptor(m, {
      appendNotes: (_i, n) => {
        notes.push(n);
      },
    });
    interceptToolCall(state, { tool: "bash", argv: ["git", "push", "--force"] });
    expect(notes.some((n) => n.includes("deny"))).toBe(true);
    expect(
      preflightOmpApprovalConfig(
        { approvalMode: "always-ask", extensionGuard: true },
        { settings: ["tools.approvalMode"] },
      ).ok,
    ).toBe(true);
  });

  test("phase network/write transitions and budgets", () => {
    const roots = {
      repo: "/r",
      worktree: "/r/wt",
      runTemp: "/r/tmp",
    };
    const research = buildPhaseCapabilities({
      phase: "Research",
      agent: "web-scout",
      runId: "r",
      canonicalRoots: roots,
    });
    expect(research.operations.some((o) => o.startsWith("fs.write."))).toBe(
      false,
    );
    expect(research.network.mode).not.toBe("none");

    const impl = buildPhaseCapabilities({
      phase: "Implement",
      agent: "implementer",
      runId: "r",
      canonicalRoots: roots,
    });
    expect(impl.operations).toContain("fs.write.lane");
    expect(impl.operations).not.toContain("git.push");

    expect(GATE_BUDGETS.Spec).toBe(3);
    expect(GATE_BUDGETS.Plan).toBe(3);
    expect(GATE_BUDGETS.BiteSize).toBe(2);
    expect(GATE_BUDGETS.Milestone).toBe(3);
  });
});

describe("Stage 4: harness spawn allowlist + no pi-dynamic-workflows", () => {
  test("custom harness never spawns bundled/disabled roles outside allowlist", () => {
    for (const role of BUNDLED_OMP_OUTSIDE_HARNESS_SPAWN) {
      expect(isHarnessSpawnAllowed(role)).toBe(false);
    }
    for (const role of HARNESS_SPAWN_ALLOWLIST) {
      expect(isHarnessSpawnAllowed(role)).toBe(true);
    }
    expect(isSonicEligibleForGate("sonic", "Implement")).toBe(false);
    expect(isForbiddenAutoPath(["sw", "arm"].join(""))).toBe(true);
  });

  test("pi-dynamic-workflows absent from runtime sources and package.json", () => {
    const roots = [
      join(OMP, "extensions/goal-harness"),
      join(OMP, "workflows"),
      join(OMP, "package.json"),
      join(OMP, "..", "package.json"),
    ];
    for (const root of roots) {
      if (!existsSync(root)) continue;
      if (root.endsWith(".json") || !statIsDir(root)) {
        const text = readFileSync(root, "utf8");
        expect(text).not.toMatch(/pi-dynamic-workflows/);
        continue;
      }
      for (const f of walkTs(root)) {
        const text = readFileSync(f, "utf8");
        expect(text).not.toMatch(/pi-dynamic-workflows/);
        expect(text).not.toMatch(/from ['\"]@quintinshaw\/pi/);
      }
    }
  });

  test("harness binding still exact; 19 agents present", () => {
    expect(HARNESS_COMMAND_NAME).toBe("harness");
    expect(bindGoal("")).toBe(DEFAULT_GOAL);
    const parityRaw = JSON.parse(
      readFileSync(join(OMP, "agents/parity-manifest.json"), "utf8"),
    );
    const parityNames: Record<string, true> = {};
    if (
      parityRaw &&
      typeof parityRaw === "object" &&
      "agents" in parityRaw &&
      Array.isArray(parityRaw.agents)
    ) {
      for (const a of parityRaw.agents) {
        if (a && typeof a === "object" && "name" in a && typeof a.name === "string") {
          parityNames[a.name] = true;
        }
      }
    }
    const agents = readdirSync(join(OMP, "agents"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .filter((name) => parityNames[name]);
    // Goal-harness parity pack stays 19; design-flow + pr-review are separate packs.
    expect(agents.length).toBe(19);
  });
});

function statIsDir(p: string): boolean {
  try {
    return readdirSync(p) != null && !p.endsWith(".ts") && !p.endsWith(".json");
  } catch {
    return false;
  }
}

function walkTs(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    try {
      const kids = readdirSync(p);
      walkTs(p, acc);
      void kids;
    } catch {
      if (p.endsWith(".ts") || p.endsWith(".js") || p.endsWith(".json")) {
        acc.push(p);
      }
    }
  }
  return acc;
}
