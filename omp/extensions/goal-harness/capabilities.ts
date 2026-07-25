/**
 * Pure phase capability manifests — no filesystem, no OMP handlers.
 * Minimum allowlist per phase/role for the soft sandbox.
 */

import phaseCapabilitiesSchema from "../../schemas/phase-capabilities.schema.json";

export const PHASE_CAPABILITIES_SCHEMA = phaseCapabilitiesSchema;

export type HarnessPhase =
  | "Init"
  | "Research"
  | "Spec"
  | "Plan"
  | "BiteSize"
  | "Implement"
  | "Integration"
  | "Milestone"
  | "PR";

export type CapabilityOp =
  | "fs.read.repo"
  | "fs.write.lane"
  | "fs.write.runTemp"
  | "fs.write.integration"
  | "fs.write.migrationTarget"
  | "bd.read"
  | "bd.write.controller"
  | "git.read"
  | "git.write.lane"
  | "git.write.integration"
  | "git.push"
  | "gh.pr"
  | "cli.execute"
  | "skill.read"
  | "network.fetch";

export type NetworkMode = "none" | "read-only-docs" | "full";

export type CanonicalRoots = {
  repo: string;
  worktree: string;
  runTemp: string;
  integration?: string;
  migrationTargets?: string[];
};

export type PhaseCapabilityManifest = {
  phase: HarnessPhase;
  agent: string;
  runId: string;
  issueId: string;
  canonicalRoots: CanonicalRoots;
  network: { mode: NetworkMode; allowedHosts?: string[] };
  operations: CapabilityOp[];
};

export class CapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityError";
  }
}

const ALL_OPS: CapabilityOp[] = [
  "fs.read.repo",
  "fs.write.lane",
  "fs.write.runTemp",
  "fs.write.integration",
  "fs.write.migrationTarget",
  "bd.read",
  "bd.write.controller",
  "git.read",
  "git.write.lane",
  "git.write.integration",
  "git.push",
  "gh.pr",
  "cli.execute",
  "skill.read",
  "network.fetch",
];

const PHASES: HarnessPhase[] = [
  "Init",
  "Research",
  "Spec",
  "Plan",
  "BiteSize",
  "Implement",
  "Integration",
  "Milestone",
  "PR",
];

/** Phase → minimum operations (matrix). */
const PHASE_OPS: Record<HarnessPhase, CapabilityOp[]> = {
  Init: ["fs.read.repo", "bd.read", "bd.write.controller", "cli.execute", "skill.read"],
  Research: [
    "fs.read.repo",
    "bd.read",
    "cli.execute",
    "skill.read",
    "network.fetch",
  ],
  Spec: [
    "fs.read.repo",
    "bd.read",
    "bd.write.controller",
    "cli.execute",
    "skill.read",
  ],
  Plan: [
    "fs.read.repo",
    "bd.read",
    "bd.write.controller",
    "cli.execute",
    "skill.read",
  ],
  BiteSize: [
    "fs.read.repo",
    "bd.read",
    "bd.write.controller",
    "cli.execute",
    "skill.read",
  ],
  Implement: [
    "fs.read.repo",
    "fs.write.lane",
    "fs.write.runTemp",
    "bd.read",
    "git.read",
    "git.write.lane",
    "cli.execute",
    "skill.read",
  ],
  Integration: [
    "fs.read.repo",
    "fs.write.integration",
    "bd.read",
    "bd.write.controller",
    "git.read",
    "git.write.integration",
    "cli.execute",
    "skill.read",
  ],
  Milestone: [
    "fs.read.repo",
    "bd.read",
    "bd.write.controller",
    "git.read",
    "cli.execute",
    "skill.read",
  ],
  PR: [
    "fs.read.repo",
    "bd.read",
    "bd.write.controller",
    "git.read",
    "git.push",
    "gh.pr",
    "cli.execute",
    "skill.read",
    "network.fetch",
  ],
};

export type BuildCapabilityInput = {
  phase: HarnessPhase;
  agent: string;
  runId: string;
  issueId?: string;
  canonicalRoots: CanonicalRoots;
  /** Controller-only Beads writes */
  controller?: boolean;
  /** Explicit migration-target writes (dotfiles/shared stack) */
  migrationWrite?: boolean;
  networkMode?: NetworkMode;
  allowedHosts?: string[];
};

/**
 * Pure builder: minimum allowlist for one phase/role.
 * Does not inspect filesystem or register handlers.
 */
export function buildPhaseCapabilities(
  input: BuildCapabilityInput,
): PhaseCapabilityManifest {
  if (!PHASES.includes(input.phase)) {
    throw new CapabilityError(`unknown phase: ${input.phase}`);
  }
  if (!input.agent) throw new CapabilityError("agent required");
  if (!input.runId) throw new CapabilityError("runId required");
  const roots = input.canonicalRoots;
  if (!roots?.repo || !roots?.worktree || !roots?.runTemp) {
    throw new CapabilityError("canonicalRoots.repo/worktree/runTemp required");
  }

  let ops = [...PHASE_OPS[input.phase]];

  // Non-writing phases: no lane/integration writes (already in matrix)
  // Controller-scoped Beads writes only when controller
  if (!input.controller) {
    ops = ops.filter((o) => o !== "bd.write.controller");
  } else if (!ops.includes("bd.write.controller")) {
    // controller may need write in phases that normally don't — only if parent
    // explicitly requests controller in writing-control phases
    if (
      ["Init", "Spec", "Plan", "BiteSize", "Integration", "Milestone", "PR"].includes(
        input.phase,
      )
    ) {
      ops.push("bd.write.controller");
    }
  }

  // Migration targets only when explicitly enabled
  if (input.migrationWrite) {
    if (!roots.migrationTargets?.length) {
      throw new CapabilityError(
        "migrationWrite requires canonicalRoots.migrationTargets",
      );
    }
    if (!ops.includes("fs.write.migrationTarget")) {
      ops.push("fs.write.migrationTarget");
    }
  }

  // Push/PR only during PR phase (matrix already enforces; double-check)
  if (input.phase !== "PR") {
    ops = ops.filter((o) => o !== "git.push" && o !== "gh.pr");
  }

  const networkMode =
    input.networkMode ??
    (input.phase === "Research" || input.phase === "PR"
      ? "read-only-docs"
      : "none");

  const manifest: PhaseCapabilityManifest = {
    phase: input.phase,
    agent: input.agent,
    runId: input.runId,
    issueId: input.issueId ?? "",
    canonicalRoots: { ...roots },
    network: {
      mode: networkMode,
      ...(input.allowedHosts ? { allowedHosts: [...input.allowedHosts] } : {}),
    },
    operations: [...new Set(ops)],
  };

  validatePhaseCapabilities(manifest);
  return manifest;
}

/** Strict validation: required fields, no unknown, ops in phase matrix. */
export function validatePhaseCapabilities(
  manifest: unknown,
): asserts manifest is PhaseCapabilityManifest {
  if (!manifest || typeof manifest !== "object") {
    throw new CapabilityError("manifest not object");
  }
  const m = manifest as Record<string, unknown>;
  const required = [
    "phase",
    "agent",
    "runId",
    "issueId",
    "canonicalRoots",
    "network",
    "operations",
  ];
  for (const k of Object.keys(m)) {
    if (!required.includes(k)) {
      throw new CapabilityError(`unknown field: ${k}`);
    }
  }
  for (const k of required) {
    if (!(k in m)) throw new CapabilityError(`missing field: ${k}`);
  }
  if (!PHASES.includes(m.phase as HarnessPhase)) {
    throw new CapabilityError(`invalid phase: ${m.phase}`);
  }
  if (typeof m.agent !== "string" || !m.agent) {
    throw new CapabilityError("bad agent");
  }
  if (typeof m.runId !== "string" || !m.runId) {
    throw new CapabilityError("bad runId");
  }
  if (typeof m.issueId !== "string") {
    throw new CapabilityError("bad issueId");
  }
  const roots = m.canonicalRoots as Record<string, unknown>;
  if (!roots || typeof roots !== "object") {
    throw new CapabilityError("bad canonicalRoots");
  }
  for (const k of Object.keys(roots)) {
    if (
      !["repo", "worktree", "runTemp", "integration", "migrationTargets"].includes(
        k,
      )
    ) {
      throw new CapabilityError(`unknown canonicalRoots field: ${k}`);
    }
  }
  if (typeof roots.repo !== "string" || !roots.repo) {
    throw new CapabilityError("canonicalRoots.repo required");
  }
  if (typeof roots.worktree !== "string" || !roots.worktree) {
    throw new CapabilityError("canonicalRoots.worktree required");
  }
  if (typeof roots.runTemp !== "string" || !roots.runTemp) {
    throw new CapabilityError("canonicalRoots.runTemp required");
  }
  const net = m.network as Record<string, unknown>;
  if (!net || typeof net !== "object" || typeof net.mode !== "string") {
    throw new CapabilityError("bad network");
  }
  if (!["none", "read-only-docs", "full"].includes(net.mode as string)) {
    throw new CapabilityError(`invalid network.mode: ${net.mode}`);
  }
  if (!Array.isArray(m.operations) || m.operations.length === 0) {
    throw new CapabilityError("operations required");
  }
  const phase = m.phase as HarnessPhase;
  const allowed = new Set(PHASE_OPS[phase]);
  // migration and controller may be added
  allowed.add("fs.write.migrationTarget");
  allowed.add("bd.write.controller");
  for (const op of m.operations as string[]) {
    if (!ALL_OPS.includes(op as CapabilityOp)) {
      throw new CapabilityError(`unknown operation: ${op}`);
    }
    // push/pr only in PR
    if (
      (op === "git.push" || op === "gh.pr") &&
      phase !== "PR"
    ) {
      throw new CapabilityError(
        `capability ${op} outside phase matrix for ${phase}`,
      );
    }
    if (
      !allowed.has(op as CapabilityOp) &&
      op !== "fs.write.migrationTarget" &&
      op !== "bd.write.controller"
    ) {
      // ops not in base phase set
      if (!PHASE_OPS[phase].includes(op as CapabilityOp)) {
        throw new CapabilityError(
          `capability ${op} outside phase matrix for ${phase}`,
        );
      }
    }
  }
}

export function isWritePhase(phase: HarnessPhase): boolean {
  return ["Implement", "Integration", "PR"].includes(phase);
}
