/**
 * Skill attestation guard: unlock role tools only after verified reads.
 *
 * Sequence:
 * controller resolves → hashes → agent gets name+path+hash only →
 * harness_read_skill → re-hash + event → guard verifies → tools unlock
 */

import {
  type SkillRole,
  type SkillResolveOptions,
  resolveSkills,
  skillNamesForRole,
  beadsSkillAttestation,
  rehashFile,
  type ResolvedSkill,
} from "./skills";
import {
  approveSkills,
  createSkillToolState,
  harnessReadSkill,
  type SkillToolState,
  type SkillReadEvent,
} from "./skill-tool";

export class SkillGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillGuardError";
  }
}

export type AgentSkillBrief = {
  name: string;
  path: string;
  expectedSha256: string;
};

export type SkillGuardSession = {
  role: SkillRole;
  required: ResolvedSkill[];
  briefs: AgentSkillBrief[];
  toolState: SkillToolState;
  unlocked: boolean;
  unlockedTools: string[];
  /** Role-specific toolset after unlock */
  roleTools: string[];
};

export type CreateGuardOpts = {
  role: SkillRole;
  skillRoots: SkillResolveOptions;
  roleTools: string[];
  /** Restricted set before unlock */
  restrictedTools?: string[];
  parity?: Parameters<typeof skillNamesForRole>[1];
  stackSkills?: string[];
};

const DEFAULT_RESTRICTED = [
  "harness_read_skill",
  "read", // non-mutating session necessities may be allowed carefully
];

/**
 * Controller: resolve required skills, hash, build agent briefs (no content).
 */
export function createSkillGuardSession(
  opts: CreateGuardOpts,
): SkillGuardSession {
  const names = skillNamesForRole(
    opts.role,
    opts.parity,
    opts.stackSkills ?? [],
  );
  const required = resolveSkills(names, opts.skillRoots);
  // preflight re-hash each file to detect mid-resolve drift
  for (const s of required) {
    const now = rehashFile(s.path);
    if (now !== s.sha256) {
      throw new SkillGuardError(
        `skill ${s.name} changed between resolve and preflight; restart phase`,
      );
    }
  }
  const toolState = createSkillToolState();
  approveSkills(toolState, required);
  const briefs: AgentSkillBrief[] = required.map((s) => ({
    name: s.name,
    path: s.path,
    expectedSha256: s.sha256,
  }));
  return {
    role: opts.role,
    required,
    briefs,
    toolState,
    unlocked: false,
    unlockedTools: opts.restrictedTools ?? [...DEFAULT_RESTRICTED],
    roleTools: opts.roleTools,
  };
}

/** Agent invokes harness_read_skill for each brief. */
export function agentReadRequiredSkills(
  session: SkillGuardSession,
): SkillReadEvent[] {
  const events: SkillReadEvent[] = [];
  for (const b of session.briefs) {
    const { event } = harnessReadSkill(
      session.toolState,
      b.name,
      b.path,
      b.expectedSha256,
    );
    events.push(event);
  }
  return events;
}

/**
 * Verify every required skill has a verified read event matching hash.
 * Claimed-but-unobserved reads fail.
 */
export function verifyAttestation(session: SkillGuardSession): void {
  const observed = new Map(
    session.toolState.reads.map((r) => [r.name, r]),
  );
  for (const s of session.required) {
    const ev = observed.get(s.name);
    if (!ev) {
      throw new SkillGuardError(
        `claimed-but-unobserved skill read: ${s.name}`,
      );
    }
    if (!ev.verified) {
      throw new SkillGuardError(`unverified read event: ${s.name}`);
    }
    if (ev.actualSha256 !== s.sha256) {
      throw new SkillGuardError(
        `hash mismatch after read for ${s.name}; restart phase`,
      );
    }
  }
}

/** Unlock role tools only after full attestation. */
export function unlockRoleTools(session: SkillGuardSession): string[] {
  verifyAttestation(session);
  session.unlocked = true;
  session.unlockedTools = [...session.roleTools];
  return session.unlockedTools;
}

export function assertToolsUnlocked(
  session: SkillGuardSession,
  tool: string,
): void {
  if (!session.unlocked) {
    throw new SkillGuardError(
      `tool ${tool} locked until skill attestation completes`,
    );
  }
  if (!session.unlockedTools.includes(tool)) {
    throw new SkillGuardError(`tool ${tool} not in role toolset`);
  }
}

/** Beads notes: path/hash/version only. */
export function attestationForBeads(session: SkillGuardSession) {
  return beadsSkillAttestation(session.required);
}

/**
 * Full sequence helper used by parent/lane entry.
 */
export function attestAndUnlock(opts: CreateGuardOpts): SkillGuardSession {
  const session = createSkillGuardSession(opts);
  agentReadRequiredSkills(session);
  unlockRoleTools(session);
  return session;
}
