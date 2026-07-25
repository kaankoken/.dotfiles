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
  createStrictAgentCall,
  type Workflowz,
  runWithAdapter,
} from "../extensions/goal-harness/workflow-adapter";
import { reviewResultSchema } from "../extensions/goal-harness/schemas";
import { runResearch } from "./research";
import { createSpecSession, runSpecGate } from "./spec";
import type { HumanGate } from "../extensions/goal-harness/human-gate";

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
  };
  researchScope?: "small" | "large";
  /** Optional human gate for Spec; without approval Spec cannot advance to Plan. */
  humanGate?: HumanGate;
};

/**
 * Drive harness: Init → Research fan-out → Spec gate (+ optional human approval).
 */
export async function runGoalHarness(
  opts: RunHarnessOptions,
): Promise<DurableSnapshot> {
  let snap =
    opts.snapshot ?? createInitialSnapshot(`run-${Date.now()}`, opts.boundGoal);

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
      }
    } else {
      // Tests without humanGate: machine can pass; product path should inject gate
      snap = applyTransition(snap, { type: "gate_pass", gate: "Spec" });
    }

    await wz.pipeline([{ step: 1 }], async (item) => item);
  });

  return snap;
}

/** Source-path marker for tests. */
export const WORKFLOW_SOURCE = "omp/workflows/goal-harness.ts";
