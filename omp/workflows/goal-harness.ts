/**
 * OMP goal-harness workflow entry.
 * Composes pure phase-machine + strict Workflowz adapter.
 * Uses native OMP Workflowz only (no foreign workflow packages).
 */

import {
  applyTransition,
  createInitialSnapshot,
  type DurableSnapshot,
} from "../extensions/goal-harness/phase-machine";
import {
  type Workflowz,
  runWithAdapter,
} from "../extensions/goal-harness/workflow-adapter";
import { runResearch } from "./research";
import { createSpecSession, runSpecGate } from "./spec";
import { runPlanGate, type PlanArtifact } from "./plan";
import {
  runBiteSizeGate,
  type PublishedBiteSize,
} from "./bite-size";
import type { HumanGate } from "../extensions/goal-harness/human-gate";
import type { BeadsBroker } from "../extensions/goal-harness/beads";
import type {
  ActiveExtensionApi,
  LaneAssignment,
} from "../extensions/goal-harness/lane-runner";
import { runAssignedLane } from "../extensions/goal-harness/lane-runner";
import {
  runTaskReviewSequence,
  createLaneReviewState,
  isLaneApproved,
  type LaneReviewState,
} from "../extensions/goal-harness/task-review";
import {
  integrateReviewedLanes,
  type ReviewedRange,
  type IntegrationResult,
} from "../extensions/goal-harness/integration";

export type HarnessStartMessage = {
  kind: "goal-harness-start";
  workflowModule: "omp/workflows/goal-harness.ts";
  boundGoal: string;
  /** Controller/policy context — never concatenated into boundGoal. */
  controllerPolicy: string;
};

/** Build the single internal start message after preflight. */
export function buildStartMessage(boundGoal: string): HarnessStartMessage {
  return {
    kind: "goal-harness-start",
    workflowModule: "omp/workflows/goal-harness.ts",
    boundGoal,
    controllerPolicy:
      "Load skills/goal-harness/SKILL.md; Superpowers live reads only; bd SoT.",
  };
}

export type RunHarnessOptions = {
  boundGoal: string;
  snapshot?: DurableSnapshot;
  /** Injected Workflowz runtime (tests / OMP Eval). */
  workflowz: Workflowz;
  /** Resolved models per phase (from model-router). */
  models?: {
    research?: string;
    spec?: string;
    plan?: string;
    biteSize?: string;
  };
  researchScope?: "small" | "large";
  /** Optional human gate for Spec; without approval Spec cannot advance to Plan. */
  humanGate?: HumanGate;
  /**
   * Controller Beads broker. When present (and Spec passed), Plan + BiteSize
   * run and the accepted graph is published as claimable issues.
   * No routine human pause after Plan/BiteSize.
   */
  broker?: BeadsBroker;
  /**
   * Active OMP SDK for implementer lanes. Children receive only LaneAssignment
   * context — never the broker or worktree controller.
   */
  activeApi?: ActiveExtensionApi;
  /** Optional pre-built lane assignments for Implement phase tests. */
  laneAssignments?: LaneAssignment[];
  /** Optional reviewed ranges for Integration phase. */
  integration?: {
    ranges: ReviewedRange[];
    integrationWorktreePath: string;
    integrationBranch: string;
    repoRoot: string;
    prOpen?: boolean;
  };
};

export type HarnessRunResult = {
  snapshot: DurableSnapshot;
  plan?: PlanArtifact;
  published?: PublishedBiteSize;
  reviews?: LaneReviewState[];
  integration?: IntegrationResult;
};

export {
  createLaneReviewState,
  runTaskReviewSequence,
  isLaneApproved,
  integrateReviewedLanes,
};

/**
 * Drive harness: Init → Research → Spec (+ optional human) → Plan → BiteSize.
 * Plan/BiteSize advance only after Spec is passable; BiteSize publishes only
 * when a controller broker is injected.
 */
export async function runGoalHarness(
  opts: RunHarnessOptions,
): Promise<DurableSnapshot> {
  const result = await runGoalHarnessDetailed(opts);
  return result.snapshot;
}

/** Full result including plan artifact and published issue IDs. */
export async function runGoalHarnessDetailed(
  opts: RunHarnessOptions,
): Promise<HarnessRunResult> {
  let snap =
    opts.snapshot ?? createInitialSnapshot(`run-${Date.now()}`, opts.boundGoal);
  let plan: PlanArtifact | undefined;
  let published: PublishedBiteSize | undefined;
  const reviews: LaneReviewState[] = [];
  let integration: IntegrationResult | undefined;

  await runWithAdapter(opts.workflowz, async (wz) => {
    wz.phase("Init");
    snap = applyTransition(snap, { type: "complete", phase: "Init" });

    const research = await runResearch(
      wz,
      {
        boundGoal: opts.boundGoal,
        scope: opts.researchScope ?? "large",
        escalateBrowse: false,
        escalateBrowserUse: false,
        escalateWebwright: false,
        goalRule5VersionCheck: true,
      },
      { model: opts.models?.research ?? "openai-codex/gpt-5.6-sol" },
    );
    snap = applyTransition(snap, { type: "complete", phase: "Research" });

    wz.phase("Spec");
    snap = applyTransition(snap, { type: "begin", phase: "Spec" });
    const session = createSpecSession(opts.boundGoal, research.synthesis);
    const gate = await runSpecGate(wz, session, {
      model: opts.models?.spec ?? "openai-codex/gpt-5.6-sol",
      reviewerModel: opts.models?.spec
        ? opts.models.spec
        : "anthropic/claude-fable-5",
      maxAttempts: 3,
    });

    let specPassed = false;
    if (!gate.review.ok) {
      snap = applyTransition(snap, {
        type: "gate_fail",
        gate: "Spec",
        feedback: gate.review.feedback,
      });
    } else if (opts.humanGate) {
      await opts.humanGate.requestApproval(session);
      if (session.canAdvanceToPlan()) {
        snap = applyTransition(snap, { type: "gate_pass", gate: "Spec" });
        specPassed = true;
      }
    } else {
      // Tests without humanGate: machine can pass; product path should inject gate
      snap = applyTransition(snap, { type: "gate_pass", gate: "Spec" });
      specPassed = true;
    }

    if (specPassed && session.candidate) {
      const planModel = opts.models?.plan ?? "openai-codex/gpt-5.6-sol";
      const planReviewer =
        opts.models?.plan ?? "anthropic/claude-fable-5";

      snap = applyTransition(snap, { type: "begin", phase: "Plan" });
      const planGate = await runPlanGate(
        wz,
        {
          boundGoal: opts.boundGoal,
          approvedSpec: session.candidate,
          research: research.synthesis,
        },
        {
          model: planModel,
          reviewerModel: planReviewer,
          maxAttempts: 3,
          runNarrowResearch: async (w, areas) => {
            const pass2 = await runResearch(
              w,
              {
                boundGoal: `${opts.boundGoal} [narrow: ${areas.join(", ")}]`,
                scope: "small",
                escalateBrowse: false,
                escalateBrowserUse: false,
                escalateWebwright: false,
                goalRule5VersionCheck: true,
              },
              { model: opts.models?.research ?? planModel },
            );
            return pass2.synthesis;
          },
        },
      );
      plan = planGate.plan;

      if (!planGate.review.ok) {
        snap = applyTransition(snap, {
          type: "gate_fail",
          gate: "Plan",
          feedback: planGate.review.feedback,
        });
      } else {
        snap = applyTransition(snap, { type: "gate_pass", gate: "Plan" });

        if (opts.broker) {
          await opts.broker.recordPlan(snap.runId, plan);
          snap = applyTransition(snap, { type: "begin", phase: "BiteSize" });
          try {
            published = await runBiteSizeGate(wz, plan, {
              model: opts.models?.biteSize ?? planModel,
              reviewerModel: opts.models?.biteSize ?? planReviewer,
              maxAttempts: 2,
              broker: opts.broker,
              runId: snap.runId,
            });
            snap = applyTransition(snap, {
              type: "gate_pass",
              gate: "BiteSize",
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            snap = applyTransition(snap, {
              type: "gate_fail",
              gate: "BiteSize",
              feedback: msg,
            });
          }
        }
      }
    }

    // Implement phase: only when active API + assignments provided (Task 20+).
    // Each lane gets issue/spec/plan slice only — no broker, no worktree mgr.
    if (
      opts.activeApi &&
      opts.laneAssignments?.length &&
      snap.completed.includes("BiteSize")
    ) {
      wz.phase("Implement");
      snap = applyTransition(snap, { type: "begin", phase: "Implement" });
      for (const assignment of opts.laneAssignments) {
        await runAssignedLane(opts.activeApi, assignment);
        let review = createLaneReviewState({
          issueId: assignment.issueId,
          baseSha: assignment.baseSha,
          headSha: assignment.baseSha,
        });
        review = await runTaskReviewSequence(wz, review, {
          model: assignment.model,
        });
        reviews.push(review);
      }
      snap = applyTransition(snap, { type: "complete", phase: "Implement" });
    }

    if (
      opts.integration?.ranges.length &&
      snap.completed.includes("Implement")
    ) {
      wz.phase("Integration");
      snap = applyTransition(snap, { type: "begin", phase: "Integration" });
      integration = integrateReviewedLanes({
        repoRoot: opts.integration.repoRoot,
        integrationWorktreePath: opts.integration.integrationWorktreePath,
        integrationBranch: opts.integration.integrationBranch,
        ranges: opts.integration.ranges,
        prOpen: opts.integration.prOpen,
      });
      snap = applyTransition(snap, { type: "complete", phase: "Integration" });
    }

    await wz.pipeline([{ step: 1 }], async (item) => item);
  });

  return { snapshot: snap, plan, published, reviews, integration };
}

/** Source-path marker for tests. */
export const WORKFLOW_SOURCE = "omp/workflows/goal-harness.ts";
