import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  PR_REVIEW_ROLE_MANIFEST_VERSION,
  WF7_ROLE_SPECS,
  WF7_TASK_SLOTS,
  type PrReviewFailureCode,
  type RoleIntegrityObservation,
  type Wf7AgentName,
  type Wf7TaskName,
} from "./contracts";
import type { ReceiptJournal } from "./receipts";
import {
  INITIAL_REVIEW_SCHEMA,
  INITIAL_REVIEW_SCHEMA_SHA256,
  JUDGE_RESULT_SCHEMA,
  JUDGE_RESULT_SCHEMA_SHA256,
  REBUTTAL_SCHEMA,
  REBUTTAL_SCHEMA_SHA256,
} from "./schemas";

export interface RoleManifestSchema {
  identity: string;
  sha256: string;
}

export interface RoleManifestEntry {
  livePath: string;
  canonicalPath: string;
  sha256: string;
  agent: Wf7AgentName;
  model: string;
  tools: ["pr_review_snapshot"];
  spawns: [];
  blocking: true;
  schemas: RoleManifestSchema[];
}

export interface LoadedRoleManifest {
  version: typeof PR_REVIEW_ROLE_MANIFEST_VERSION;
  digest: string;
  roles: RoleManifestEntry[];
}

export interface RoleCheckOptions {
  boundary: "pre-call" | "pre-publish";
  journal: ReceiptJournal;
  previousObservations?: readonly RoleIntegrityObservation[];
}

export interface RoleSlotCheckOptions {
  boundary: "pre-call";
  taskName: Wf7TaskName;
  task: {
    agent: Wf7AgentName;
    schemaIdentity: string;
    schemaSha256: string;
    model?: unknown;
    effort?: unknown;
  };
  settlement?: {
    agentSource: unknown;
    requestedModel?: unknown;
    resolvedModel: unknown;
    resolvedModelIsFallback: unknown;
  };
  journal: ReceiptJournal;
  previousObservations?: readonly RoleIntegrityObservation[];
}

export interface OmpToolCall {
  toolName: string;
  input: Record<string, unknown>;
  cwd?: string;
}

export interface RoleMutationGuard {
  readonly active: boolean;
  handleToolCall(event: OmpToolCall): void | { block: true; reason: string };
  stop(): void;
}

const SHA256 = /^[0-9a-f]{64}$/;
const MANIFEST_PATH = fileURLToPath(new URL("./role-manifest.json", import.meta.url));

const SCHEMAS_BY_STAGE = {
  initial: {
    identity: INITIAL_REVIEW_SCHEMA.$id,
    sha256: INITIAL_REVIEW_SCHEMA_SHA256,
  },
  rebuttal: {
    identity: REBUTTAL_SCHEMA.$id,
    sha256: REBUTTAL_SCHEMA_SHA256,
  },
  judge: {
    identity: JUDGE_RESULT_SCHEMA.$id,
    sha256: JUDGE_RESULT_SCHEMA_SHA256,
  },
} as const;

const SCHEMAS_BY_AGENT: Record<Wf7AgentName, readonly RoleManifestSchema[]> = {
  "wf7-fable-reviewer": [SCHEMAS_BY_STAGE.initial, SCHEMAS_BY_STAGE.rebuttal],
  "wf7-sol-reviewer": [SCHEMAS_BY_STAGE.initial, SCHEMAS_BY_STAGE.rebuttal],
  "wf7-grok-judge": [SCHEMAS_BY_STAGE.judge],
};

function exactArray(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function exactSchemas(
  actual: readonly RoleManifestSchema[],
  expected: readonly RoleManifestSchema[],
): boolean {
  return actual.length === expected.length && actual.every((schema, index) =>
    schema.identity === expected[index]?.identity && schema.sha256 === expected[index]?.sha256
  );
}

function expectedRole(agent: unknown): (typeof WF7_ROLE_SPECS)[number] | undefined {
  return WF7_ROLE_SPECS.find((role) => role.agent === agent);
}

function expandedLivePath(path: string): string {
  return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function validateManifestRole(value: unknown, index: number, strictPaths: boolean): RoleManifestEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RoleIntegrityError("role_integrity_drift", "WF7 role manifest is invalid");
  }
  const role = value as Record<string, unknown>;
  const spec = WF7_ROLE_SPECS[index];
  if (
    !spec ||
    typeof role.livePath !== "string" ||
    typeof role.canonicalPath !== "string" ||
    !isAbsolute(role.livePath) ||
    !isAbsolute(role.canonicalPath) ||
    typeof role.sha256 !== "string" ||
    !SHA256.test(role.sha256) ||
    role.agent !== spec.agent ||
    role.model !== spec.model ||
    !Array.isArray(role.tools) ||
    !exactArray(role.tools, ["pr_review_snapshot"]) ||
    !Array.isArray(role.spawns) ||
    role.spawns.length !== 0 ||
    role.blocking !== true ||
    !Array.isArray(role.schemas)
  ) {
    throw new RoleIntegrityError("role_integrity_drift", "WF7 role manifest is invalid");
  }
  const schemas = role.schemas as RoleManifestSchema[];
  if (
    !schemas.every((schema) =>
      schema && typeof schema.identity === "string" && typeof schema.sha256 === "string" && SHA256.test(schema.sha256)
    ) ||
    !exactSchemas(schemas, SCHEMAS_BY_AGENT[spec.agent]) ||
    (strictPaths && (
      role.livePath !== expandedLivePath(spec.livePath) ||
      role.canonicalPath !== spec.canonicalPath
    ))
  ) {
    throw new RoleIntegrityError("role_integrity_drift", "WF7 role manifest is invalid");
  }
  return {
    livePath: role.livePath,
    canonicalPath: role.canonicalPath,
    sha256: role.sha256,
    agent: spec.agent,
    model: spec.model,
    tools: ["pr_review_snapshot"],
    spawns: [],
    blocking: true,
    schemas: schemas.map((schema) => ({ ...schema })),
  };
}

export class RoleIntegrityError extends Error {
  readonly code: PrReviewFailureCode;
  readonly observation?: RoleIntegrityObservation;
  readonly observations?: readonly RoleIntegrityObservation[];

  constructor(
    code: PrReviewFailureCode,
    message: string,
    observation?: RoleIntegrityObservation,
    observations?: readonly RoleIntegrityObservation[],
  ) {
    super(message);
    this.name = "RoleIntegrityError";
    this.code = code;
    this.observation = observation;
    this.observations = observations?.map((entry) => Object.freeze({ ...entry }));
  }
}

export function loadRoleManifest(path = MANIFEST_PATH): LoadedRoleManifest {
  let bytes: Buffer;
  let parsed: unknown;
  try {
    bytes = readFileSync(path);
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new RoleIntegrityError("role_integrity_drift", "WF7 role manifest is unavailable or invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RoleIntegrityError("role_integrity_drift", "WF7 role manifest is invalid");
  }
  const raw = parsed as Record<string, unknown>;
  if (raw.version !== PR_REVIEW_ROLE_MANIFEST_VERSION || !Array.isArray(raw.roles) || raw.roles.length !== 3) {
    throw new RoleIntegrityError("role_integrity_drift", "WF7 role manifest is invalid");
  }
  const strictPaths = path === MANIFEST_PATH;
  return {
    version: PR_REVIEW_ROLE_MANIFEST_VERSION,
    digest: createHash("sha256").update(bytes).digest("hex"),
    roles: raw.roles.map((role, index) => validateManifestRole(role, index, strictPaths)),
  };
}

function observationFor(
  role: RoleManifestEntry,
  boundary: RoleCheckBoundary,
  previous?: RoleIntegrityObservation,
): RoleIntegrityObservation {
  const observation: RoleIntegrityObservation = previous
    ? { ...previous }
    : { agent: role.agent, livePath: role.livePath, preCallValid: false };
  observation.livePath = role.livePath;
  if (boundary === "pre-publish") observation.prePublishValid = false;
  else observation.preCallValid = false;
  return observation;
}

function roleFailure(
  role: RoleManifestEntry,
  boundary: RoleCheckBoundary,
  observation: RoleIntegrityObservation,
): RoleIntegrityError {
  return new RoleIntegrityError(
    "role_integrity_drift",
    `WF7 role integrity check failed for ${role.agent} at ${boundary}`,
    observation,
  );
}

function parseFrontmatter(bytes: Buffer): Record<string, unknown> | undefined {
  const text = bytes.toString("utf8");
  if (!text.startsWith("---\n")) return undefined;
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return undefined;
  const frontmatter = parse(text.slice(4, end));
  return frontmatter && typeof frontmatter === "object" && !Array.isArray(frontmatter)
    ? frontmatter as Record<string, unknown>
    : undefined;
}

function checkRoleFile(
  role: RoleManifestEntry,
  boundary: RoleCheckBoundary,
  previous?: RoleIntegrityObservation,
): RoleIntegrityObservation {
  const observation = observationFor(role, boundary, previous);
  try {
    const checkedRealpath = realpathSync.native(role.livePath);
    observation.checkedRealpath = checkedRealpath;
    if (
      checkedRealpath !== role.canonicalPath ||
      realpathSync.native(role.canonicalPath) !== role.canonicalPath ||
      !lstatSync(role.canonicalPath).isFile() ||
      !statSync(role.livePath).isFile()
    ) {
      throw roleFailure(role, boundary, observation);
    }

    const bytes = readFileSync(checkedRealpath);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (boundary === "pre-publish") observation.prePublishSha256 = digest;
    else observation.preCallSha256 = digest;
    const frontmatter = parseFrontmatter(bytes);
    const spec = expectedRole(role.agent);
    if (
      digest !== role.sha256 ||
      !spec ||
      role.model !== spec.model ||
      !exactArray(role.tools, ["pr_review_snapshot"]) ||
      role.spawns.length !== 0 ||
      role.blocking !== true ||
      !exactSchemas(role.schemas, SCHEMAS_BY_AGENT[role.agent]) ||
      !frontmatter ||
      frontmatter.name !== role.agent ||
      frontmatter.model !== role.model ||
      !Array.isArray(frontmatter.tools) ||
      !exactArray(frontmatter.tools, role.tools) ||
      !Array.isArray(frontmatter.spawns) ||
      !exactArray(frontmatter.spawns, role.spawns) ||
      frontmatter.blocking !== true
    ) {
      throw roleFailure(role, boundary, observation);
    }
    if (boundary === "pre-publish") observation.prePublishValid = true;
    else observation.preCallValid = true;
    return observation;
  } catch (error) {
    if (error instanceof RoleIntegrityError) throw error;
    throw roleFailure(role, boundary, observation);
  }
}

function mergeObservation(
  observations: readonly RoleIntegrityObservation[],
  observation: RoleIntegrityObservation,
): RoleIntegrityObservation[] {
  const merged = observations.map((entry) => ({ ...entry }));
  const index = merged.findIndex((entry) => entry.agent === observation.agent);
  if (index >= 0) merged[index] = observation;
  else merged.push(observation);
  return merged;
}

function receiptFailure(
  journal: ReceiptJournal | undefined,
  error: RoleIntegrityError,
  observations: readonly RoleIntegrityObservation[],
): never {
  journal?.fail(error.code, error.message, { roles: observations });
  throw error;
}

function checkAllRoleFilesInternal(
  manifest: LoadedRoleManifest,
  options: RoleCheckOptions | {
    boundary: "registration";
    previousObservations?: readonly RoleIntegrityObservation[];
  },
): RoleIntegrityObservation[] {
  let observations = options.previousObservations?.map((role) => ({ ...role })) ?? [];
  for (const role of manifest.roles) {
    try {
      observations = mergeObservation(
        observations,
        checkRoleFile(
          role,
          options.boundary,
          observations.find((entry) => entry.agent === role.agent),
        ),
      );
    } catch (error) {
      const integrityError = error instanceof RoleIntegrityError
        ? error
        : roleFailure(role, options.boundary, observationFor(role, options.boundary));
      if (integrityError.observation) {
        observations = mergeObservation(observations, integrityError.observation);
      }
      const accumulatedError = new RoleIntegrityError(
        integrityError.code,
        integrityError.message,
        integrityError.observation,
        observations,
      );
      return receiptFailure(
        "journal" in options ? options.journal : undefined,
        accumulatedError,
        observations,
      );
    }
  }
  if ("journal" in options) options.journal.prepare({ roles: observations });
  return observations;
}

export function checkAllRoleFilesAtRegistration(
  manifest: LoadedRoleManifest,
): RoleIntegrityObservation[] {
  return checkAllRoleFilesInternal(manifest, { boundary: "registration" });
}

export function checkAllRoleFilesAtPublish(
  manifest: LoadedRoleManifest,
  previousObservations: readonly RoleIntegrityObservation[],
): RoleIntegrityObservation[] {
  return checkAllRoleFilesInternal(manifest, {
    boundary: "pre-publish",
    previousObservations,
  });
}

export function checkAllRoleFiles(
  manifest: LoadedRoleManifest,
  options: RoleCheckOptions,
): RoleIntegrityObservation[] {
  return checkAllRoleFilesInternal(manifest, options);
}
function slotFailure(
  code: PrReviewFailureCode,
  message: string,
  journal: ReceiptJournal,
  observations: readonly RoleIntegrityObservation[],
): never {
  return receiptFailure(journal, new RoleIntegrityError(code, message), observations);
}

export function checkRoleForSlot(
  manifest: LoadedRoleManifest,
  options: RoleSlotCheckOptions,
): RoleIntegrityObservation {
  const observations = checkAllRoleFiles(manifest, {
    boundary: "pre-call",
    journal: options.journal,
    previousObservations: options.previousObservations,
  });
  const slot = WF7_TASK_SLOTS.find((candidate) => candidate.name === options.taskName);
  if (!slot || slot.agent !== options.task.agent) {
    return slotFailure(
      "task_envelope_invalid",
      "WF7 task role does not match its fixed slot",
      options.journal,
      observations,
    );
  }
  const role = manifest.roles.find((candidate) => candidate.agent === slot.agent);
  const schema = SCHEMAS_BY_STAGE[slot.stage];
  if (
    !role ||
    Object.hasOwn(options.task, "model") ||
    Object.hasOwn(options.task, "effort") ||
    options.task.schemaIdentity !== schema.identity ||
    options.task.schemaSha256 !== schema.sha256 ||
    !role.schemas.some((candidate) =>
      candidate.identity === schema.identity && candidate.sha256 === schema.sha256
    )
  ) {
    return slotFailure(
      "task_envelope_invalid",
      "WF7 task caller supplied a role, selector, or schema override",
      options.journal,
      observations,
    );
  }
  const checked = observations;

  if (options.settlement) {
    if (options.settlement.agentSource === "project") {
      return slotFailure(
        "project_shadow",
        "WF7 target-project role shadow is forbidden",
        options.journal,
        checked,
      );
    }
    if (options.settlement.agentSource !== "user") {
      return slotFailure(
        "route_mismatch",
        "WF7 role must settle from the user source",
        options.journal,
        checked,
      );
    }
    if (options.settlement.resolvedModelIsFallback !== false) {
      return slotFailure(
        "model_fallback",
        "WF7 role model fallback is forbidden",
        options.journal,
        checked,
      );
    }
    if (
      options.settlement.requestedModel !== role.model ||
      options.settlement.resolvedModel !== role.model
    ) {
      return slotFailure(
        "route_mismatch",
        "WF7 role selector does not match the manifest",
        options.journal,
        checked,
      );
    }
  }

  options.journal.prepare({ roles: checked });
  return checked.find((entry) => entry.agent === role.agent)!;
}

function normalizedCandidate(path: string, cwd: string): string {
  const expanded = expandedLivePath(path);
  return normalize(isAbsolute(expanded) ? expanded : resolve(cwd, expanded));
}

function resolvedCandidate(path: string): string | undefined {
  try {
    return realpathSync.native(path);
  } catch {
    try {
      return join(realpathSync.native(dirname(path)), basename(path));
    } catch {
      return undefined;
    }
  }
}

function inputPaths(input: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    const lower = key.toLowerCase();
    const pathKey = lower.includes("path") || [
      "file",
      "files",
      "target",
      "source",
      "destination",
      "from",
      "to",
    ].includes(lower);
    if (!pathKey) continue;
    if (typeof value === "string") paths.push(value);
    else if (Array.isArray(value)) paths.push(...value.filter((entry): entry is string => typeof entry === "string"));
  }
  return paths;
}

const MUTATION_TOOLS: Record<string, true> = {
  write: true,
  edit: true,
  create: true,
  delete: true,
  remove: true,
  unlink: true,
  rename: true,
  move: true,
  chmod: true,
  chown: true,
  link: true,
  symlink: true,
};
const SHELL_TOOLS: Record<string, true> = {
  bash: true,
  shell: true,
  exec: true,
  execute: true,
  command: true,
};
const READ_ONLY_COMMANDS: Record<string, true> = {
  echo: true,
  printf: true,
  cat: true,
  cmp: true,
  diff: true,
  file: true,
  ls: true,
  readlink: true,
  realpath: true,
  sha256sum: true,
  shasum: true,
  stat: true,
  test: true,
  wc: true,
};
const UNRESOLVED_SHELL_PATH =
  /[$`]|[<>]\(|[?*+@!]\(|(?:^|[\s"'=])~[^ \t;&|<>]*|[*?]|\[[^\]]*\]/;

function shellStructure(command: string): {
  compound: boolean;
  outputRedirect: boolean;
  noncanonicalPath: boolean;
} {
  let quote: "'" | '"' | undefined;
  let compound = false;
  let outputRedirect = false;
  let noncanonicalPath = false;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]!;
    if (quote === "'") {
      if (char === "'") {
        if (command[i + 1] !== undefined && !/[\s;&|<>]/.test(command[i + 1]!)) {
          noncanonicalPath = true;
        }
        quote = undefined;
      }
      continue;
    }
    if (quote === '"') {
      if (char === "\\") {
        noncanonicalPath = true;
        i += 1;
      } else if (char === '"') {
        if (command[i + 1] !== undefined && !/[\s;&|<>]/.test(command[i + 1]!)) {
          noncanonicalPath = true;
        }
        quote = undefined;
      } else if (char === "`" || command.startsWith("$(", i)) {
        compound = true;
      }
      continue;
    }
    if (char === "\\") {
      noncanonicalPath = true;
      i += 1;
    } else if (char === "'" || char === '"') {
      if (i > 0 && !/[\s;&|<>]/.test(command[i - 1]!)) noncanonicalPath = true;
      quote = char;
    } else if (
      char === "`" ||
      command.startsWith("$(", i) ||
      command.startsWith("<(", i) ||
      command.startsWith(">(", i)
    ) {
      compound = true;
    } else if (char === "{") {
      const close = command.indexOf("}", i + 1);
      const expansion = close < 0 ? "" : command.slice(i + 1, close);
      if (expansion && !/[\s;&|<>]/.test(expansion) && /,|\.\./.test(expansion)) {
        noncanonicalPath = true;
      }
    } else if (char === ";" || char === "&" || char === "|" || char === "\n" || char === "\r") {
      compound = true;
    } else if (char === ">") {
      outputRedirect = true;
    }
  }
  return { compound, outputRedirect, noncanonicalPath };
}

function toolKind(toolName: string): string {
  return toolName.toLowerCase().split(/[._:/-]/).filter(Boolean).at(-1) ?? "";
}

function shellTokens(command: string): string[] {
  return command.match(/"(?:\\.|[^"])*"|'[^']*'|[^\s;&|<>]+/g)?.map((token) =>
    token.replace(/^["']|["']$/g, "")
  ) ?? [];
}

export function createRoleMutationGuard(
  manifest: LoadedRoleManifest,
  journal: ReceiptJournal,
): RoleMutationGuard {
  const protectedPaths = new Set<string>();
  for (const role of manifest.roles) {
    for (const path of [role.livePath, role.canonicalPath]) {
      protectedPaths.add(normalize(path));
      const resolved = resolvedCandidate(path);
      if (resolved) protectedPaths.add(normalize(resolved));
    }
  }

  let active = true;
  let failed = false;
  journal.prepare({ mutation_guard_active: true });

  const targetsProtected = (paths: readonly string[], cwd: string): boolean => paths.some((path) => {
    const candidate = normalizedCandidate(path, cwd);
    if (protectedPaths.has(candidate)) return true;
    const resolved = resolvedCandidate(candidate);
    return resolved !== undefined && protectedPaths.has(normalize(resolved));
  });

  return {
    get active() {
      return active;
    },
    handleToolCall(event) {
      if (!active) return undefined;
      const kind = toolKind(event.toolName);
      const cwd = event.cwd ?? process.cwd();
      let denied = MUTATION_TOOLS[kind] === true && targetsProtected(inputPaths(event.input), cwd);
      if (!denied && kind === "edit") {
        denied = Object.values(event.input).some((value) =>
          typeof value === "string" &&
          ([...protectedPaths].some((path) => value.includes(path)) ||
            targetsProtected(
              [...value.matchAll(/\[([^#\]\r\n]+)#[0-9A-F]{4}\]/g)].map((match) => match[1]!),
              cwd,
            ))
        );
      }

      if (!denied && SHELL_TOOLS[kind] === true) {
        const command = typeof event.input.command === "string" ? event.input.command : undefined;
        const argv = Array.isArray(event.input.argv)
          ? event.input.argv.filter((entry): entry is string => typeof entry === "string")
          : undefined;
        const tokens = command ? shellTokens(command) : argv ?? [];
        const nestedTokens = tokens.flatMap((token) => shellTokens(token));
        const allTokens = [...tokens, ...nestedTokens];
        const text = command ?? argv?.join(" ") ?? "";
        const executable = basename(tokens[0] ?? "").toLowerCase();
        const structure = text ? shellStructure(text) : undefined;
        const mutationCapable = structure
          ? structure.compound ||
            structure.outputRedirect ||
            READ_ONLY_COMMANDS[executable] !== true
          : READ_ONLY_COMMANDS[executable] !== true;
        const protectedTarget =
          targetsProtected(allTokens, cwd) ||
          [...protectedPaths].some((path) => text.includes(path));
        const compoundCwd =
          structure?.compound === true &&
          allTokens.some((token) => {
            const command = basename(token).toLowerCase();
            return command === "cd" || command === "pushd";
          });
        denied =
          mutationCapable &&
          (protectedTarget ||
            compoundCwd ||
            UNRESOLVED_SHELL_PATH.test(text) ||
            structure?.noncanonicalPath === true);
      }

      if (!denied) return undefined;
      journal.fail(
        "role_mutation_denied",
        "WF7 role mutation denied by the run-scoped OMP guard",
        { mutation_guard_active: true },
      );
      failed = true;
      active = false;
      return { block: true, reason: "WF7 role mutation denied" };
    },
    stop() {
      if (!active) return;
      active = false;
      if (!failed) journal.prepare({ mutation_guard_active: false });
    },
  };
}
