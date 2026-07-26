/**
 * Fresh command verification on the integration worktree.
 * Model-reported success without process evidence is rejected.
 * Argument-array only — no shell string evaluation.
 */

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

export class VerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationError";
  }
}

export type VerifyCommand = {
  /** Human label: tests | lint | typecheck | build | stack */
  name: string;
  /** argv: [binary, ...args] — never a shell string */
  argv: string[];
};

export type CommandResult = {
  name: string;
  argv: string[];
  cwd: string;
  startedAt: string;
  endedAt: string;
  exitCode: number;
  summary: string;
};

export type FreshVerificationReport = {
  ok: boolean;
  branch: string;
  worktreePath: string;
  ranAt: string;
  results: CommandResult[];
  /** True only when every command was actually executed in-process. */
  processEvidence: true;
  blocking: string[];
};

export type RunFreshVerificationOpts = {
  integrationWorktreePath: string;
  /** Must match current branch of the worktree. */
  expectedBranch: string;
  commands: VerifyCommand[];
  /**
   * Optional clock for tests. Defaults to Date.now ISO.
   * Stale rejection: if provided maxAgeMs and ranAt is older, reject.
   */
  maxAgeMs?: number;
  /** Injected executor for tests. */
  exec?: (
    argv: string[],
    cwd: string,
  ) => { exitCode: number; stdout: string; stderr: string };
  /** Injected branch reader for tests. */
  readBranch?: (cwd: string) => string;
};

function defaultExec(
  argv: string[],
  cwd: string,
): { exitCode: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(argv[0]!, argv.slice(1), {
      cwd,
      encoding: "utf8",
      env: process.env,
    });
    return { exitCode: 0, stdout: String(stdout), stderr: "" };
  } catch (err: unknown) {
    const e = err as {
      status?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      exitCode: e.status ?? 1,
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? e.message ?? ""),
    };
  }
}

function defaultReadBranch(cwd: string): string {
  return execFileSync("git", ["-C", cwd, "branch", "--show-current"], {
    encoding: "utf8",
  }).trim();
}

/**
 * Run project commands on the integration worktree.
 * Rejects wrong-branch, non-zero exits, empty command list, and model-only claims.
 */
export function runFreshVerification(
  opts: RunFreshVerificationOpts,
): FreshVerificationReport {
  if (!opts.commands.length) {
    throw new VerificationError("fresh verification requires at least one command");
  }
  for (const c of opts.commands) {
    if (!c.argv.length || !c.argv[0]) {
      throw new VerificationError(`command ${c.name}: empty argv`);
    }
  }

  if (!existsSync(opts.integrationWorktreePath)) {
    throw new VerificationError(
      `integration worktree missing: ${opts.integrationWorktreePath}`,
    );
  }
  const cwd = realpathSync(resolve(opts.integrationWorktreePath));
  const readBranch = opts.readBranch ?? defaultReadBranch;
  const branch = readBranch(cwd);
  const blocking: string[] = [];

  if (branch !== opts.expectedBranch) {
    blocking.push(
      `wrong-branch: expected ${opts.expectedBranch}, on ${branch || "(detached)"}`,
    );
  }

  const exec = opts.exec ?? defaultExec;
  const results: CommandResult[] = [];
  const ranAt = new Date().toISOString();

  if (blocking.length === 0) {
    for (const cmd of opts.commands) {
      const startedAt = new Date().toISOString();
      const out = exec(cmd.argv, cwd);
      const endedAt = new Date().toISOString();
      const summary = (out.stdout || out.stderr || "").slice(0, 400);
      results.push({
        name: cmd.name,
        argv: [...cmd.argv],
        cwd,
        startedAt,
        endedAt,
        exitCode: out.exitCode,
        summary,
      });
      if (out.exitCode !== 0) {
        blocking.push(
          `${cmd.name} exit ${out.exitCode}: ${summary.slice(0, 120) || cmd.argv.join(" ")}`,
        );
      }
    }
  }

  return {
    ok: blocking.length === 0 && results.length === opts.commands.length,
    branch,
    worktreePath: cwd,
    ranAt,
    results,
    processEvidence: true,
    blocking,
  };
}

/**
 * Reject model-reported "ok" without process evidence envelope.
 */
export function rejectModelOnlyEvidence(claim: unknown): never | void {
  if (
    claim &&
    typeof claim === "object" &&
    (claim as { ok?: boolean }).ok === true &&
    !(claim as { processEvidence?: boolean }).processEvidence &&
    !(claim as { results?: unknown[] }).results
  ) {
    throw new VerificationError(
      "model-reported success without process evidence is rejected",
    );
  }
}

/**
 * Stale verification: report older than maxAgeMs is not reusable for PR.
 */
export function assertFreshReport(
  report: FreshVerificationReport,
  maxAgeMs: number,
  nowMs = Date.now(),
): void {
  const ran = Date.parse(report.ranAt);
  if (Number.isNaN(ran)) {
    throw new VerificationError("verification report missing ranAt");
  }
  if (nowMs - ran > maxAgeMs) {
    throw new VerificationError(
      `stale verification: age ${nowMs - ran}ms > max ${maxAgeMs}ms`,
    );
  }
  if (!report.processEvidence) {
    throw new VerificationError("verification lacks processEvidence");
  }
  if (!report.ok) {
    throw new VerificationError(
      `verification not ok: ${report.blocking.join("; ")}`,
    );
  }
}
