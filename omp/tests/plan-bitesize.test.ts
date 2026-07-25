import { describe, expect, test } from "bun:test";
import {
  producePlan,
  reviewPlan,
  runPlanGate,
  type PlanArtifact,
} from "../workflows/plan";
import {
  BiteSizeError,
  detectDependencyCycle,
  produceBiteSize,
  runBiteSizeGate,
  validateBiteGraph,
  type BiteTask,
} from "../workflows/bite-size";
import { BeadsBroker, type BdExecResult } from "../extensions/goal-harness/beads";
import type { Workflowz } from "../extensions/goal-harness/workflow-adapter";
import type { SpecCandidate } from "../workflows/spec";
import type { ResearchSynthesis } from "../workflows/research";

const approvedSpec: SpecCandidate = {
  title: "Spec",
  sections: { problem: "p", goals: ["g"] },
  sources: ["s1"],
  hash: "spec-hash",
};

const research: ResearchSynthesis = {
  text: "research body",
  sources: ["web:1", "tokensave:x"],
  reports: [],
};

function fakeWz(handlers: {
  planSteps?: unknown;
  planMultiArea?: boolean;
  reviewOk?: boolean;
  reviewFailThenOk?: boolean;
  biteTasks?: unknown;
  biteReviewOk?: boolean;
  biteFailThenOk?: boolean;
}): { wz: Workflowz; agents: string[]; narrowResearchCalls: number } {
  const agents: string[] = [];
  let planReviews = 0;
  let biteReviews = 0;
  let narrowResearchCalls = 0;
  const wz: Workflowz = {
    phase() {},
    async agent(_prompt, options) {
      agents.push(options.agentName);
      expect(options.schemaMode).toBe("strict");

      if (options.agentName === "plan-writer") {
        const steps =
          handlers.planSteps ??
          (handlers.planMultiArea
            ? [
                {
                  id: "a",
                  title: "Auth",
                  paths: ["auth/a.ts"],
                  testSurfaces: ["test auth"],
                  dependsOn: [],
                  doneWhen: "auth works",
                  area: "auth",
                },
                {
                  id: "b",
                  title: "Billing",
                  paths: ["billing/b.ts"],
                  testSurfaces: ["test billing"],
                  dependsOn: ["a"],
                  doneWhen: "billing works",
                  area: "billing",
                },
              ]
            : [
                {
                  id: "1",
                  title: "One step",
                  paths: ["src/x.ts"],
                  testSurfaces: ["bun test"],
                  dependsOn: [],
                  doneWhen: "tests pass",
                },
              ]);
        return {
          steps,
          libraryTruth: ["lib@1.2.3 current"],
        };
      }
      if (options.agentName === "plan-reviewer") {
        planReviews++;
        if (handlers.reviewFailThenOk && planReviews < 2) {
          return {
            ok: false,
            feedback: "add tests",
            blocking: ["missing test surface"],
          };
        }
        return {
          ok: handlers.reviewOk !== false,
          feedback: "ok",
          blocking: handlers.reviewOk === false ? ["nope"] : [],
        };
      }
      if (options.agentName === "bite-size-writer") {
        const tasks =
          handlers.biteTasks ??
          [
            {
              id: "t1",
              title: "Implement x",
              files: ["src/x.ts"],
              redCheck: "bun test ./x --fail-first",
              greenCheck: "bun test ./x",
              doneWhen: "green",
              dependsOn: [],
              parallelGroup: "g1",
            },
            {
              id: "t2",
              title: "Docs only",
              files: ["README.md"],
              redCheck: "",
              greenCheck: "",
              doneWhen: "docs updated",
              dependsOn: [],
              nonImplementer: true,
            },
          ];
        // Derive parallel groups from task.parallelGroup; omit explicit list
        // so normalizeGraph builds groups from field (or uses writer-provided).
        return { tasks };
      }
      if (options.agentName === "bite-size-reviewer") {
        biteReviews++;
        if (handlers.biteFailThenOk && biteReviews < 2) {
          return {
            ok: false,
            feedback: "split more",
            blocking: ["t1 too big"],
          };
        }
        return {
          ok: handlers.biteReviewOk !== false,
          feedback: "ok",
          blocking: handlers.biteReviewOk === false ? ["bad"] : [],
        };
      }
      // narrow research scouts
      if (options.agentName.includes("scout")) {
        narrowResearchCalls++;
        return {
          scout: options.agentName,
          findings: ["narrow"],
          sources: [`src://${options.agentName}`],
        };
      }
      return {};
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
  return { wz, agents, get narrowResearchCalls() { return narrowResearchCalls; } };
}

function fakeBroker() {
  let n = 0;
  const exec = (args: string[]): BdExecResult => {
    const i = args[0] === "-C" ? 2 : 0;
    const cmd = args.slice(i);
    if (cmd[0] === "where") {
      return { exitCode: 0, stdout: "/repo/.beads\n", stderr: "" };
    }
    if (cmd[0] === "create") {
      n++;
      const id = `issue-${n}`;
      if (cmd.includes("--json")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ id }),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: id, stderr: "" };
    }
    return { exitCode: 0, stdout: "ok", stderr: "" };
  };
  const broker = new BeadsBroker(exec, "controller", "/repo");
  return broker;
}

describe("Plan gate", () => {
  test("plan-writer receives approved spec, research, paths/tests/deps", async () => {
    const { wz, agents } = fakeWz({});
    const plan = await producePlan(
      wz,
      {
        boundGoal: "ship feature",
        approvedSpec,
        research,
      },
      {
        model: "sol",
        reviewerModel: "fable",
      },
    );
    expect(agents).toContain("plan-writer");
    expect(plan.steps[0].paths.length).toBeGreaterThan(0);
    expect(plan.steps[0].testSurfaces.length).toBeGreaterThan(0);
    expect(plan.libraryTruth?.[0]).toMatch(/lib@/);
  });

  test("multi-area plan triggers second narrow research pass", async () => {
    let narrow = 0;
    const { wz } = fakeWz({ planMultiArea: true });
    const plan = await producePlan(
      wz,
      { boundGoal: "multi", approvedSpec, research },
      {
        model: "sol",
        reviewerModel: "fable",
        runNarrowResearch: async () => {
          narrow++;
          return {
            text: "pass2",
            sources: ["narrow:1"],
            reports: [],
          };
        },
      },
    );
    expect(plan.multiArea).toBe(true);
    expect(narrow).toBe(1);
    expect(plan.researchPass2?.sources).toContain("narrow:1");
  });

  test("plan-reviewer strict output and three-attempt budget", async () => {
    const { wz, agents } = fakeWz({ reviewFailThenOk: true });
    const result = await runPlanGate(
      wz,
      { boundGoal: "g", approvedSpec, research },
      {
        model: "sol",
        reviewerModel: "fable",
        maxAttempts: 3,
      },
    );
    expect(result.review.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(agents.filter((a) => a === "plan-reviewer").length).toBe(2);
  });

  test("invalid plan steps fail closed", async () => {
    const { wz } = fakeWz({
      planSteps: [{ id: "x", title: "no paths", dependsOn: [], doneWhen: "x" }],
    });
    await expect(
      producePlan(
        wz,
        { boundGoal: "g", approvedSpec, research },
        { model: "sol", reviewerModel: "fable" },
      ),
    ).rejects.toThrow(/paths|testSurfaces/);
  });
});

describe("BiteSize gate", () => {
  test("detects dependency cycles", () => {
    const tasks: BiteTask[] = [
      {
        id: "a",
        title: "A",
        files: ["a.ts"],
        redCheck: "t",
        greenCheck: "t2",
        doneWhen: "d",
        dependsOn: ["b"],
      },
      {
        id: "b",
        title: "B",
        files: ["b.ts"],
        redCheck: "t",
        greenCheck: "t2",
        doneWhen: "d",
        dependsOn: ["a"],
      },
    ];
    expect(detectDependencyCycle(tasks)).toBeTruthy();
    expect(() =>
      validateBiteGraph({ tasks, parallelGroups: [] }),
    ).toThrow(/cycle/);
  });

  test("rejects fake TDD and missing RED for implementer tasks", () => {
    expect(() =>
      validateBiteGraph({
        tasks: [
          {
            id: "1",
            title: "noop",
            files: ["a.ts"],
            redCheck: "true",
            greenCheck: "true",
            doneWhen: "done",
            dependsOn: [],
          },
        ],
        parallelGroups: [],
      }),
    ).toThrow(/fake TDD/);
  });

  test("nonImplementer tasks classified outside implementer path", async () => {
    const { wz } = fakeWz({});
    const plan: PlanArtifact = {
      steps: [
        {
          id: "1",
          title: "x",
          paths: ["src/x.ts"],
          testSurfaces: ["test"],
          dependsOn: [],
          doneWhen: "ok",
        },
      ],
      multiArea: false,
    };
    const graph = await produceBiteSize(wz, plan, { model: "sol" });
    const docs = graph.tasks.find((t) => t.nonImplementer);
    expect(docs).toBeTruthy();
    expect(docs!.files).toContain("README.md");
  });

  test("two-attempt budget then publish claimable acyclic Beads graph", async () => {
    const { wz, agents } = fakeWz({ biteFailThenOk: true });
    const broker = fakeBroker();
    await broker.createRunEpic({
      runId: "run-1",
      boundGoal: "g",
      modelRoutes: {},
      skillManifest: [],
    });
    await broker.createPhaseIssues("run-1");
    // mark prior phases done for broker ordering
    await broker.recordResearch("run-1", {
      sources: ["s"],
      synthesis: "y",
    });
    await broker.recordHumanSpecApproval("run-1", {
      approvedAt: "t",
      approver: "human",
    });
    await broker.recordPlan("run-1", { steps: [] });

    const plan: PlanArtifact = {
      steps: [
        {
          id: "1",
          title: "step",
          paths: ["a.ts"],
          testSurfaces: ["test"],
          dependsOn: [],
          doneWhen: "ok",
        },
      ],
      multiArea: false,
    };

    const published = await runBiteSizeGate(wz, plan, {
      model: "sol",
      reviewerModel: "fable",
      maxAttempts: 2,
      broker,
      runId: "run-1",
    });

    expect(published.attempts).toBe(2);
    expect(published.issueIds.length).toBeGreaterThan(0);
    expect(Object.keys(published.issueByTaskId).length).toBe(
      published.issueIds.length,
    );
    // only implementer tasks published (docs excluded)
    expect(published.issueIds.length).toBe(
      published.graph.tasks.filter((t) => !t.nonImplementer).length,
    );
    expect(agents).toContain("bite-size-writer");
    expect(agents).toContain("bite-size-reviewer");
    expect(detectDependencyCycle(published.graph.tasks)).toBeNull();
  });

  test("explicit parallel groups preserved", async () => {
    const { wz } = fakeWz({
      biteTasks: [
        {
          id: "a",
          title: "A",
          files: ["a.ts"],
          redCheck: "ra",
          greenCheck: "ga",
          doneWhen: "da",
          dependsOn: [],
          parallelGroup: "p1",
        },
        {
          id: "b",
          title: "B",
          files: ["b.ts"],
          redCheck: "rb",
          greenCheck: "gb",
          doneWhen: "db",
          dependsOn: [],
          parallelGroup: "p1",
        },
      ],
    });
    const graph = await produceBiteSize(
      wz,
      {
        steps: [],
        multiArea: false,
      },
      { model: "sol" },
    );
    // empty plan steps with writer tasks — normalize from writer
    expect(graph.parallelGroups.some((g) => g.includes("a") && g.includes("b"))).toBe(
      true,
    );
  });
});
