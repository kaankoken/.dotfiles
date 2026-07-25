/**
 * Implementer evidence collection + post-validation against independent git/Beads facts.
 * Model-reported `ok` is never authoritative.
 */

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import {
  validateImplementerEvidence,
  type GitFacts,
  type BeadsFacts,
} from "./validation";
import { implementerEvidenceSchema } from "./schemas";

export { implementerEvidenceSchema };
export const IMPLEMENTER_EVIDENCE_SCHEMA = implementerEvidenceSchema;

export type CommandEvidence = {
  command: string;
  exitCode: number;
  summary: string;
};

export type ImplementerEvidenceEnvelope = {
  issueId: string;
  branch: string;
  worktreePath: string;
  headSha: string;
  changedFiles: string[];
  red: CommandEvidence;
  green: CommandEvidence;
  notes: string;
};

export type EvidenceValidation = {
  ok: boolean;
  reason?: string;
  value?: unknown;
};

export class EvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceError";
  }
}

/** Query live git facts from a worktree path (independent of model claims). */
export function queryGitFacts(worktreePath: string): GitFacts {
  const cwd = realpathSync(worktreePath);
  const run = (...args: string[]) =>
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
  const branch = run("branch", "--show-current");
  const headSha = run("rev-parse", "HEAD");
  // Prefer files changed vs merge-base with integration if available; else status
  let changedFiles: string[] = [];
  try {
    const diff = run("diff", "--name-only", "HEAD~1..HEAD");
    changedFiles = diff
      ? diff.split("\n").map((s) => s.trim()).filter(Boolean)
      : [];
  } catch {
    changedFiles = [];
  }
  if (changedFiles.length === 0) {
    const st = run("status", "--porcelain");
    changedFiles = st
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
  }
  return { branch, worktreePath: cwd, headSha, changedFiles };
}

export function queryBeadsFacts(issueId: string): BeadsFacts {
  return { issueId };
}

/**
 * Post-validate reported envelope against independently queried facts.
 * Never trusts model ok field (schema may omit it).
 */
export function postValidateEvidence(
  reported: unknown,
  git: GitFacts,
  beads: BeadsFacts,
): EvidenceValidation {
  const result = validateImplementerEvidence(reported, git, beads);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  // Additional TDD checks on red/green
  const env = reported as ImplementerEvidenceEnvelope;
  if (!env.red?.command || env.red.exitCode === 0) {
    // RED should demonstrate failure before fix; exit 0 is suspicious for RED
    // Allow non-zero only requirement: red must be task-relevant failure
    if (env.red?.exitCode === 0) {
      return {
        ok: false,
        reason: "red evidence must be a failing executable check (exit != 0)",
      };
    }
  }
  if (env.green?.exitCode !== 0) {
    return { ok: false, reason: "green evidence must exit 0" };
  }
  return { ok: true, value: reported };
}

/** Require BASE_SHA recorded before any edit evidence is accepted. */
export function assertBaseShaBeforeEdit(
  baseSha: string | undefined,
  headBeforeEdit: string,
): void {
  if (!baseSha || !/^[0-9a-f]{7,40}$/i.test(baseSha)) {
    throw new EvidenceError("BASE_SHA required before edit");
  }
  if (baseSha !== headBeforeEdit) {
    throw new EvidenceError(
      `BASE_SHA ${baseSha.slice(0, 8)} must match clean baseline HEAD ${headBeforeEdit.slice(0, 8)}`,
    );
  }
}

export function assertCleanBaseline(worktreePath: string): void {
  const cwd = realpathSync(worktreePath);
  const st = execFileSync("git", ["-C", cwd, "status", "--porcelain"], {
    encoding: "utf8",
  }).trim();
  if (st.length > 0) {
    throw new EvidenceError("baseline is dirty; refusing implementer start");
  }
}

export function collectCommandEvidence(
  command: string,
  exitCode: number,
  summary: string,
): CommandEvidence {
  if (!command) throw new EvidenceError("empty command evidence");
  return { command, exitCode, summary };
}
