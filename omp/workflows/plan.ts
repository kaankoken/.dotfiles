/**
 * Plan gate: plan-writer → plan-reviewer (strict).
 * maxAttempts is a ceiling only — first PASS ends the gate; rewrite only on FAIL.
 * Multi-area plans trigger a second narrow research pass.
 */

import {
  createStrictAgentCall,
  type Workflowz,
} from "../extensions/goal-harness/workflow-adapter";
import { reviewResultSchema } from "../extensions/goal-harness/schemas";
import {
  formatRevisionFeedback,
  reviewRequiresRevision,
} from "../extensions/goal-harness/gate-revision";
import type { ResearchSynthesis } from "./research";
import type { SpecCandidate } from "./spec";

export type PlanStep = {
  id: string;
  title: string;
  paths: string[];
  testSurfaces: string[];
  dependsOn: string[];
  doneWhen: string;
  area?: string;
};

export type PlanArtifact = {
  steps: PlanStep[];
  multiArea: boolean;
  libraryTruth?: string[];
  researchPass2?: ResearchSynthesis;
};

export type ReviewResult = {
  ok: boolean;
  feedback: string;
  blocking: string[];
};

export type PlanGateResult = {
  plan: PlanArtifact;
  review: ReviewResult;
  attempts: number;
};

export type PlanGateOpts = {
  model: string;
  reviewerModel: string;
  maxAttempts?: number;
  /** Second narrow research when multi-area */
  runNarrowResearch?: (
    wz: Workflowz,
    areas: string[],
  ) => Promise<ResearchSynthesis>;
};

function isMultiArea(steps: PlanStep[]): boolean {
  const areas = new Set(
    steps.map((s) => s.area ?? s.paths[0]?.split("/")[0] ?? s.id),
  );
  return areas.size > 1;
}

export async function producePlan(
  wz: Workflowz,
  input: {
    boundGoal: string;
    approvedSpec: SpecCandidate;
    research: ResearchSynthesis;
    priorFeedback?: string;
  },
  opts: PlanGateOpts,
): Promise<PlanArtifact> {
  wz.phase("Plan");
  const writer = createStrictAgentCall({
    agentName: "plan-writer",
    model: opts.model,
    effort: "ultra",
    schema: {
      type: "object",
      required: ["steps"],
      additionalProperties: true,
    },
    schemaMode: "strict",
  });

  const raw = (await writer(
    wz,
    [
      `Write implementation plan for: ${input.boundGoal}`,
      `Approved spec: ${JSON.stringify(input.approvedSpec)}`,
      `Research evidence: ${input.research.text}`,
      `Sources: ${input.research.sources.join(", ")}`,
      input.priorFeedback ? `Reviewer feedback: ${input.priorFeedback}` : "",
      "Each step needs: id, title, paths[], testSurfaces[], dependsOn[], doneWhen, optional area",
      "Include exact paths, test surfaces, dependencies, and current library truth notes.",
    ]
      .filter(Boolean)
      .join("\n"),
  )) as Record<string, unknown>;

  const steps = normalizeSteps(raw.steps);
  let plan: PlanArtifact = {
    steps,
    multiArea: isMultiArea(steps),
    libraryTruth: Array.isArray(raw.libraryTruth)
      ? raw.libraryTruth.map(String)
      : undefined,
  };

  if (plan.multiArea && opts.runNarrowResearch) {
    const areas = [
      ...new Set(steps.map((s) => s.area ?? s.paths[0] ?? s.id)),
    ];
    plan.researchPass2 = await opts.runNarrowResearch(wz, areas);
  }

  return plan;
}

function normalizeSteps(raw: unknown): PlanStep[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("plan: steps must be a non-empty array");
  }
  return raw.map((item, i) => {
    if (!item || typeof item !== "object") {
      throw new Error(`plan: step ${i} invalid`);
    }
    const o = item as Record<string, unknown>;
    const paths = Array.isArray(o.paths) ? o.paths.map(String) : [];
    const testSurfaces = Array.isArray(o.testSurfaces)
      ? o.testSurfaces.map(String)
      : [];
    const dependsOn = Array.isArray(o.dependsOn)
      ? o.dependsOn.map(String)
      : [];
    if (!o.id || !o.title || !o.doneWhen) {
      throw new Error(`plan: step ${i} missing id/title/doneWhen`);
    }
    if (paths.length === 0) {
      throw new Error(`plan: step ${o.id} missing paths`);
    }
    if (testSurfaces.length === 0) {
      throw new Error(`plan: step ${o.id} missing testSurfaces`);
    }
    return {
      id: String(o.id),
      title: String(o.title),
      paths,
      testSurfaces,
      dependsOn,
      doneWhen: String(o.doneWhen),
      area: o.area != null ? String(o.area) : undefined,
    };
  });
}

export async function reviewPlan(
  wz: Workflowz,
  plan: PlanArtifact,
  opts: { reviewerModel: string },
): Promise<ReviewResult> {
  const reviewer = createStrictAgentCall({
    agentName: "plan-reviewer",
    model: opts.reviewerModel,
    effort: "max",
    schema: reviewResultSchema,
    schemaMode: "strict",
  });
  return (await reviewer(
    wz,
    `Review plan: ${JSON.stringify(plan)}`,
  )) as ReviewResult;
}

export async function runPlanGate(
  wz: Workflowz,
  input: {
    boundGoal: string;
    approvedSpec: SpecCandidate;
    research: ResearchSynthesis;
  },
  opts: PlanGateOpts,
): Promise<PlanGateResult> {
  const max = opts.maxAttempts ?? 3;
  let attempts = 0;
  let priorFeedback: string | undefined;
  let lastPlan: PlanArtifact | undefined;
  let lastReview: ReviewResult = {
    ok: false,
    feedback: "not run",
    blocking: ["not run"],
  };

  while (attempts < max) {
    attempts++;
    lastPlan = await producePlan(
      wz,
      { ...input, priorFeedback },
      opts,
    );
    lastReview = await reviewPlan(wz, lastPlan, {
      reviewerModel: opts.reviewerModel,
    });
    // PASS → stop immediately (do not burn remaining budget on optional revisions)
    if (!reviewRequiresRevision(lastReview)) {
      return { plan: lastPlan, review: lastReview, attempts };
    }
    priorFeedback = formatRevisionFeedback(lastReview);
  }

  return { plan: lastPlan!, review: lastReview, attempts };
}
