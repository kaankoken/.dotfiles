/**
 * Human approval gate for Spec (and similar) — parent/controller only.
 * Background agents cannot self-approve. Headless without auditable input is blocked.
 */

import { createHash } from "node:crypto";
import type { SpecSession } from "../../workflows/spec";

export type HumanApprovalRecord = {
  approved: boolean;
  actor: string;
  at: string;
  specHash: string;
};

export type HumanGateDeps = {
  interactive: boolean;
  /** Explicit auditable approval (e.g. CI human-provided JSON). */
  explicitApproval?: HumanApprovalRecord;
  approve?: () => Promise<{ approved: boolean; actor: string; at: string }>;
  /** Must run before session is marked approved (Beads first). */
  writeBeadsApproval?: (rec: HumanApprovalRecord) => Promise<void>;
};

export type HumanGate = {
  interactive: boolean;
  requestApproval(session: SpecSession): Promise<HumanApprovalRecord>;
};

const AGENT_ACTOR = /^(agent:|bot:|system:|background:)/i;

export function createHumanGate(deps: HumanGateDeps): HumanGate {
  return {
    interactive: deps.interactive,
    async requestApproval(session: SpecSession) {
      return requestHumanApproval(
        {
          interactive: deps.interactive,
          explicitApproval: deps.explicitApproval,
          approve: deps.approve,
          writeBeadsApproval: deps.writeBeadsApproval,
        },
        session,
      );
    },
  };
}

export async function requestHumanApproval(
  deps: HumanGateDeps,
  session: SpecSession,
): Promise<HumanApprovalRecord> {
  if (!session.review || session.review.ok !== true) {
    throw new Error("human-gate: reviewer has not PASSed");
  }
  if (!session.candidate) {
    throw new Error("human-gate: no spec candidate");
  }

  const specHash =
    session.candidate.hash ||
    createHash("sha256")
      .update(JSON.stringify(session.candidate))
      .digest("hex")
      .slice(0, 16);

  let actor: string;
  let at: string;
  let approved: boolean;

  if (deps.explicitApproval) {
    approved = deps.explicitApproval.approved;
    actor = deps.explicitApproval.actor;
    at = deps.explicitApproval.at;
  } else if (!deps.interactive) {
    throw new Error(
      "human-gate blocked: headless/no-UI requires explicit auditable approval input",
    );
  } else if (deps.approve) {
    const ans = await deps.approve();
    approved = ans.approved;
    actor = ans.actor;
    at = ans.at;
  } else {
    throw new Error("human-gate: no approval path configured");
  }

  if (AGENT_ACTOR.test(actor) || actor.includes("spec-writer")) {
    throw new Error(
      "human-gate: background agent cannot self-approve (actor must be human)",
    );
  }

  if (!approved) {
    throw new Error("human-gate: human rejected the spec");
  }

  const rec: HumanApprovalRecord = {
    approved: true,
    actor,
    at,
    specHash,
  };

  // Beads first — before mutating session advance flag
  if (deps.writeBeadsApproval) {
    await deps.writeBeadsApproval(rec);
  }

  session.humanApproval = rec;
  return rec;
}
