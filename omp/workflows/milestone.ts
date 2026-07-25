/**
 * Milestone gate: parallel review angles + mandatory fresh command verification.
 * Model consensus alone never passes. Budget exactly 3.
 */

import {
  createStrictAgentCall,
  type Workflowz,
} from "../extensions/goal-harness/workflow-adapter";
import { reviewResultSchema } from "../extensions/goal-harness/schemas";
import { validateReviewResult } from "../extensions/goal-harness/validation";
import {
  runFreshVerification,
  type FreshVerificationReport,
  type RunFreshVerificationOpts,
  type VerifyCommand,
} from "../extensions/goal-harness/verification";

export const MILESTONE_BUDGET = 3;

export const MILESTONE_ANGLES = [
  "correctness",
  "tests",
  "wiring/warnings",
  "stack conventions",
  "security",
  "ponytail/YAGNI",
] as const;

export type MilestoneAngle = (typeof MILESTONE_ANGLES)[number];

export type AngleReview = {
  angle: MilestoneAngle;
  ok: boolean;
  feedback: string;
  blocking: string[];
  agentName: string;
};

export type MilestoneResult = {
  ok: boolean;
  attempts: number;
  angles: AngleReview[];
  verification: FreshVerificationReport | null;
  blocking: string[];
};

export class MilestoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MilestoneError";
  }
}

async function reviewAngle(
  wz: Workflowz,
  angle: MilestoneAngle,
  opts: { model: string; context: string },
): Promise<AngleReview> {
  const agentName = `milestone-reviewer-${angle.replace(/[^a-z0-9]+/gi, "-")}`;
  const call = createStrictAgentCall({
    agentName,
    model: opts.model,
    effort: "max",
    schema: reviewResultSchema,
    schemaMode: "strict",
  });
  const raw = await call(
    wz,
    `Milestone angle: ${angle}\nContext:\n${opts.context}`,
  );
  const v = validateReviewResult(raw);
  if (!v.ok) {
    return {
      angle,
      ok: false,
      feedback: v.reason ?? "invalid review",
      blocking: [v.reason ?? "invalid"],
      agentName,
    };
  }
  const r = v.value as { ok: boolean; feedback: string; blocking: string[] };
  return {
    angle,
    ok: r.ok,
    feedback: r.feedback,
    blocking: r.blocking,
    agentName,
  };
}

/**
 * Run parallel angle reviews + separate fresh verification.
 * PASS only when all angles ok AND verification ok.
 * Never pass on model consensus alone.
 */
export async function runMilestoneGate(
  wz: Workflowz,
  opts: {
    model: string;
    context: string;
    verification: RunFreshVerificationOpts;
    maxAttempts?: number;
    /** When true, skip live process verification (tests must inject via verification.exec). */
  },
): Promise<MilestoneResult> {
  const max = opts.maxAttempts ?? MILESTONE_BUDGET;
  let attempts = 0;
  let lastAngles: AngleReview[] = [];
  let lastVerify: FreshVerificationReport | null = null;
  const allBlocking: string[] = [];

  while (attempts < max) {
    attempts++;
    wz.phase("Milestone");

    lastAngles = await wz.parallel(
      MILESTONE_ANGLES.map(
        (angle) => () =>
          reviewAngle(wz, angle, {
            model: opts.model,
            context: opts.context,
          }),
      ),
    );

    const angleBlocking = lastAngles.flatMap((a) =>
      a.ok ? [] : a.blocking.map((b) => `${a.angle}: ${b}`),
    );

    // Fresh verification is mandatory and independent of model consensus
    lastVerify = runFreshVerification(opts.verification);
    const blocking = [
      ...angleBlocking,
      ...lastVerify.blocking.map((b) => `verify: ${b}`),
    ];

    if (lastAngles.every((a) => a.ok) && lastVerify.ok) {
      return {
        ok: true,
        attempts,
        angles: lastAngles,
        verification: lastVerify,
        blocking: [],
      };
    }

    allBlocking.push(...blocking);
    // budget remaining → retry (caller may fix and re-invoke; here we loop)
    if (attempts >= max) break;
  }

  return {
    ok: false,
    attempts,
    angles: lastAngles,
    verification: lastVerify,
    blocking: allBlocking.length
      ? allBlocking
      : ["milestone failed after budget"],
  };
}

/** Default command set labels for projects (injected argv by caller). */
export function defaultVerifyLabels(): VerifyCommand["name"][] {
  return ["tests", "lint", "typecheck", "build", "stack"];
}
