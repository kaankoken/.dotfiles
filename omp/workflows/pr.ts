/**
 * Current-project PR delivery policy.
 * Only PR phase may push / gh pr create for recorded integration branch.
 * No force flags. No partner-repo discovery.
 */

import { execFileSync } from "node:child_process";
import {
  assertFreshReport,
  type FreshVerificationReport,
} from "../extensions/goal-harness/verification";
import { PROTECTED_BRANCHES, assertNoForceOrRewrite } from "../extensions/goal-harness/git";

export class PrPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrPolicyError";
  }
}

export type PrPreconditions = {
  remote: string | null;
  /** User/org authority to open PR (injected policy). */
  hasAuthority: boolean;
  verification: FreshVerificationReport | null;
  verificationMaxAgeMs?: number;
  unresolvedConflicts: string[];
  openBlockingIssues: string[];
  integrationBranch: string;
  /** Repo/remote identity recorded on the harness run. */
  runRepoRemote: string;
  /** Actual current remote URL or name for the push target. */
  actualRepoRemote: string;
  /** Spec/Plan/BiteSize Beads IDs required in body. */
  specIssueId: string | null;
  planIssueId: string | null;
  biteSizeIssueIds: string[];
  completedTaskIds: string[];
  boundGoal: string;
  reviewSummary: string;
  /** Working tree path for git/gh. */
  integrationWorktreePath: string;
};

export type PrCreateResult = {
  url: string;
  branch: string;
  body: string;
  pushed: boolean;
};

export type PrExec = (
  argv: string[],
  cwd: string,
) => { exitCode: number; stdout: string; stderr: string };

function defaultExec(
  argv: string[],
  cwd: string,
): { exitCode: number; stdout: string; stderr: string } {
  assertNoForceOrRewrite(argv);
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

/**
 * Assert all PR preconditions. Throws PrPolicyError with reason.
 */
export function assertPrAllowed(p: PrPreconditions): void {
  if (!p.remote) {
    throw new PrPolicyError("PR blocked: missing remote");
  }
  if (!p.hasAuthority) {
    throw new PrPolicyError("PR blocked: missing authority");
  }
  if (!p.verification) {
    throw new PrPolicyError("PR blocked: failed/stale verification (missing)");
  }
  try {
    assertFreshReport(
      p.verification,
      p.verificationMaxAgeMs ?? 60 * 60 * 1000,
    );
  } catch (err) {
    throw new PrPolicyError(
      `PR blocked: failed/stale verification (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (!p.verification.ok) {
    throw new PrPolicyError(
      `PR blocked: failed verification: ${p.verification.blocking.join("; ")}`,
    );
  }
  if (p.unresolvedConflicts.length) {
    throw new PrPolicyError(
      `PR blocked: unresolved conflict: ${p.unresolvedConflicts.join(", ")}`,
    );
  }
  if (p.openBlockingIssues.length) {
    throw new PrPolicyError(
      `PR blocked: open blocking issue: ${p.openBlockingIssues.join(", ")}`,
    );
  }
  if (PROTECTED_BRANCHES.has(p.integrationBranch)) {
    throw new PrPolicyError(
      `PR blocked: protected-branch mutation (${p.integrationBranch})`,
    );
  }
  if (!p.specIssueId || !p.planIssueId) {
    throw new PrPolicyError(
      "PR blocked: missing Spec/Plan Beads IDs",
    );
  }
  if (!p.biteSizeIssueIds.length) {
    throw new PrPolicyError("PR blocked: missing BiteSize IDs");
  }
  if (p.runRepoRemote !== p.actualRepoRemote) {
    throw new PrPolicyError(
      `PR blocked: repository/remote does not match bound harness run (run=${p.runRepoRemote}, actual=${p.actualRepoRemote})`,
    );
  }
}

export function buildPrBody(p: PrPreconditions): string {
  const verifyLines = (p.verification?.results ?? [])
    .map(
      (r) =>
        `- \`${r.argv.join(" ")}\` exit=${r.exitCode} cwd=${r.cwd} — ${r.summary.slice(0, 80)}`,
    )
    .join("\n");
  return [
    `## Goal`,
    p.boundGoal,
    "",
    `## Spec / Plan`,
    `- Spec: ${p.specIssueId}`,
    `- Plan: ${p.planIssueId}`,
    `- BiteSize: ${p.biteSizeIssueIds.join(", ")}`,
    "",
    `## Completed tasks`,
    ...p.completedTaskIds.map((id) => `- ${id}`),
    "",
    `## Review summary`,
    p.reviewSummary,
    "",
    `## Fresh verification`,
    verifyLines || "(none)",
  ].join("\n");
}

/**
 * Create exactly one PR for the current harness project.
 * Does not discover partner repositories.
 */
export function createCurrentProjectPr(
  p: PrPreconditions,
  opts?: {
    exec?: PrExec;
    /** Injected PR URL for tests (skip real gh). */
    fakeUrl?: string;
  },
): PrCreateResult {
  assertPrAllowed(p);
  const exec = opts?.exec ?? defaultExec;
  const cwd = p.integrationWorktreePath;
  const body = buildPrBody(p);

  // push without force
  const pushArgs = ["git", "push", "-u", p.remote!, p.integrationBranch];
  assertNoForceOrRewrite(pushArgs.slice(1));
  if (!opts?.fakeUrl) {
    const push = exec(pushArgs, cwd);
    if (push.exitCode !== 0) {
      throw new PrPolicyError(
        `git push failed: ${push.stderr || push.stdout}`,
      );
    }
  }

  let url = opts?.fakeUrl ?? "";
  if (!opts?.fakeUrl) {
    const gh = exec(
      [
        "gh",
        "pr",
        "create",
        "--head",
        p.integrationBranch,
        "--title",
        p.boundGoal.slice(0, 72),
        "--body",
        body,
      ],
      cwd,
    );
    if (gh.exitCode !== 0) {
      throw new PrPolicyError(`gh pr create failed: ${gh.stderr || gh.stdout}`);
    }
    url = gh.stdout.trim().split("\n").pop() ?? "";
  }

  if (!url) {
    throw new PrPolicyError("PR create returned empty URL");
  }

  return {
    url,
    branch: p.integrationBranch,
    body,
    pushed: true,
  };
}

/**
 * Store PR URL on run epic via injected callback (Beads controller).
 * Generic /harness does not wait for partner repos.
 */
export function recordPrOnEpic(
  record: (prUrl: string) => void,
  prUrl: string,
): void {
  if (!prUrl) throw new PrPolicyError("empty PR URL");
  record(prUrl);
}
