import { describe, expect, test } from "bun:test";
import {
  BeadsBroker,
  BeadsBrokerError,
  childReadonlyBroker,
  type BdExecResult,
} from "../extensions/goal-harness/beads";
import { PHASE_ORDER } from "../extensions/goal-harness/run-state";

function fakeBd(opts?: {
  failWhere?: boolean;
  failOn?: string;
  invalidJsonOn?: string;
}) {
  let n = 0;
  const log: string[][] = [];
  const exec = (args: string[]): BdExecResult => {
    log.push([...args]);
    // strip -C cwd
    const i = args[0] === "-C" ? 2 : 0;
    const cmd = args.slice(i);
    const head = cmd[0] ?? "";

    if (opts?.failWhere && head === "where") {
      return { exitCode: 1, stdout: "", stderr: "no workspace" };
    }
    if (opts?.failOn && cmd.join(" ").includes(opts.failOn)) {
      return { exitCode: 1, stdout: "", stderr: `fail ${opts.failOn}` };
    }
    if (opts?.invalidJsonOn && cmd.join(" ").includes(opts.invalidJsonOn)) {
      return { exitCode: 0, stdout: "not-json{", stderr: "" };
    }

    if (head === "where") {
      // prefix must match basename of broker repoCwd (/repo → "repo")
      return {
        exitCode: 0,
        stdout:
          "/repo/.beads\n  prefix: repo\n  database: /repo/.beads/embeddeddolt\n",
        stderr: "",
      };
    }
    if (head === "create") {
      n += 1;
      const id = `issue-${n}`;
      if (cmd.includes("--json")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ id, title: cmd[1] }),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: id, stderr: "" };
    }
    if (head === "update" || head === "close") {
      return { exitCode: 0, stdout: "ok", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  return { exec, log };
}

const skills = [
  {
    name: "brainstorming",
    path: "/skills/brainstorming/SKILL.md",
    sha256: "abc",
  },
];

async function happyPath(broker: BeadsBroker) {
  await broker.ensureWorkspace();
  let s = await broker.createRunEpic({
    runId: "run-1",
    boundGoal: "1. No errors\n2. …",
    modelRoutes: { spec: "sol" },
    skillManifest: skills,
  });
  expect(s.epicId).toBeTruthy();
  expect(s.boundGoal).toContain("No errors");
  expect(s.modelRoutes).toEqual({ spec: "sol" });
  expect(s.skillManifest).toEqual(skills);

  s = await broker.createPhaseIssues("run-1");
  for (const p of PHASE_ORDER) {
    expect(s.phases[p]?.issueId).toBeTruthy();
  }

  s = await broker.recordSkillAttestation("run-1", skills);
  s = await broker.recordResearch("run-1", {
    sources: ["web:1", "tokensave:foo"],
    synthesis: "summary",
  });
  expect(s.phases.Research?.status).toBe("done");

  // cannot plan without human approval
  await expect(
    broker.recordPlan("run-1", { steps: [] }),
  ).rejects.toBeInstanceOf(BeadsBrokerError);

  s = await broker.recordHumanSpecApproval("run-1", {
    approvedAt: "2026-07-25T00:00:00Z",
    approver: "human",
  });
  expect(s.humanSpecApproval?.approver).toBe("human");

  s = await broker.recordPlan("run-1", { steps: ["a", "b"] });
  s = await broker.publishBiteSizedGraph("run-1", [
    { title: "Task A" },
    { title: "Task B", dependsOn: [] },
  ]);
  expect(s.tasks.length).toBe(2);

  const t0 = s.tasks[0].issueId;
  s = await broker.claimTask("run-1", t0, "lane-worker");
  expect(s.tasks[0].status).toBe("claimed");
  s = await broker.recordLane("run-1", t0, "lane-1");
  expect(s.tasks[0].laneId).toBe("lane-1");

  s = await broker.recordEvidence("run-1", t0, "red", {
    command: "test",
    exitCode: 1,
  });
  s = await broker.recordEvidence("run-1", t0, "green", {
    command: "test",
    exitCode: 0,
  });
  s = await broker.recordReview("run-1", t0, {
    ok: true,
    feedback: "lgtm",
    blocking: [],
  });
  s = await broker.recordIntegration("run-1", t0, {
    sourceSha: "aaa1111",
    integratedSha: "bbb2222",
  });
  s = await broker.closeIntegratedTask("run-1", t0);

  // second task
  const t1 = s.tasks[1].issueId;
  s = await broker.claimTask("run-1", t1, "lane-worker");
  s = await broker.recordLane("run-1", t1, "lane-2");
  s = await broker.recordEvidence("run-1", t1, "red", { command: "t", exitCode: 1 });
  s = await broker.recordEvidence("run-1", t1, "green", {
    command: "t",
    exitCode: 0,
  });
  s = await broker.recordReview("run-1", t1, {
    ok: true,
    feedback: "ok",
    blocking: [],
  });
  s = await broker.recordIntegration("run-1", t1, {
    sourceSha: "ccc3333",
    integratedSha: "ddd4444",
  });
  s = await broker.closeIntegratedTask("run-1", t1);

  s = await broker.recordMilestone("run-1", {
    commands: ["bun test", "bash scripts/smoke.sh"],
    ok: true,
  });
  expect(s.milestone?.evidence).toBeTruthy();

  s = await broker.recordPr("run-1", "https://github.com/org/repo/pull/1");
  expect(s.prUrl).toContain("github.com");
  expect(s.phase).toBe("Done");
  return s;
}

describe("beads broker durable run graph", () => {
  test("happy path transitions with phase children", async () => {
    const { exec } = fakeBd();
    const broker = new BeadsBroker(exec, "controller", "/repo");
    const s = await happyPath(broker);
    expect(s.integrations.length).toBe(2);
    expect(s.integrations[0].sourceSha).toBe("aaa1111");
  });

  test("bd where missing stops before durable work (no auto-init)", async () => {
    const { exec } = fakeBd({ failWhere: true });
    const broker = new BeadsBroker(exec, "controller", "/repo");
    await expect(broker.ensureWorkspace()).rejects.toThrow(
      /bd where missing|bare-init|project-init/i,
    );
    await expect(
      broker.createRunEpic({
        runId: "r",
        boundGoal: "g",
        modelRoutes: {},
        skillManifest: [],
      }),
    ).rejects.toThrow(/bd where missing|bare-init|project-init/i);
  });

  test("foreign beads prefix fails closed without init", async () => {
    const exec = (args: string[]): BdExecResult => {
      const i = args[0] === "-C" ? 2 : 0;
      const cmd = args.slice(i);
      if (cmd[0] === "where") {
        return {
          exitCode: 0,
          stdout:
            "/repo/.beads\n  prefix: dotfiles\n  database: /repo/.beads/embeddeddolt\n",
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const broker = new BeadsBroker(exec, "controller", "/repo");
    await expect(broker.ensureWorkspace()).rejects.toThrow(
      /prefix "dotfiles"|does not match|foreign|dotfiles/i,
    );
  });

  test("transition order: research before spec approval", async () => {
    const { exec } = fakeBd();
    const broker = new BeadsBroker(exec, "controller", "/repo");
    await broker.createRunEpic({
      runId: "run-1",
      boundGoal: "g",
      modelRoutes: {},
      skillManifest: skills,
    });
    await broker.createPhaseIssues("run-1");
    await expect(
      broker.recordHumanSpecApproval("run-1", {
        approvedAt: "t",
        approver: "h",
      }),
    ).rejects.toThrow(/Research/);
  });

  test("command failure fails closed", async () => {
    const { exec } = fakeBd({ failOn: "research=" });
    const broker = new BeadsBroker(exec, "controller", "/repo");
    await broker.createRunEpic({
      runId: "run-1",
      boundGoal: "g",
      modelRoutes: {},
      skillManifest: skills,
    });
    await broker.createPhaseIssues("run-1");
    await expect(
      broker.recordResearch("run-1", { sources: [], synthesis: "x" }),
    ).rejects.toThrow(/failed/);
  });

  test("child read-only cannot mutate", async () => {
    const { exec } = fakeBd();
    const controller = new BeadsBroker(exec, "controller", "/repo");
    await controller.createRunEpic({
      runId: "run-1",
      boundGoal: "g",
      modelRoutes: {},
      skillManifest: skills,
    });
    await controller.createPhaseIssues("run-1");
    const state = controller.getRunState()!;
    const child = childReadonlyBroker(state, exec, "/repo");
    await expect(
      child.recordResearch("run-1", { sources: [], synthesis: "x" }),
    ).rejects.toThrow(/read-only/);
    // read ok
    expect(child.readPhase("run-1", "Research")?.issueId).toBeTruthy();
  });

  test("scope mismatch rejects foreign runId", async () => {
    const { exec } = fakeBd();
    const broker = new BeadsBroker(exec, "controller", "/repo");
    await broker.createRunEpic({
      runId: "run-1",
      boundGoal: "g",
      modelRoutes: {},
      skillManifest: skills,
    });
    await expect(broker.createPhaseIssues("run-OTHER")).rejects.toThrow(
      /scope mismatch/,
    );
  });

  test("review requires RED and GREEN evidence", async () => {
    const { exec } = fakeBd();
    const broker = new BeadsBroker(exec, "controller", "/repo");
    await broker.createRunEpic({
      runId: "run-1",
      boundGoal: "g",
      modelRoutes: {},
      skillManifest: skills,
    });
    await broker.createPhaseIssues("run-1");
    await broker.recordResearch("run-1", { sources: ["s"], synthesis: "y" });
    await broker.recordHumanSpecApproval("run-1", {
      approvedAt: "t",
      approver: "h",
    });
    await broker.recordPlan("run-1", { steps: [] });
    let s = await broker.publishBiteSizedGraph("run-1", [{ title: "T" }]);
    const id = s.tasks[0].issueId;
    await broker.claimTask("run-1", id, "w");
    await expect(
      broker.recordReview("run-1", id, {
        ok: true,
        feedback: "x",
        blocking: [],
      }),
    ).rejects.toThrow(/RED and GREEN/);
  });

  test("PR requires milestone", async () => {
    const { exec } = fakeBd();
    const broker = new BeadsBroker(exec, "controller", "/repo");
    await broker.createRunEpic({
      runId: "run-1",
      boundGoal: "g",
      modelRoutes: {},
      skillManifest: skills,
    });
    await expect(
      broker.recordPr("run-1", "https://github.com/o/r/pull/1"),
    ).rejects.toThrow(/milestone/);
  });
});
