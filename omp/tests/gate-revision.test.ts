import { describe, expect, test } from "bun:test";
import {
  formatRevisionFeedback,
  reviewRequiresRevision,
} from "../extensions/goal-harness/gate-revision";
import { runPlanGate } from "../workflows/plan";
import type { SpecCandidate } from "../workflows/spec";
import type { ResearchSynthesis } from "../workflows/research";
import type { Workflowz } from "../extensions/goal-harness/workflow-adapter";

describe("reviewRequiresRevision", () => {
  test("ok true never requires revision (nits are non-blocking)", () => {
    expect(
      reviewRequiresRevision({
        ok: true,
        feedback: "consider renaming later",
        blocking: [],
      }),
    ).toBe(false);
  });

  test("ok false requires revision", () => {
    expect(
      reviewRequiresRevision({
        ok: false,
        feedback: "missing tests",
        blocking: ["add verification"],
      }),
    ).toBe(true);
  });

  test("formatRevisionFeedback empty on pass", () => {
    expect(
      formatRevisionFeedback({ ok: true, feedback: "nits", blocking: [] }),
    ).toBeUndefined();
  });

  test("formatRevisionFeedback includes blocking on fail", () => {
    const s = formatRevisionFeedback({
      ok: false,
      feedback: "nope",
      blocking: ["a", "b"],
    });
    expect(s).toContain("nope");
    expect(s).toContain("a");
    expect(s).toContain("b");
  });
});

describe("plan gate revision policy", () => {
  const approvedSpec: SpecCandidate = {
    title: "t",
    sections: {},
    sources: [],
    hash: "h",
  };
  const research: ResearchSynthesis = {
    text: "r",
    sources: ["s"],
    reports: [],
  };

  function goodSteps() {
    return [
      {
        id: "1",
        title: "one",
        paths: ["a.ts"],
        testSurfaces: ["a.test.ts"],
        dependsOn: [],
        doneWhen: "green",
      },
    ];
  }

  test("first PASS uses one writer call and attempts===1", async () => {
    const agents: string[] = [];
    const wz = {
      phase() {},
      parallel: async <T>(fns: Array<() => Promise<T>>) =>
        Promise.all(fns.map((f) => f())),
      agent: async (_prompt: string, options: { agentName: string }) => {
        agents.push(options.agentName);
        if (options.agentName === "plan-writer") {
          return { steps: goodSteps() };
        }
        if (options.agentName === "plan-reviewer") {
          return { ok: true, feedback: "lgtm", blocking: [] };
        }
        throw new Error(`unexpected ${options.agentName}`);
      },
    } as unknown as Workflowz;

    const result = await runPlanGate(
      wz,
      { boundGoal: "g", approvedSpec, research },
      { model: "sol", reviewerModel: "fable", maxAttempts: 3 },
    );
    expect(result.review.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(agents.filter((a) => a === "plan-writer")).toEqual(["plan-writer"]);
    expect(agents.filter((a) => a === "plan-reviewer")).toEqual([
      "plan-reviewer",
    ]);
  });
});
