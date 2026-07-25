export type ReviewResult = {
  ok: boolean;
  feedback: string;
  blocking: string[];
};

export type CommandEvidence = {
  command: string;
  exitCode: number;
  summary: string;
};

export type ImplementerEvidence = {
  issueId: string;
  branch: string;
  worktreePath: string;
  headSha: string;
  changedFiles: string[];
  red: CommandEvidence;
  green: CommandEvidence;
  notes: string;
};

export type GitFacts = {
  branch: string;
  worktreePath: string;
  headSha: string;
  changedFiles: string[];
};

export type BeadsFacts = {
  issueId: string;
};

export type ValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Strict review-result post-validator. No repair. */
export function validateReviewResult(input: unknown): ValidationResult {
  if (!isObject(input)) return { ok: false, reason: "not an object" };
  const keys = Object.keys(input).sort();
  if (keys.join(",") !== "blocking,feedback,ok") {
    return { ok: false, reason: "missing or extra fields" };
  }
  if (typeof input.ok !== "boolean") return { ok: false, reason: "ok not boolean" };
  if (typeof input.feedback !== "string")
    return { ok: false, reason: "feedback not string" };
  if (!Array.isArray(input.blocking))
    return { ok: false, reason: "blocking not array" };
  for (const item of input.blocking) {
    if (typeof item !== "string" || item.length === 0)
      return { ok: false, reason: "non-string or empty blocking item" };
  }
  if (input.ok === true && input.blocking.length > 0)
    return { ok: false, reason: "ok true with non-empty blocking" };
  if (input.ok === false && input.blocking.length === 0)
    return { ok: false, reason: "ok false with empty blocking" };
  return { ok: true, value: input };
}

/** Strict implementer-evidence post-validator. No repair. */
export function validateImplementerEvidence(
  input: unknown,
  git: GitFacts,
  beads: BeadsFacts,
): ValidationResult {
  if (!isObject(input)) return { ok: false, reason: "not an object" };
  const required = [
    "issueId",
    "branch",
    "worktreePath",
    "headSha",
    "changedFiles",
    "red",
    "green",
    "notes",
  ];
  for (const k of required) {
    if (!(k in input)) return { ok: false, reason: `missing ${k}` };
  }
  for (const k of Object.keys(input)) {
    if (!required.includes(k)) return { ok: false, reason: `extra field ${k}` };
  }
  if (typeof input.issueId !== "string" || !input.issueId)
    return { ok: false, reason: "bad issueId" };
  if (typeof input.branch !== "string" || !input.branch)
    return { ok: false, reason: "bad branch" };
  if (typeof input.worktreePath !== "string" || !input.worktreePath)
    return { ok: false, reason: "bad worktreePath" };
  if (typeof input.headSha !== "string" || !/^[0-9a-f]{7,40}$/.test(input.headSha))
    return { ok: false, reason: "malformed SHA" };
  if (!Array.isArray(input.changedFiles) || input.changedFiles.length === 0)
    return { ok: false, reason: "changedFiles empty" };
  const seen = new Set<string>();
  for (const f of input.changedFiles) {
    if (typeof f !== "string" || !f) return { ok: false, reason: "empty changed file" };
    if (seen.has(f)) return { ok: false, reason: "duplicate changed file" };
    seen.add(f);
  }
  if (!isObject(input.red) || !isObject(input.green))
    return { ok: false, reason: "missing RED or GREEN evidence" };
  for (const phase of ["red", "green"] as const) {
    const p = input[phase] as Record<string, unknown>;
    if (typeof p.command !== "string" || !p.command)
      return { ok: false, reason: `${phase} missing command` };
    if (typeof p.exitCode !== "number")
      return { ok: false, reason: `${phase} missing exitCode` };
    if (typeof p.summary !== "string")
      return { ok: false, reason: `${phase} missing summary` };
  }
  if ((input.green as CommandEvidence).exitCode !== 0)
    return { ok: false, reason: "green exitCode must be 0" };
  // semantic match injected facts
  if (input.issueId !== beads.issueId)
    return { ok: false, reason: "issueId mismatch" };
  if (input.branch !== git.branch) return { ok: false, reason: "branch mismatch" };
  if (input.worktreePath !== git.worktreePath)
    return { ok: false, reason: "worktreePath mismatch" };
  if (input.headSha !== git.headSha) return { ok: false, reason: "headSha mismatch" };
  const gitSet = new Set(git.changedFiles);
  for (const f of input.changedFiles as string[]) {
    if (!gitSet.has(f)) return { ok: false, reason: "changedFiles mismatch" };
  }
  if ((input.changedFiles as string[]).length !== git.changedFiles.length)
    return { ok: false, reason: "changedFiles set size mismatch" };
  return { ok: true, value: input };
}
