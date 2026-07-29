/**
 * Pure durable harness phase transition table.
 * No OMP, git, or Beads imports — caller supplies durable snapshots.
 */

export const PHASE_ORDER = [
  "Init",
  "Research",
  "Spec",
  "Plan",
  "BiteSize",
  "Implement",
  "Integration",
  "Milestone",
  "PR",
] as const;

export type PhaseName = (typeof PHASE_ORDER)[number];

export type GateName = "Spec" | "Plan" | "BiteSize" | "Milestone";

/**
 * Max produce→review attempts per gate (ceiling). First PASS ends the gate;
 * rewrites run only on reviewer FAIL — budgets are not mandatory revision quotas.
 */
export const GATE_BUDGETS: Record<GateName, number> = {
  Spec: 3,
  Plan: 3,
  BiteSize: 2,
  Milestone: 3,
};

export type MachineStatus =
  | "ready"
  | "in_phase"
  | "awaiting_producer"
  | "blocked"
  | "done";

export type DurableSnapshot = {
  kind: "durable-harness-snapshot";
  runId: string;
  boundGoal: string;
  phase: PhaseName;
  completed: PhaseName[];
  gateAttempts: Partial<Record<GateName, number>>;
  status: MachineStatus;
  lastFeedback?: string;
  requiresUserInput: boolean;
};

export type Transition =
  | { type: "begin"; phase: PhaseName }
  | { type: "complete"; phase: PhaseName }
  | { type: "gate_pass"; gate: GateName }
  | { type: "gate_fail"; gate: GateName; feedback: string };

const GATED: Set<string> = new Set(["Spec", "Plan", "BiteSize", "Milestone"]);

function phaseIndex(p: PhaseName): number {
  return PHASE_ORDER.indexOf(p);
}

function predecessorsDone(snap: DurableSnapshot, phase: PhaseName): boolean {
  const idx = phaseIndex(phase);
  if (idx < 0) return false;
  for (let i = 0; i < idx; i++) {
    if (!snap.completed.includes(PHASE_ORDER[i])) return false;
  }
  return true;
}

export function createInitialSnapshot(
  runId: string,
  boundGoal: string,
): DurableSnapshot {
  return {
    kind: "durable-harness-snapshot",
    runId,
    boundGoal,
    phase: "Init",
    completed: [],
    gateAttempts: {},
    status: "ready",
    requiresUserInput: false,
  };
}

export function canBeginPhase(
  snap: DurableSnapshot,
  phase: PhaseName,
): boolean {
  if (snap.status === "blocked" || snap.status === "done") return false;
  if (snap.completed.includes(phase)) return false;
  return predecessorsDone(snap, phase);
}

function assertNotBlocked(snap: DurableSnapshot): void {
  if (snap.status === "blocked") {
    throw new Error("phase machine blocked — requires user input");
  }
}

function nextPhase(phase: PhaseName): PhaseName | "Done" {
  const i = phaseIndex(phase);
  if (i < 0 || i >= PHASE_ORDER.length - 1) return "Done";
  return PHASE_ORDER[i + 1];
}

export function applyTransition(
  snap: DurableSnapshot,
  t: Transition,
): DurableSnapshot {
  assertNotBlocked(snap);
  const s: DurableSnapshot = {
    ...snap,
    completed: [...snap.completed],
    gateAttempts: { ...snap.gateAttempts },
  };

  if (t.type === "begin") {
    if (!canBeginPhase(s, t.phase)) {
      throw new Error(
        `cannot begin ${t.phase}: predecessor incomplete or already completed`,
      );
    }
    if (s.phase !== t.phase && !predecessorsDone(s, t.phase)) {
      throw new Error(`cannot begin ${t.phase}: wrong order`);
    }
    // Allow begin only on current phase or when ready to start it
    if (
      s.completed.length > 0 &&
      phaseIndex(t.phase) !== s.completed.length
    ) {
      // first incomplete must match
      const expected = PHASE_ORDER[s.completed.length];
      if (t.phase !== expected) {
        throw new Error(
          `cannot begin ${t.phase}: expected ${expected} in order`,
        );
      }
    }
    if (s.completed.length === 0 && t.phase !== "Init") {
      throw new Error(`cannot begin ${t.phase}: expected Init first`);
    }
    s.phase = t.phase;
    s.status = "in_phase";
    s.requiresUserInput = false;
    return s;
  }

  if (t.type === "complete") {
    if (!predecessorsDone(s, t.phase) && t.phase !== "Init") {
      // Init has no predecessors
      if (phaseIndex(t.phase) > 0) {
        throw new Error(
          `cannot complete ${t.phase}: predecessor not done`,
        );
      }
    }
    // Must complete in order: this phase must be the next incomplete
    const expected = PHASE_ORDER[s.completed.length];
    if (t.phase !== expected) {
      throw new Error(
        `cannot complete ${t.phase}: order requires ${expected}`,
      );
    }
    if (GATED.has(t.phase)) {
      throw new Error(
        `cannot complete gated phase ${t.phase} without gate_pass`,
      );
    }
    s.completed.push(t.phase);
    const n = nextPhase(t.phase);
    if (n === "Done") {
      s.status = "done";
      s.requiresUserInput = false;
      return s;
    }
    s.phase = n;
    s.status = "ready";
    s.requiresUserInput = false;
    return s;
  }

  if (t.type === "gate_pass") {
    const gate = t.gate;
    if (!GATED.has(gate)) throw new Error(`not a gate: ${gate}`);
    const expected = PHASE_ORDER[s.completed.length];
    if (expected !== gate) {
      throw new Error(
        `cannot gate_pass ${gate}: order requires ${expected}`,
      );
    }
    s.completed.push(gate);
    s.gateAttempts[gate] = s.gateAttempts[gate] ?? 0;
    const n = nextPhase(gate);
    if (n === "Done") {
      s.status = "done";
      return s;
    }
    s.phase = n;
    s.status = "ready";
    s.lastFeedback = undefined;
    s.requiresUserInput = false;
    return s;
  }

  if (t.type === "gate_fail") {
    const gate = t.gate;
    if (!GATED.has(gate)) throw new Error(`not a gate: ${gate}`);
    const expected = PHASE_ORDER[s.completed.length];
    if (expected !== gate && s.phase !== gate) {
      throw new Error(
        `cannot gate_fail ${gate}: not current gate (expected ${expected})`,
      );
    }
    const budget = GATE_BUDGETS[gate];
    const attempts = (s.gateAttempts[gate] ?? 0) + 1;
    s.gateAttempts[gate] = attempts;
    s.lastFeedback = t.feedback;
    s.phase = gate;
    if (attempts >= budget) {
      s.status = "blocked";
      s.requiresUserInput = true;
    } else {
      s.status = "awaiting_producer";
      s.requiresUserInput = false;
    }
    return s;
  }

  throw new Error("unknown transition");
}

export function restoreFromSnapshot(raw: unknown): DurableSnapshot {
  if (!raw || typeof raw !== "object") {
    throw new Error("restore requires durable snapshot object");
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== "durable-harness-snapshot") {
    throw new Error(
      "restore rejected: not a durable-harness-snapshot (chat/compaction text is invalid)",
    );
  }
  if (typeof o.runId !== "string" || typeof o.boundGoal !== "string") {
    throw new Error("restore rejected: incomplete durable snapshot");
  }
  if (!Array.isArray(o.completed)) {
    throw new Error("restore rejected: completed must be array");
  }
  return {
    kind: "durable-harness-snapshot",
    runId: o.runId,
    boundGoal: o.boundGoal,
    phase: o.phase as PhaseName,
    completed: o.completed as PhaseName[],
    gateAttempts: (o.gateAttempts as DurableSnapshot["gateAttempts"]) ?? {},
    status: (o.status as MachineStatus) ?? "ready",
    lastFeedback: o.lastFeedback as string | undefined,
    requiresUserInput: Boolean(o.requiresUserInput),
  };
}
