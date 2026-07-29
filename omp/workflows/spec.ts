/**
 * Interactive Spec workflow: one-question brainstorming, alternatives,
 * incremental sections, producer/reviewer gate, human approval required.
 */

import { createHash } from "node:crypto";
import {
  createStrictAgentCall,
  type Workflowz,
} from "../extensions/goal-harness/workflow-adapter";
import { reviewResultSchema } from "../extensions/goal-harness/schemas";
import {
  formatRevisionFeedback,
  reviewRequiresRevision,
} from "../extensions/goal-harness/gate-revision";
import type { HumanApprovalRecord } from "../extensions/goal-harness/human-gate";
import type { ResearchSynthesis } from "./research";

export type SpecCandidate = {
  title: string;
  sections: Record<string, unknown>;
  sources: string[];
  hash: string;
  producerModel?: string;
  reviewerModel?: string;
};

export type ReviewResult = {
  ok: boolean;
  feedback: string;
  blocking: string[];
};

export type SpecSession = {
  boundGoal: string;
  questions: string[];
  answers: Record<string, string>;
  pendingQuestions: string[];
  alternatives: Array<{ id: string; label: string; recommended: boolean }>;
  designSections: Record<string, string>;
  candidate?: SpecCandidate;
  review?: ReviewResult;
  humanApproval?: HumanApprovalRecord;
  research?: ResearchSynthesis;
  askNextQuestion(): string | null;
  answer(question: string, text: string): void;
  canAdvanceToPlan(): boolean;
};

const DEFAULT_QUESTIONS = [
  "What is the primary user-visible outcome?",
  "What is explicitly out of scope?",
  "What are the highest technical risks?",
];

export function createSpecSession(
  boundGoal: string,
  research?: ResearchSynthesis,
): SpecSession {
  const pending = [...DEFAULT_QUESTIONS];
  const session: SpecSession = {
    boundGoal,
    questions: [...DEFAULT_QUESTIONS],
    answers: {},
    pendingQuestions: [],
    alternatives: [],
    designSections: {},
    research,
    askNextQuestion() {
      if (session.pendingQuestions.length > 0) {
        return session.pendingQuestions[0] ?? null;
      }
      const next = pending.shift() ?? null;
      if (next) session.pendingQuestions.push(next);
      return next;
    },
    answer(question: string, text: string) {
      session.answers[question] = text;
      session.pendingQuestions = session.pendingQuestions.filter(
        (q) => q !== question,
      );
    },
    canAdvanceToPlan() {
      return (
        session.review?.ok === true &&
        session.humanApproval?.approved === true &&
        Boolean(session.candidate)
      );
    },
  };
  return session;
}

export function presentAlternatives(
  session: SpecSession,
  alts: Array<{ id: string; label: string; recommended: boolean }>,
): Array<{ id: string; label: string; recommended: boolean }> {
  session.alternatives = alts;
  return alts;
}

export function presentDesignSection(
  session: SpecSession,
  key: string,
  body: string,
): void {
  session.designSections[key] = body;
}

export async function produceSpecCandidate(
  wz: Workflowz,
  session: SpecSession,
  opts: { model: string; reviewerModel: string; effort?: string },
): Promise<SpecCandidate> {
  wz.phase("Spec");
  const researchBlock = session.research
    ? `\n\nResearch synthesis (source-linked):\n${session.research.text}`
    : "";
  // Only inject revision instructions when prior review failed (not on first draft)
  const revisionBlock =
    session.review && reviewRequiresRevision(session.review)
      ? `\n\nReviewer required revision (rewrite only what blocking items demand):\n${formatRevisionFeedback(session.review)}`
      : "";

  const producer = createStrictAgentCall({
    agentName: "spec-writer",
    model: opts.model,
    effort: opts.effort ?? "ultra",
    schema: {
      type: "object",
      required: ["title", "sections", "sources"],
      additionalProperties: true,
    },
    schemaMode: "strict",
  });

  const raw = (await producer(
    wz,
    `Produce design/spec for: ${session.boundGoal}${researchBlock}\nAnswers: ${JSON.stringify(session.answers)}\nSections so far: ${JSON.stringify(session.designSections)}${revisionBlock}`,
  )) as Record<string, unknown>;

  const candidate: SpecCandidate = {
    title: String(raw.title ?? "Untitled"),
    sections: (raw.sections as Record<string, unknown>) ?? {},
    sources: Array.isArray(raw.sources) ? raw.sources.map(String) : [],
    hash: createHash("sha256")
      .update(JSON.stringify(raw))
      .digest("hex")
      .slice(0, 16),
    producerModel: opts.model,
    reviewerModel: opts.reviewerModel,
  };

  const reviewer = createStrictAgentCall({
    agentName: "spec-reviewer",
    model: opts.reviewerModel,
    effort: "max",
    schema: reviewResultSchema,
    schemaMode: "strict",
  });

  const review = (await reviewer(
    wz,
    `Review candidate spec: ${JSON.stringify(candidate)}`,
  )) as ReviewResult;

  session.candidate = candidate;
  session.review = review;
  candidate.producerModel = opts.model;
  candidate.reviewerModel = opts.reviewerModel;
  return candidate;
}

export function applyReviewToSpec(
  session: SpecSession,
  review: ReviewResult,
): void {
  session.review = review;
}

export async function runSpecGate(
  wz: Workflowz,
  session: SpecSession,
  opts: {
    model: string;
    reviewerModel: string;
    maxAttempts: number;
  },
): Promise<{ review: ReviewResult; attempts: number; candidate: SpecCandidate }> {
  let attempts = 0;
  let lastReview: ReviewResult = {
    ok: false,
    feedback: "not run",
    blocking: ["not run"],
  };
  let candidate: SpecCandidate | undefined;

  while (attempts < opts.maxAttempts) {
    attempts++;
    candidate = await produceSpecCandidate(wz, session, {
      model: opts.model,
      reviewerModel: opts.reviewerModel,
    });
    lastReview = session.review ?? lastReview;
    // PASS → stop immediately; remaining attempts are not mandatory revisions
    if (!reviewRequiresRevision(lastReview)) {
      return { review: lastReview, attempts, candidate };
    }
    // FAIL only → keep review on session so next produce gets revisionBlock
    applyReviewToSpec(session, lastReview);
  }

  return {
    review: lastReview,
    attempts,
    candidate: candidate!,
  };
}
