import { describe, expect, test } from "bun:test";
import type { Workflowz } from "../extensions/goal-harness/workflow-adapter";
import {
  createLaneReviewState,
  isLaneApproved,
  noteHeadChange,
  runTaskReviewSequence,
  runSpecReview,
  TaskReviewError,
} from "../extensions/goal-harness/task-review";

function fakeWz(opts: {
  failSpecOnce?: boolean;
  failQualityOnce?: boolean;
  implementerAsReviewer?: boolean;
}): { wz: Workflowz; agents: string[] } {
  const agents: string[] = [];
  let specN = 0;
  let qualityN = 0;
  const wz: Workflowz = {
    phase() {},
    async agent(_p, options) {
      agents.push(options.agentName);
      expect(options.schemaMode).toBe("strict");
      if (options.agentName === "implementer") {
        return { ok: true, feedback: "impl", blocking: [] };
      }
      if (options.agentName.includes("self")) {
        return { ok: true, feedback: "self ok", blocking: [] };
      }
      if (
        options.agentName.includes("spec") ||
        options.agentName === "spec-compliance-reviewer"
      ) {
        specN++;
        if (opts.failSpecOnce && specN === 1) {
          return { ok: false, feedback: "spec fail", blocking: ["missing req"] };
        }
        return { ok: true, feedback: "spec ok", blocking: [] };
      }
      if (
        options.agentName.includes("code-reviewer") ||
        options.agentName.includes("quality")
      ) {
        qualityN++;
        if (opts.failQualityOnce && qualityN === 1) {
          return {
            ok: false,
            feedback: "quality fail",
            blocking: ["style"],
          };
        }
        return { ok: true, feedback: "quality ok", blocking: [] };
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
  return { wz, agents };
}

describe("task review sequence", () => {
  test("implement → self → spec → quality → approved", async () => {
    const { wz, agents } = fakeWz({});
    let state = createLaneReviewState({
      issueId: "iss1",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
    });
    state = await runTaskReviewSequence(wz, state, { model: "m" });
    expect(state.status).toBe("approved");
    expect(isLaneApproved(state)).toBe(true);
    expect(agents.some((a) => a.includes("self"))).toBe(true);
    expect(agents).toContain("spec-compliance-reviewer");
    expect(agents).toContain("code-reviewer");
    expect(agents).not.toContain("implementer"); // reviewers only in sequence after implement
  });

  test("spec and quality reviewers separate from implementer", async () => {
    const { wz } = fakeWz({});
    let state = createLaneReviewState({
      issueId: "i",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
    });
    await expect(
      runSpecReview(wz, state, { model: "m", agentName: "implementer" }),
    ).rejects.toThrow(TaskReviewError);
  });

  test("HEAD_SHA change invalidates reviews and forces re-run", async () => {
    const { wz } = fakeWz({ failSpecOnce: true });
    let heads = ["b".repeat(40), "c".repeat(40)];
    let hi = 0;
    let state = createLaneReviewState({
      issueId: "iss1",
      baseSha: "a".repeat(40),
      headSha: heads[0]!,
    });
    state = await runTaskReviewSequence(wz, state, {
      model: "m",
      maxAttempts: 3,
      applyFix: async (s) => {
        hi++;
        return { headSha: heads[Math.min(hi, heads.length - 1)]! };
      },
    });
    expect(state.status).toBe("approved");
    expect(state.headSha).toBe("c".repeat(40));
    expect(state.specReview?.headShaAtReview).toBe(state.headSha);
  });

  test("noteHeadChange clears prior review outcomes", () => {
    let state = createLaneReviewState({
      issueId: "i",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
    });
    state = {
      ...state,
      selfReview: {
        ok: true,
        feedback: "x",
        blocking: [],
        headShaAtReview: "b".repeat(40),
        kind: "self",
        agentName: "s",
      },
      status: "spec_review",
    };
    state = noteHeadChange(state, "c".repeat(40));
    expect(state.selfReview).toBeUndefined();
    expect(state.status).toBe("fixing");
  });
});
