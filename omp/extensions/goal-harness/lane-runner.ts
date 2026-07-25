/**
 * Run implementer agents inside assigned git worktrees via active OMP SDK API.
 * Child gets no Beads write broker, no worktree controller, no reviewer spawn.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { IMPLEMENTER_EVIDENCE_SCHEMA } from "./evidence";
import {
  assertBaseShaBeforeEdit,
  assertCleanBaseline,
  postValidateEvidence,
  queryBeadsFacts,
  queryGitFacts,
  type ImplementerEvidenceEnvelope,
} from "./evidence";
import { assertRealGitWorktreeIsolation } from "./worktrees";

export { IMPLEMENTER_EVIDENCE_SCHEMA };

export class LaneRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaneRunnerError";
  }
}

/** Active OMP extension API surface used by the lane runner (injected). */
export type ActivePiApi = {
  createAgentSession: (opts: SessionCreateOpts) => Promise<AgentSession>;
  SessionManager: { inMemory: () => unknown };
};

export type ActiveExtensionApi = {
  pi: ActivePiApi;
};

export type SessionCreateOpts = {
  cwd: string;
  model: string;
  thinkingLevel: string;
  sessionManager: unknown;
  outputSchema: unknown;
  outputSchemaMode: "strict";
  requireYieldTool: boolean;
  enableLsp: boolean;
  systemPrompt?: string;
  /** Isolated settings — memory/TODO/Autolearn off. */
  settings?: Record<string, unknown>;
};

export type AgentSession = {
  prompt: (text: string) => Promise<unknown>;
  /** Optional yield of structured output */
  getOutput?: () => Promise<unknown>;
};

export type LaneAssignment = {
  issueId: string;
  /** Canonical worktree path — SDK cwd pins the lane. */
  worktreePath: string;
  branch: string;
  baseSha: string;
  /** Only this issue's text + relevant spec/plan slices. */
  issueText: string;
  specContext: string;
  planContext: string;
  model: string;
  effort: string;
};

export type LaneRunResult = {
  sessionOpts: SessionCreateOpts;
  rolePrompt: string;
  evidence: ImplementerEvidenceEnvelope;
  validation: { ok: boolean; reason?: string };
};

/** Capabilities the child must NOT receive. */
export type ForbiddenChildCaps = {
  beadsWrite?: unknown;
  worktreeController?: unknown;
  reviewerSpawn?: unknown;
  createWorktree?: unknown;
};

export function loadImplementerRolePrompt(agentsDir?: string): string {
  const base =
    agentsDir ??
    join(dirname(fileURLToPath(import.meta.url)), "../../agents");
  const path = join(base, "implementer.md");
  if (!existsSync(path)) {
    throw new LaneRunnerError(`missing implementer role prompt: ${path}`);
  }
  return readFileSync(path, "utf8");
}

export function buildLanePrompt(
  role: string,
  assignment: LaneAssignment,
): string {
  return [
    role,
    "",
    "## Assigned issue only",
    `issueId: ${assignment.issueId}`,
    assignment.issueText,
    "",
    "## Spec context (slice)",
    assignment.specContext,
    "",
    "## Plan context (slice)",
    assignment.planContext,
    "",
    "Hard boundaries: no bd write, no worktree create/integrate, no reviewer spawn.",
    `Work only in cwd=${assignment.worktreePath} on branch=${assignment.branch}.`,
    `BASE_SHA=${assignment.baseSha}`,
  ].join("\n");
}

export function assertNoForbiddenChildCaps(caps: ForbiddenChildCaps): void {
  if (caps.beadsWrite != null) {
    throw new LaneRunnerError("child must not receive Beads write broker");
  }
  if (caps.worktreeController != null) {
    throw new LaneRunnerError("child must not receive worktree controller");
  }
  if (caps.reviewerSpawn != null) {
    throw new LaneRunnerError("child must not receive reviewer spawn");
  }
  if (caps.createWorktree != null) {
    throw new LaneRunnerError("child must not create worktrees");
  }
}

/**
 * Create ephemeral implementer session pinned to assigned worktree.
 * Does not use OMP copy isolation — cwd is the real git worktree path.
 */
export async function createLaneSession(
  api: ActiveExtensionApi,
  assignment: LaneAssignment,
  opts?: {
    agentsDir?: string;
    isolationMode?: string;
    /** Skip start baseline (only for post-hoc evidence validation tests). */
    skipStartChecks?: boolean;
  },
): Promise<{
  session: AgentSession;
  sessionOpts: SessionCreateOpts;
  rolePrompt: string;
  userPrompt: string;
}> {
  assertRealGitWorktreeIsolation(opts?.isolationMode);
  assertNoForbiddenChildCaps({});
  if (!opts?.skipStartChecks) {
    assertCleanBaseline(assignment.worktreePath);
    const headNow = queryGitFacts(assignment.worktreePath).headSha;
    assertBaseShaBeforeEdit(assignment.baseSha, headNow);
  }

  const rolePrompt = loadImplementerRolePrompt(opts?.agentsDir);
  const userPrompt = buildLanePrompt(rolePrompt, assignment);
  const sessionManager = api.pi.SessionManager.inMemory();

  const sessionOpts: SessionCreateOpts = {
    cwd: assignment.worktreePath,
    model: assignment.model,
    thinkingLevel: assignment.effort,
    sessionManager,
    outputSchema: IMPLEMENTER_EVIDENCE_SCHEMA,
    outputSchemaMode: "strict",
    requireYieldTool: true,
    enableLsp: true,
    systemPrompt: rolePrompt,
    settings: {
      memory: false,
      todo: false,
      autolearn: false,
    },
  };

  const session = await api.pi.createAgentSession(sessionOpts);
  return { session, sessionOpts, rolePrompt, userPrompt };
}

/**
 * Run implementer in lane, collect structured evidence, post-validate.
 */
export async function runLaneImplementer(
  api: ActiveExtensionApi,
  assignment: LaneAssignment,
  opts?: {
    agentsDir?: string;
    /** Injected model output for tests */
    fakeEvidence?: ImplementerEvidenceEnvelope;
    forbidden?: ForbiddenChildCaps;
  },
): Promise<LaneRunResult> {
  if (opts?.forbidden) assertNoForbiddenChildCaps(opts.forbidden);

  const { session, sessionOpts, rolePrompt, userPrompt } =
    await createLaneSession(api, assignment, {
      agentsDir: opts?.agentsDir,
      // Post-hoc fake evidence already reflects after-edit state
      skipStartChecks: Boolean(opts?.fakeEvidence),
    });

  let raw: unknown;
  if (opts?.fakeEvidence) {
    raw = opts.fakeEvidence;
  } else {
    await session.prompt(userPrompt);
    raw = session.getOutput
      ? await session.getOutput()
      : await session.prompt("__yield_evidence__");
  }

  const git = queryGitFacts(assignment.worktreePath);
  // Prefer assignment facts for path/branch when worktree is clean baseline-only
  const gitFacts = {
    ...git,
    branch: git.branch || assignment.branch,
    worktreePath: assignment.worktreePath,
  };
  // Normalize worktree path comparison via realpath when possible
  try {
    const { realpathSync } = await import("node:fs");
    gitFacts.worktreePath = realpathSync(assignment.worktreePath);
  } catch {
    /* keep */
  }

  const beads = queryBeadsFacts(assignment.issueId);
  const validation = postValidateEvidence(raw, gitFacts, beads);

  if (!validation.ok) {
    throw new LaneRunnerError(
      `evidence post-validation failed: ${validation.reason}`,
    );
  }

  return {
    sessionOpts,
    rolePrompt,
    evidence: raw as ImplementerEvidenceEnvelope,
    validation: { ok: true },
  };
}

/**
 * Controller-only entry: run one assigned lane with active API.
 * Goal-harness / index pass API + assignment; never generic controller handles.
 */
export async function runAssignedLane(
  api: ActiveExtensionApi,
  assignment: LaneAssignment,
  opts?: Parameters<typeof runLaneImplementer>[2],
): Promise<LaneRunResult> {
  return runLaneImplementer(api, assignment, opts);
}
