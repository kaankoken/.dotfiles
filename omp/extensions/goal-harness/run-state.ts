/** Durable harness run graph (in-memory + beads-backed via broker). */

export const PHASE_ORDER = [
  "Research",
  "Spec",
  "Plan",
  "BiteSize",
  "Implement",
  "Integration",
  "Milestone",
  "PR",
] as const;

export type PhaseName = (typeof PHASE_ORDER)[number] | "Done";

export type SkillAttestation = {
  name: string;
  path: string;
  sha256: string;
};

export type PhaseRecord = {
  issueId: string;
  status: "open" | "in_progress" | "done" | "blocked";
  artifact?: unknown;
};

export type TaskRecord = {
  issueId: string;
  title: string;
  dependsOn: string[];
  claimedBy?: string;
  laneId?: string;
  status: "open" | "claimed" | "integrated" | "blocked" | "closed";
  red?: unknown;
  green?: unknown;
  review?: unknown;
};

export type IntegrationRecord = {
  issueId: string;
  sourceSha: string;
  integratedSha: string;
  at: string;
};

export type RunState = {
  runId: string;
  epicId: string;
  boundGoal: string;
  phase: PhaseName;
  phases: Partial<Record<(typeof PHASE_ORDER)[number], PhaseRecord>>;
  modelRoutes: Record<string, unknown>;
  skillManifest: SkillAttestation[];
  humanSpecApproval: { approvedAt: string; approver: string } | null;
  tasks: TaskRecord[];
  integrations: IntegrationRecord[];
  milestone: {
    verifiedAt: string;
    evidence: unknown;
  } | null;
  prUrl: string | null;
};

export function emptyRunState(runId: string, boundGoal: string): RunState {
  return {
    runId,
    epicId: "",
    boundGoal,
    phase: "Research",
    phases: {},
    modelRoutes: {},
    skillManifest: [],
    humanSpecApproval: null,
    tasks: [],
    integrations: [],
    milestone: null,
    prUrl: null,
  };
}

export function assertPhaseOrder(
  state: RunState,
  next: (typeof PHASE_ORDER)[number],
): void {
  const idx = PHASE_ORDER.indexOf(next);
  if (idx < 0) throw new Error(`unknown phase ${next}`);
  for (let i = 0; i < idx; i++) {
    const prev = PHASE_ORDER[i];
    const rec = state.phases[prev];
    if (!rec || rec.status !== "done") {
      throw new Error(
        `cannot start ${next}: prior phase ${prev} not done (status=${rec?.status ?? "missing"})`,
      );
    }
  }
}
