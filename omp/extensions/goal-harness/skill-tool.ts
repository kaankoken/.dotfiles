/**
 * Narrow tool: harness_read_skill(name, path, expectedSha256)
 * Read-only. Only preflight-approved canonical SKILL.md paths.
 */

import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import type { ResolvedSkill } from "./skills";

export class SkillToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillToolError";
  }
}

export type ApprovedSkillEntry = {
  name: string;
  path: string;
  expectedSha256: string;
};

export type SkillReadEvent = {
  name: string;
  path: string;
  expectedSha256: string;
  actualSha256: string;
  bytes: number;
  at: string;
  verified: true;
};

export type SkillToolState = {
  approved: Map<string, ApprovedSkillEntry>;
  reads: SkillReadEvent[];
};

export function createSkillToolState(
  approved: ApprovedSkillEntry[] = [],
): SkillToolState {
  const map = new Map<string, ApprovedSkillEntry>();
  for (const a of approved) {
    map.set(a.name, a);
  }
  return { approved: map, reads: [] };
}

export function approveSkills(
  state: SkillToolState,
  skills: ResolvedSkill[],
): void {
  for (const s of skills) {
    state.approved.set(s.name, {
      name: s.name,
      path: s.path,
      expectedSha256: s.sha256,
    });
  }
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * harness_read_skill — complete current bytes only if preflight-approved
 * and hash matches before and after read.
 */
export function harnessReadSkill(
  state: SkillToolState,
  name: string,
  path: string,
  expectedSha256: string,
): { content: string; event: SkillReadEvent } {
  if (!name || !path || !expectedSha256) {
    throw new SkillToolError("harness_read_skill: name, path, expectedSha256 required");
  }
  // No write capability — reject any path that looks like a write target abuse
  if (path.includes("\0")) {
    throw new SkillToolError("harness_read_skill: invalid path");
  }

  const approved = state.approved.get(name);
  if (!approved) {
    throw new SkillToolError(
      `harness_read_skill: skill ${name} not preflight-approved`,
    );
  }

  let real: string;
  let approvedReal: string;
  try {
    real = realpathSync(path);
    approvedReal = realpathSync(approved.path);
  } catch {
    throw new SkillToolError(`harness_read_skill: unreadable path ${path}`);
  }

  if (real !== approvedReal) {
    throw new SkillToolError(
      `harness_read_skill: path not approved for ${name}`,
    );
  }

  if (expectedSha256 !== approved.expectedSha256) {
    throw new SkillToolError(
      `harness_read_skill: expectedSha256 mismatch for ${name}`,
    );
  }

  let buf: Buffer;
  try {
    buf = readFileSync(real);
  } catch {
    throw new SkillToolError(`harness_read_skill: unreadable ${real}`);
  }

  const before = sha256(buf);
  if (before !== expectedSha256) {
    throw new SkillToolError(
      `harness_read_skill: content changed before read for ${name} (preflight hash stale)`,
    );
  }

  // re-read / re-hash (changed-during-read)
  let buf2: Buffer;
  try {
    buf2 = readFileSync(real);
  } catch {
    throw new SkillToolError(`harness_read_skill: unreadable during rehash ${real}`);
  }
  const after = sha256(buf2);
  if (after !== before) {
    throw new SkillToolError(
      `harness_read_skill: content changed during read for ${name}`,
    );
  }

  const event: SkillReadEvent = {
    name,
    path: real,
    expectedSha256,
    actualSha256: after,
    bytes: buf2.length,
    at: new Date().toISOString(),
    verified: true,
  };
  state.reads.push(event);
  return { content: buf2.toString("utf8"), event };
}

/** Tool has no write methods — explicit API surface. */
export const HARNESS_READ_SKILL_TOOL = {
  name: "harness_read_skill" as const,
  description:
    "Read a preflight-approved Superpowers SKILL.md. Args: name, path, expectedSha256. Read-only.",
  invoke: harnessReadSkill,
};
