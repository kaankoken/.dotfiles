import { describe, expect, test, afterEach } from "bun:test";
import { join } from "node:path";
import { writeFileSync, realpathSync } from "node:fs";
import { createTempRepo, ensureIgnored, type TempRepo } from "./fixtures/git-repo";
import {
  ActiveExtensionApi,
  LaneRunnerError,
  assertNoForbiddenChildCaps,
  buildLanePrompt,
  createLaneSession,
  loadImplementerRolePrompt,
  runAssignedLane,
  type LaneAssignment,
  type SessionCreateOpts,
} from "../extensions/goal-harness/lane-runner";
import {
  IMPLEMENTER_EVIDENCE_SCHEMA,
  assertBaseShaBeforeEdit,
  assertCleanBaseline,
  collectCommandEvidence,
  postValidateEvidence,
  queryGitFacts,
  type ImplementerEvidenceEnvelope,
} from "../extensions/goal-harness/evidence";
import { WorktreeManager } from "../extensions/goal-harness/worktrees";
import {
  handleHarnessCommand,
  type ExtensionAPI,
} from "../extensions/goal-harness/index";

const repos: TempRepo[] = [];
afterEach(() => {
  while (repos.length) repos.pop()?.dispose();
});

function repo(): TempRepo {
  const r = createTempRepo();
  repos.push(r);
  return r;
}

function fakeApi(capture: { opts?: SessionCreateOpts }): ActiveExtensionApi {
  return {
    pi: {
      SessionManager: {
        inMemory() {
          return { kind: "in-memory" };
        },
      },
      async createAgentSession(opts) {
        capture.opts = opts;
        // Official SDK: CreateAgentSessionResult, not bare session
        return {
          session: {
            async prompt() {
              return {};
            },
            async getOutput() {
              return null;
            },
            async dispose() {},
          },
        };
      },
    },
  };
}

function makeAssignment(
  r: TempRepo,
  overrides?: Partial<LaneAssignment>,
): LaneAssignment {
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
  return {
    issueId: "iss1",
    worktreePath: lane.path,
    branch: lane.branch,
    baseSha: base,
    issueText: "Implement feature X",
    specContext: "Spec slice",
    planContext: "Plan step 1",
    model: "openai-codex/gpt-5.6-sol",
    effort: "high",
    ...overrides,
  };
}

describe("SDK session", () => {
  test("creates ephemeral session with exact SDK options", async () => {
    const r = repo();
    const assignment = makeAssignment(r);
    const capture: { opts?: SessionCreateOpts } = {};
    const api = fakeApi(capture);
    const { sessionOpts, rolePrompt } = await createLaneSession(api, assignment);

    expect(sessionOpts.cwd).toBe(assignment.worktreePath);
    expect(sessionOpts.model).toBe(assignment.model);
    expect(sessionOpts.thinkingLevel).toBe(assignment.effort);
    expect(sessionOpts.sessionManager).toEqual({ kind: "in-memory" });
    expect(sessionOpts.outputSchema).toBe(IMPLEMENTER_EVIDENCE_SCHEMA);
    expect(sessionOpts.outputSchemaMode).toBe("strict");
    expect(sessionOpts.requireYieldTool).toBe(true);
    expect(sessionOpts.enableLsp).toBe(true);
    // settings must be omitted or a real Settings instance — never a plain object
    expect(sessionOpts.settings).toBeUndefined();
    expect(rolePrompt).toMatch(/implementer/i);
    expect(rolePrompt).toMatch(/Cannot.*worktree|assigned worktree/i);
    expect(capture.opts?.cwd).toBe(assignment.worktreePath);
  });

  test("role prompt loaded from omp/agents/implementer.md", () => {
    const role = loadImplementerRolePrompt(
      join(import.meta.dir, "../agents"),
    );
    expect(role).toContain("implementer");
    expect(role).toMatch(/TDD|RED/i);
  });

  test("only assigned issue/spec/plan context in prompt", () => {
    const role = "# role";
    const prompt = buildLanePrompt(role, {
      issueId: "only-this",
      worktreePath: "/wt",
      branch: "b",
      baseSha: "abc",
      issueText: "TASK_BODY",
      specContext: "SPEC_SLICE",
      planContext: "PLAN_SLICE",
      model: "m",
      effort: "e",
    });
    expect(prompt).toContain("only-this");
    expect(prompt).toContain("TASK_BODY");
    expect(prompt).toContain("SPEC_SLICE");
    expect(prompt).toContain("PLAN_SLICE");
    expect(prompt).not.toContain("other-issue-secret");
  });

  test("child cannot receive bd write / worktree / reviewer", () => {
    expect(() =>
      assertNoForbiddenChildCaps({ beadsWrite: {} }),
    ).toThrow(/Beads write/i);
    expect(() =>
      assertNoForbiddenChildCaps({ worktreeController: {} }),
    ).toThrow(/worktree/i);
    expect(() =>
      assertNoForbiddenChildCaps({ reviewerSpawn: {} }),
    ).toThrow(/reviewer/i);
    expect(() => assertNoForbiddenChildCaps({})).not.toThrow();
  });

  test("SDK cwd pins lane, not OMP copy isolation", async () => {
    const r = repo();
    const assignment = makeAssignment(r);
    const capture: { opts?: SessionCreateOpts } = {};
    await createLaneSession(fakeApi(capture), assignment, {
      isolationMode: undefined,
    });
    expect(capture.opts?.cwd).toBe(assignment.worktreePath);
    await expect(
      createLaneSession(fakeApi({}), assignment, { isolationMode: "copy" }),
    ).rejects.toThrow(/substitute|worktree/i);
  });
});

describe("evidence", () => {
  test("requires BASE_SHA and clean baseline before edit", () => {
    const r = repo();
    const assignment = makeAssignment(r);
    assertCleanBaseline(assignment.worktreePath);
    assertBaseShaBeforeEdit(assignment.baseSha, assignment.baseSha);
    expect(() => assertBaseShaBeforeEdit(undefined, "abc")).toThrow(/BASE_SHA/i);
    writeFileSync(join(assignment.worktreePath, "dirt.txt"), "x");
    expect(() => assertCleanBaseline(assignment.worktreePath)).toThrow(/dirty/i);
  });

  test("collects command evidence envelope fields", () => {
    const red = collectCommandEvidence("bun test --fail", 1, "failed as expected");
    const green = collectCommandEvidence("bun test", 0, "all pass");
    expect(red.exitCode).toBe(1);
    expect(green.exitCode).toBe(0);
  });

  test("post-validation rejects mismatched branch/path/SHA/files", () => {
    const git = {
      branch: "harness/run1/iss1",
      worktreePath: "/real/path",
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      changedFiles: ["src/a.ts"],
    };
    const beads = { issueId: "iss1" };
    const good: ImplementerEvidenceEnvelope = {
      issueId: "iss1",
      branch: "harness/run1/iss1",
      worktreePath: "/real/path",
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      changedFiles: ["src/a.ts"],
      red: { command: "t", exitCode: 1, summary: "fail" },
      green: { command: "t", exitCode: 0, summary: "pass" },
      notes: "ok",
    };
    expect(postValidateEvidence(good, git, beads).ok).toBe(true);

    expect(
      postValidateEvidence({ ...good, branch: "wrong" }, git, beads).ok,
    ).toBe(false);
    expect(
      postValidateEvidence({ ...good, worktreePath: "/other" }, git, beads).ok,
    ).toBe(false);
    expect(
      postValidateEvidence(
        { ...good, headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
        git,
        beads,
      ).ok,
    ).toBe(false);
    expect(
      postValidateEvidence(
        { ...good, changedFiles: ["other.ts"] },
        git,
        beads,
      ).ok,
    ).toBe(false);
    expect(
      postValidateEvidence(
        { ...good, red: { command: "t", exitCode: 0, summary: "fake" } },
        git,
        beads,
      ).ok,
    ).toBe(false);
  });

  test("never treats model success alone as authoritative", () => {
    // Even a well-formed envelope fails if git facts disagree
    const git = {
      branch: "b",
      worktreePath: "/p",
      headSha: "cccccccccccccccccccccccccccccccccccccccc",
      changedFiles: ["x.ts"],
    };
    const reported = {
      issueId: "i",
      branch: "b",
      worktreePath: "/p",
      headSha: "dddddddddddddddddddddddddddddddddddddddd",
      changedFiles: ["x.ts"],
      red: { command: "c", exitCode: 1, summary: "r" },
      green: { command: "c", exitCode: 0, summary: "g" },
      notes: "model says ok",
    };
    const v = postValidateEvidence(reported, git, { issueId: "i" });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/headSha|mismatch/i);
  });

  test("queryGitFacts reads live worktree", () => {
    const r = repo();
    const assignment = makeAssignment(r);
    // commit a change in the lane for file list
    writeFileSync(join(assignment.worktreePath, "feat.ts"), "export {}\n");
    const laneRepo = createTempRepo(); // unused guard
    repos.push(laneRepo);
    // use assignment worktree git
    const { execFileSync } = require("node:child_process");
    execFileSync("git", ["-C", assignment.worktreePath, "add", "feat.ts"]);
    execFileSync("git", [
      "-C",
      assignment.worktreePath,
      "commit",
      "-m",
      "feat",
    ], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });
    const facts = queryGitFacts(assignment.worktreePath);
    expect(facts.branch).toBe(assignment.branch);
    expect(facts.changedFiles).toContain("feat.ts");
    expect(facts.headSha).toMatch(/^[0-9a-f]+$/);
  });
});

describe("controller wiring", () => {
  test("index handleHarness stays side-effect free; runner accepts active API", async () => {
    const r = repo();
    const assignment = makeAssignment(r);
    // commit change so evidence can match
    writeFileSync(join(assignment.worktreePath, "x.ts"), "1\n");
    const { execFileSync } = require("node:child_process");
    execFileSync("git", ["-C", assignment.worktreePath, "add", "x.ts"]);
    execFileSync(
      "git",
      ["-C", assignment.worktreePath, "commit", "-m", "x"],
      {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@t",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@t",
        },
      },
    );
    const facts = queryGitFacts(assignment.worktreePath);
    const evidence: ImplementerEvidenceEnvelope = {
      issueId: assignment.issueId,
      branch: facts.branch,
      worktreePath: realpathSync(assignment.worktreePath),
      headSha: facts.headSha,
      changedFiles: facts.changedFiles,
      red: { command: "test -f missing", exitCode: 1, summary: "red" },
      green: { command: "true", exitCode: 0, summary: "green" },
      notes: "done",
    };

    const api = fakeApi({});
    const result = await runAssignedLane(api, assignment, {
      fakeEvidence: evidence,
      forbidden: {},
    });
    expect(result.validation.ok).toBe(true);
    expect(result.sessionOpts.cwd).toBe(assignment.worktreePath);
    expect(result.evidence.issueId).toBe("iss1");

    // handleHarness does not leak write broker
    const h = handleHarnessCommand("ship it");
    expect(h.startMessages).toHaveLength(1);
    expect(JSON.stringify(h)).not.toMatch(/BeadsBroker|publishBiteSized/);
  });

  test("child cannot reach write broker via forbidden caps", async () => {
    const r = repo();
    const assignment = makeAssignment(r);
    await expect(
      runAssignedLane(fakeApi({}), assignment, {
        forbidden: { beadsWrite: { create: () => {} } },
      }),
    ).rejects.toThrow(/Beads write/i);
  });
});
