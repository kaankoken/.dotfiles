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
};

/**
 * Drive a minimal harness skeleton: Init → Research → Spec gate sample.
 * Full phase bodies land in later tasks; this proves entry + primitives.
 */
export async function runGoalHarness(
  opts: RunHarnessOptions,
): Promise<DurableSnapshot> {
  let snap =
    opts.snapshot ?? createInitialSnapshot(`run-${Date.now()}`, opts.boundGoal);

  await runWithAdapter(opts.workflowz, async (wz) => {
    wz.phase("Init");
    snap = applyTransition(snap, { type: "complete", phase: "Init" });

    wz.phase("Research");
    await wz.parallel([
      async () => {
        const call = createStrictAgentCall({
          agentName: "code-graph-scout",
          model: opts.models?.research ?? "openai-codex/gpt-5.6-sol",
          effort: "medium",
          schema: { type: "object", additionalProperties: true },
          schemaMode: "strict",
        });
        return call(wz, `Research for: ${opts.boundGoal}`);
      },
      async () => {
        const call = createStrictAgentCall({
          agentName: "web-scout",
          model: opts.models?.research ?? "openai-codex/gpt-5.6-sol",
          effort: "medium",
          schema: { type: "object", additionalProperties: true },
          schemaMode: "strict",
        });
        return call(wz, `Web research for: ${opts.boundGoal}`);
      },
    ]);
    snap = applyTransition(snap, { type: "complete", phase: "Research" });

    wz.phase("Spec");
    snap = applyTransition(snap, { type: "begin", phase: "Spec" });
    const producer = createStrictAgentCall({
      agentName: "spec-writer",
      model: opts.models?.spec ?? "openai-codex/gpt-5.6-sol",
      effort: "ultra",
      schema: reviewResultSchema,
      schemaMode: "strict",
    });
    // Spec producer returns design object; adapter only requires object shape
    await producer(wz, `Write spec for boundGoal (separate from controllerPolicy)`);

    const reviewer = createStrictAgentCall({
      agentName: "spec-reviewer",
      model: opts.models?.spec ?? "anthropic/claude-fable-5",
      effort: "max",
      schema: reviewResultSchema,
      schemaMode: "strict",
    });
    const review = (await reviewer(wz, "Review the spec")) as {
      ok?: boolean;
    };
    if (review && review.ok === false) {
      snap = applyTransition(snap, {
        type: "gate_fail",
        gate: "Spec",
        feedback: "review failed",
      });
    } else {
      snap = applyTransition(snap, { type: "gate_pass", gate: "Spec" });
    }

    // Demonstrate pipeline primitive
    await wz.pipeline(
      [{ step: 1 }],
      async (item) => item,
    );
  });

  return snap;
}

/** Source-path marker for tests. */
export const WORKFLOW_SOURCE = "omp/workflows/goal-harness.ts";
