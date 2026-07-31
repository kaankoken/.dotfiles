/**
 * Pure design-flow phase table. No OMP/git/bd imports.
 */

export const DESIGN_PHASE_ORDER = [
  "Intake",
  "Pdr",
  "Arc42",
  "Adr",
  "Handoff",
] as const;

export type DesignPhaseName = (typeof DESIGN_PHASE_ORDER)[number];

export type DesignGateName = "Pdr" | "Arc42";

export const DESIGN_GATE_BUDGETS: Record<DesignGateName, number> = {
  Pdr: 2,
  Arc42: 2,
};

export type DesignMachineStatus =
  | "ready"
  | "in_phase"
  | "awaiting_review"
  | "done"
  | "failed";

export type DesignSnapshot = {
  runId: string;
  boundGoal: string;
  status: DesignMachineStatus;
  phase: DesignPhaseName;
  completed: DesignPhaseName[];
  gateAttempts: Partial<Record<DesignGateName, number>>;
  lastError?: string;
};

export type DesignTransition =
  | { type: "begin"; phase: DesignPhaseName }
  | { type: "complete"; phase: DesignPhaseName }
  | { type: "gate_pass"; gate: DesignGateName }
  | { type: "gate_fail"; gate: DesignGateName; feedback: string }
  | { type: "fail"; reason: string };

function phaseIndex(p: DesignPhaseName): number {
  return DESIGN_PHASE_ORDER.indexOf(p);
}

function predecessorsDone(
  snap: DesignSnapshot,
  phase: DesignPhaseName,
): boolean {
  const idx = phaseIndex(phase);
  for (let i = 0; i < idx; i++) {
    if (!snap.completed.includes(DESIGN_PHASE_ORDER[i]!)) return false;
  }
  return true;
}

export function createInitialDesignSnapshot(
  runId: string,
  boundGoal: string,
): DesignSnapshot {
  return {
    runId,
    boundGoal,
    status: "ready",
    phase: "Intake",
    completed: [],
    gateAttempts: {},
  };
}

export function applyDesignTransition(
  snap: DesignSnapshot,
  t: DesignTransition,
): DesignSnapshot {
  if (snap.status === "done" || snap.status === "failed") {
    throw new Error(`design machine terminal (${snap.status})`);
  }
  const s: DesignSnapshot = {
    ...snap,
    completed: [...snap.completed],
    gateAttempts: { ...snap.gateAttempts },
  };

  if (t.type === "fail") {
    return { ...s, status: "failed", lastError: t.reason };
  }

  if (t.type === "begin") {
    if (s.completed.includes(t.phase)) {
      throw new Error(`cannot begin ${t.phase}: already completed`);
    }
    if (!predecessorsDone(s, t.phase)) {
      throw new Error(`cannot begin ${t.phase}: predecessor incomplete`);
    }
    const expected = DESIGN_PHASE_ORDER[s.completed.length];
    if (t.phase !== expected) {
      throw new Error(`cannot begin ${t.phase}: expected ${expected}`);
    }
    return { ...s, status: "in_phase", phase: t.phase };
  }

  if (t.type === "complete") {
    if (s.phase !== t.phase) {
      throw new Error(`cannot complete ${t.phase}: current is ${s.phase}`);
    }
    if (!s.completed.includes(t.phase)) s.completed.push(t.phase);
    if (t.phase === "Handoff") {
      return { ...s, status: "done", phase: "Handoff" };
    }
    return { ...s, status: "ready" };
  }

  if (t.type === "gate_pass") {
    const phase = t.gate;
    if (!s.completed.includes(phase)) s.completed.push(phase);
    s.gateAttempts[t.gate] = (s.gateAttempts[t.gate] ?? 0) + 1;
    return { ...s, status: "ready", phase };
  }

  // gate_fail
  const attempts = (s.gateAttempts[t.gate] ?? 0) + 1;
  s.gateAttempts[t.gate] = attempts;
  const budget = DESIGN_GATE_BUDGETS[t.gate];
  if (attempts >= budget) {
    return {
      ...s,
      status: "failed",
      lastError: `${t.gate} failed after ${attempts}: ${t.feedback}`,
    };
  }
  return {
    ...s,
    status: "awaiting_review",
    phase: t.gate,
    lastError: t.feedback,
  };
}
