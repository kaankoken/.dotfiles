import { describe, expect, test } from "bun:test";
import {
  type ResearchInput,
  type ScoutReport,
  planResearchJobs,
  runResearch,
  synthesizeReports,
} from "../workflows/research";
import {
  type SpecSession,
  applyReviewToSpec,
  createSpecSession,
  presentAlternatives,
  presentDesignSection,
  produceSpecCandidate,
  runSpecGate,
} from "../workflows/spec";
import { createHumanGate } from "../extensions/goal-harness/human-gate";
import type { Workflowz } from "../extensions/goal-harness/workflow-adapter";
import { applyTransition, createInitialSnapshot } from "../extensions/goal-harness/phase-machine";

function fakeWz(opts?: {
  agentResults?: Record<string, unknown>;
  malformedAgents?: string[];
}): { wz: Workflowz; agents: string[] } {
  const agents: string[] = [];
  const wz: Workflowz = {
    phase() {},
    async agent(prompt, options) {
      agents.push(options.agentName);
      expect(options.schemaMode).toBe("strict");
      if (opts?.malformedAgents?.includes(options.agentName)) {
        return "not json prose";
      }
      if (opts?.agentResults?.[options.agentName] !== undefined) {
        return opts.agentResults[options.agentName];
      }
      if (options.agentName.includes("reviewer")) {
        return { ok: true, feedback: "ok", blocking: [] };
      }
      if (options.agentName.includes("writer") || options.agentName.includes("spec-writer")) {
        return {
          title: "Design",
          sections: { problem: "p", goals: ["g"] },
          sources: ["s1"],
        };
      }
      // scout default
      return {
        scout: options.agentName,
        findings: [`finding from ${options.agentName}`],
        sources: [`source://${options.agentName}`],
        structured: true,
      };
    },
    async parallel(jobs) {
      return Promise.all(jobs.map((j) => j()));
    },
    async pipeline(items, ...stages) {
      let cur = items;
      for (const st of stages) {
        cur = await Promise.all(cur.map((i) => st(i)));
      }
      return cur;
    },
  };
  return { wz, agents };
}

describe("Research fan-out", () => {
  test("large multi-area goal plans five core scouts", () => {
    const jobs = planResearchJobs({
      boundGoal: "Migrate multi-subsystem auth and billing",
      scope: "large",
      escalateBrowse: false,
      escalateBrowserUse: false,
      escalateWebwright: false,
      goalRule5VersionCheck: true,
    });
    const names = jobs.map((j) => j.agentName);
    expect(names).toEqual(
      expect.arrayContaining([
        "code-graph-scout",
        "code-search-scout",
        "docs-scout",
        "web-scout",
        "stack-scout",
      ]),
    );
    expect(names).not.toContain("web-browse-scout");
    expect(names).not.toContain("browser-use-scout");
    expect(names).not.toContain("webwright-scout");
  });

  test("optional browser jobs only when escalation predicates true", () => {
    const jobs = planResearchJobs({
      boundGoal: "SPA docs",
      scope: "large",
      escalateBrowse: true,
      escalateBrowserUse: true,
      escalateWebwright: true,
      goalRule5VersionCheck: false,
    });
    const names = jobs.map((j) => j.agentName);
    expect(names).toContain("web-browse-scout");
    expect(names).toContain("browser-use-scout");
    expect(names).toContain("webwright-scout");
  });

  test("small goal may skip broad fan-out but still does version research for rule 5", () => {
    const jobs = planResearchJobs({
      boundGoal: "Bump one dep",
      scope: "small",
      escalateBrowse: false,
      escalateBrowserUse: false,
      escalateWebwright: false,
      goalRule5VersionCheck: true,
    });
    expect(jobs.length).toBeLessThan(5);
    expect(jobs.some((j) => j.agentName === "web-scout")).toBe(true);
    expect(jobs.some((j) => j.targetedVersionResearch)).toBe(true);
  });

  test("runResearch synthesizes source-linked reports before Spec sees them", async () => {
    const { wz, agents } = fakeWz();
    const input: ResearchInput = {
      boundGoal: "large multi-area feature",
      scope: "large",
      escalateBrowse: false,
      escalateBrowserUse: false,
      escalateWebwright: false,
      goalRule5VersionCheck: true,
    };
    const result = await runResearch(wz, input, {
      model: "openai-codex/gpt-5.6-sol",
    });
    expect(agents.length).toBeGreaterThanOrEqual(5);
    expect(result.reports.every((r) => r.sources.length > 0)).toBe(true);
    expect(result.reports.every((r) => r.structured)).toBe(true);
    expect(result.synthesis.sources.length).toBeGreaterThan(0);
    expect(result.synthesis.text.length).toBeGreaterThan(0);
    // Spec must not have run yet
    expect(agents).not.toContain("spec-writer");
  });
});

describe("Spec + human gate", () => {
  test("parent asks one focused question at a time", () => {
    const session = createSpecSession("goal");
    const q1 = session.askNextQuestion();
    expect(q1).toBeTruthy();
    session.answer(q1!, "yes");
    const q2 = session.askNextQuestion();
    expect(q2).toBeTruthy();
    expect(q2).not.toBe(q1);
    // cannot get two unanswered
    expect(session.pendingQuestions.length).toBe(1);
  });

  test("parent presents alternatives then incremental design sections", () => {
    const session = createSpecSession("goal");
    const alts = presentAlternatives(session, [
      { id: "a", label: "A", recommended: true },
      { id: "b", label: "B", recommended: false },
    ]);
    expect(alts.some((a) => a.recommended)).toBe(true);
    presentDesignSection(session, "problem", "The problem is X");
    presentDesignSection(session, "goals", "Goals are Y");
    expect(session.designSections.problem).toBe("The problem is X");
    expect(session.designSections.goals).toBe("Goals are Y");
  });

  test("spec-writer then different reviewer; invalid reviewer fails", async () => {
    const { wz, agents } = fakeWz({
      agentResults: {
        "spec-writer": {
          title: "Spec",
          sections: { problem: "p" },
          sources: ["r1"],
        },
        "spec-reviewer": { ok: true, feedback: "good", blocking: [] },
      },
    });
    const session = createSpecSession("goal");
    const cand = await produceSpecCandidate(wz, session, {
      model: "openai-codex/gpt-5.6-sol",
      reviewerModel: "anthropic/claude-fable-5",
    });
    expect(cand.title).toBe("Spec");
    expect(agents).toContain("spec-writer");
    expect(agents).toContain("spec-reviewer");
    // different model ids when available
    expect(cand.producerModel).not.toBe(cand.reviewerModel);

    const bad = fakeWz({ malformedAgents: ["spec-reviewer"] });
    await expect(
      produceSpecCandidate(bad.wz, createSpecSession("g"), {
        model: "m1",
        reviewerModel: "m2",
      }),
    ).rejects.toThrow(/strict|malformed|prose/i);
  });

  test("FAIL findings return to producer up to three attempts", async () => {
    let reviewCount = 0;
    const { wz } = fakeWz({
      agentResults: {
        "spec-writer": {
          title: "S",
          sections: {},
          sources: [],
        },
      },
    });
    // override agent for reviewer fail then pass
    const orig = wz.agent.bind(wz);
    wz.agent = async (prompt, options) => {
      if (options.agentName === "spec-reviewer") {
        reviewCount++;
        if (reviewCount < 3) {
          return {
            ok: false,
            feedback: "fix it",
            blocking: ["missing AC"],
          };
        }
        return { ok: true, feedback: "ok", blocking: [] };
      }
      return orig(prompt, options);
    };

    const session = createSpecSession("goal");
    const out = await runSpecGate(wz, session, {
      model: "sol",
      reviewerModel: "fable",
      maxAttempts: 3,
    });
    expect(reviewCount).toBe(3);
    expect(out.review.ok).toBe(true);
    expect(out.attempts).toBe(3);
  });

  test("PASS cannot advance until human explicitly approves; Beads first", async () => {
    const beadsWrites: string[] = [];
    const gate = createHumanGate({
      interactive: true,
      approve: async () => ({
        approved: true,
        actor: "human@local",
        at: "2026-07-25T12:00:00Z",
      }),
      writeBeadsApproval: async (rec) => {
        beadsWrites.push(JSON.stringify(rec));
      },
    });

    const session = createSpecSession("goal");
    session.candidate = {
      title: "S",
      sections: { problem: "p" },
      sources: ["s"],
      hash: "abc123",
    };
    session.review = { ok: true, feedback: "ok", blocking: [] };

    // without human approval, cannot advance
    expect(session.canAdvanceToPlan()).toBe(false);

    const approval = await gate.requestApproval(session);
    expect(approval.approved).toBe(true);
    expect(beadsWrites.length).toBe(1);
    expect(beadsWrites[0]).toMatch(/abc123|human@local/);
    expect(session.humanApproval).toBeTruthy();
    expect(session.canAdvanceToPlan()).toBe(true);
  });

  test("headless without auditable approval is blocked", async () => {
    const gate = createHumanGate({
      interactive: false,
      // no explicitApproval provided
    });
    const session = createSpecSession("goal");
    session.candidate = {
      title: "S",
      sections: {},
      sources: [],
      hash: "h",
    };
    session.review = { ok: true, feedback: "ok", blocking: [] };
    await expect(gate.requestApproval(session)).rejects.toThrow(
      /blocked|headless|approval/i,
    );
  });

  test("background agent cannot self-approve", async () => {
    const gate = createHumanGate({
      interactive: true,
      approve: async () => ({
        approved: true,
        actor: "agent:spec-writer",
        at: "t",
      }),
    });
    const session = createSpecSession("goal");
    session.candidate = {
      title: "S",
      sections: {},
      sources: [],
      hash: "h",
    };
    session.review = { ok: true, feedback: "ok", blocking: [] };
    await expect(gate.requestApproval(session)).rejects.toThrow(
      /self-approve|human|background/i,
    );
  });

  test("phase machine Spec pass only after human approval path", () => {
    let s = createInitialSnapshot("run-1", "g");
    s = applyTransition(s, { type: "complete", phase: "Init" });
    s = applyTransition(s, { type: "complete", phase: "Research" });
    s = applyTransition(s, { type: "begin", phase: "Spec" });
    // gate_pass without human would be invalid at higher layer — machine allows
    // gate_pass but Spec workflow refuses canAdvanceToPlan without approval
    const session = createSpecSession("g");
    session.review = { ok: true, feedback: "ok", blocking: [] };
    expect(session.canAdvanceToPlan()).toBe(false);
  });
});
