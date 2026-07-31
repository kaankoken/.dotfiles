/**
 * Pure sandbox classifier: path + command policy for harness operations.
 * Does not perform or audit operations — only allow/deny decisions.
 */

import {
  existsSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import type { PhaseCapabilityManifest } from "./capabilities";
import { PROTECTED_BRANCHES } from "./git";

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

export type SandboxDecision = {
  allow: boolean;
  reason: string;
  operation?: string;
  resolvedPath?: string;
};

export type ClassifiedCommand = {
  argv: string[];
  kind:
    | "git"
    | "bd"
    | "gh"
    | "cli"
    | "fs"
    | "unknown";
};

const CREDENTIAL_PATH_MARKERS = [
  "/.ssh/",
  "/.gnupg/",
  "/.gpg/",
  "/.aws/",
  "/.config/gcloud/",
  "/Library/Keychains/",
  "/.omp/agent/auth.json",
  "/auth.json",
  "/.chrome",
  "Cookies",
];

const FORBIDDEN_GIT = [
  ["clean", "-xfd"],
  ["clean", "-ffdx"],
  ["reset", "--hard"],
  ["push", "--force"],
  ["push", "-f"],
  ["filter-branch"],
  ["filter-repo"],
];

const GH_MUTATING_METHODS: Record<string, true> = {
  POST: true,
  PATCH: true,
  PUT: true,
  DELETE: true,
};
const GH_INLINE_REVIEW_ENDPOINT =
  /^repos\/[^/]+\/[^/]+\/(?:issues\/(?:[^/]+\/comments|comments\/[^/]+)|pulls\/(?:[^/]+\/(?:comments|reviews)|comments\/[^/]+))(?:\/[^/]+)*\/?$/;

/**
 * Resolve path component-by-component with lstat; return canonical path
 * of existing target or nearest existing parent.
 */
export function resolveCanonicalPath(
  inputPath: string,
  opts?: { cwd?: string },
): { path: string; exists: boolean; nearestParent: string } {
  if (!inputPath || typeof inputPath !== "string") {
    throw new SandboxError("empty path");
  }
  if (/\$\{|\$[A-Za-z_]|`|\*/.test(inputPath)) {
    throw new SandboxError("unresolved env/glob target rejected");
  }
  if (inputPath.includes("\0")) {
    throw new SandboxError("null byte in path");
  }
  // Reject .. before normalize collapses it (path traversal)
  const rawParts = inputPath.split(/[/\\]/);
  if (rawParts.some((p) => p === "..")) {
    throw new SandboxError("path traversal (..) rejected");
  }

  const cwd = opts?.cwd ?? process.cwd();
  const abs = isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath);
  const normalized = normalize(abs);

  // Walk components; reject .. escapes after normalize still containing weirdness
  const parts = normalized.split(sep).filter((p) => p.length > 0);
  // On macOS abs starts with /
  let cur = normalized.startsWith(sep) ? sep : "";
  let lastExisting = cur || sep;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part === "..") {
      throw new SandboxError("path traversal (..) rejected");
    }
    cur = cur === sep ? `${sep}${part}` : join(cur, part);
    try {
      const st = lstatSync(cur);
      if (st.isSymbolicLink()) {
        // resolve symlink at this component
        try {
          const real = realpathSync(cur);
          // ensure real path doesn't escape — caller checks roots
          cur = real;
          lastExisting = real;
        } catch {
          throw new SandboxError(`symlink escape or broken link: ${cur}`);
        }
      } else {
        lastExisting = cur;
      }
    } catch {
      // does not exist — nearest parent is lastExisting
      return {
        path: normalized,
        exists: false,
        nearestParent: lastExisting || dirname(normalized),
      };
    }
  }

  let finalPath = cur;
  try {
    finalPath = realpathSync(cur);
  } catch {
    finalPath = cur;
  }
  return { path: finalPath, exists: true, nearestParent: finalPath };
}

function canon(p: string): string {
  try {
    if (existsSync(p)) return realpathSync(p);
  } catch {
    /* */
  }
  try {
    // realpath parent if possible
    const parent = dirname(p);
    if (existsSync(parent)) return join(realpathSync(parent), p.slice(parent.length).replace(/^[/\\]/, "") || "");
  } catch {
    /* */
  }
  return normalize(p);
}

function underRoot(path: string, root: string): boolean {
  const r = canon(root).replace(/[/\\]+$/, "");
  const p = canon(path).replace(/[/\\]+$/, "");
  return p === r || p.startsWith(r + sep);
}

export function classifyPathAccess(
  manifest: PhaseCapabilityManifest,
  inputPath: string,
  mode: "read" | "write",
  opts?: { cwd?: string },
): SandboxDecision {
  let resolved: ReturnType<typeof resolveCanonicalPath>;
  try {
    resolved = resolveCanonicalPath(inputPath, opts);
  } catch (e) {
    return {
      allow: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  const checkPath = resolved.exists ? resolved.path : resolved.nearestParent;
  const low = checkPath.toLowerCase();

  for (const m of CREDENTIAL_PATH_MARKERS) {
    if (low.includes(m.toLowerCase())) {
      return {
        allow: false,
        reason: `credential path denied: ${m}`,
        resolvedPath: checkPath,
      };
    }
  }

  // Home/system broad denies for writes
  const roots = manifest.canonicalRoots;
  const allowedWriteRoots = [
    roots.worktree,
    roots.runTemp,
    roots.integration,
    ...(roots.migrationTargets ?? []),
  ].filter(Boolean) as string[];

  const allowedReadRoots = [
    roots.repo,
    roots.worktree,
    roots.runTemp,
    roots.integration,
    ...(roots.migrationTargets ?? []),
  ].filter(Boolean) as string[];

  if (mode === "read") {
    if (!manifest.operations.includes("fs.read.repo") && !manifest.operations.includes("skill.read")) {
      // still allow skill.read paths via skill tool separately
    }
    const ok = allowedReadRoots.some((r) => underRoot(checkPath, r));
    if (!ok) {
      return {
        allow: false,
        reason: `unrelated path read denied: ${checkPath}`,
        resolvedPath: checkPath,
      };
    }
    return {
      allow: true,
      reason: "read within canonical roots",
      operation: "fs.read.repo",
      resolvedPath: checkPath,
    };
  }

  // write
  const writeOps = manifest.operations.filter((o) => o.startsWith("fs.write."));
  if (writeOps.length === 0) {
    return {
      allow: false,
      reason: `writes not allowed in phase ${manifest.phase}`,
      resolvedPath: checkPath,
    };
  }

  if (underRoot(checkPath, roots.worktree) && writeOps.includes("fs.write.lane")) {
    return {
      allow: true,
      reason: "write lane",
      operation: "fs.write.lane",
      resolvedPath: checkPath,
    };
  }
  if (underRoot(checkPath, roots.runTemp) && writeOps.includes("fs.write.runTemp")) {
    return {
      allow: true,
      reason: "write run temp",
      operation: "fs.write.runTemp",
      resolvedPath: checkPath,
    };
  }
  if (
    roots.integration &&
    underRoot(checkPath, roots.integration) &&
    writeOps.includes("fs.write.integration")
  ) {
    return {
      allow: true,
      reason: "write integration",
      operation: "fs.write.integration",
      resolvedPath: checkPath,
    };
  }
  if (
    writeOps.includes("fs.write.migrationTarget") &&
    (roots.migrationTargets ?? []).some((t) => underRoot(checkPath, t))
  ) {
    return {
      allow: true,
      reason: "write migration target",
      operation: "fs.write.migrationTarget",
      resolvedPath: checkPath,
    };
  }

  return {
    allow: false,
    reason: `write outside allowed roots: ${checkPath}`,
    resolvedPath: checkPath,
  };
}

export function classifyCommand(
  manifest: PhaseCapabilityManifest,
  argv: string[],
): SandboxDecision {
  if (!argv.length) {
    return { allow: false, reason: "empty command" };
  }
  const cmd = argv[0]!;
  const args = argv.slice(1);

  // Broad recursive deletion
  if (
    (cmd === "rm" && (args.includes("-rf") || args.includes("-fr") || args.includes("--recursive"))) ||
    (cmd === "find" && args.includes("-delete"))
  ) {
    if (args.some((a) => a === "/" || a === "/*" || a === "$HOME" || a === "~")) {
      return { allow: false, reason: "unresolved/broad recursive deletion denied" };
    }
    // still deny rm -rf without clear classified target under roots
    const targets = args.filter((a) => !a.startsWith("-"));
    if (!targets.length) {
      return { allow: false, reason: "broad recursive deletion denied" };
    }
    for (const t of targets) {
      const d = classifyPathAccess(manifest, t, "write");
      if (!d.allow) {
        return { allow: false, reason: `deletion target denied: ${d.reason}` };
      }
    }
  }

  if (cmd === "git") {
    return classifyGit(manifest, args);
  }
  if (cmd === "bd" || cmd === "beads") {
    return classifyBd(manifest, args);
  }
  if (cmd === "gh") {
    return classifyGh(manifest, args);
  }

  // generic CLI
  if (!manifest.operations.includes("cli.execute")) {
    return { allow: false, reason: "cli.execute not allowed in phase" };
  }
  // try to classify path args
  for (const a of args) {
    if (a.startsWith("-")) continue;
    if (a.includes("/") || a.startsWith(".")) {
      try {
        const d = classifyPathAccess(manifest, a, "read");
        if (!d.allow && /credential|unrelated|traversal|env\/glob/.test(d.reason)) {
          return d;
        }
      } catch {
        return { allow: false, reason: `unclassifiable path arg: ${a}` };
      }
    }
  }
  return { allow: true, reason: "cli.execute allowed", operation: "cli.execute" };
}

function classifyGit(
  manifest: PhaseCapabilityManifest,
  args: string[],
): SandboxDecision {
  const joined = args.join(" ");
  for (const bad of FORBIDDEN_GIT) {
    if (bad.every((b) => args.includes(b) || joined.includes(bad.join(" ")))) {
      // more precise checks
    }
  }
  if (args.includes("--force") || args.includes("-f") && args[0] === "push") {
    return { allow: false, reason: "force-push denied" };
  }
  if (args[0] === "push" && (args.includes("--force") || args.includes("-f") || args.includes("--force-with-lease"))) {
    return { allow: false, reason: "force-push denied" };
  }
  if (args[0] === "reset" && args.includes("--hard")) {
    return { allow: false, reason: "history rewrite (reset --hard) denied" };
  }
  if (args[0] === "clean" && (args.includes("-xfd") || args.includes("-ffdx") || (args.includes("-x") && args.includes("-f") && args.includes("-d")))) {
    return { allow: false, reason: "git clean -xfd denied" };
  }
  if (args[0] === "rebase" || args.includes("--amend") || args[0] === "filter-branch" || args[0] === "filter-repo") {
    return { allow: false, reason: "history rewrite denied" };
  }

  // protected branch mutation
  if (
    (args[0] === "commit" || args[0] === "merge" || args[0] === "checkout" || args[0] === "switch") &&
    args.some((a) => PROTECTED_BRANCHES.has(a))
  ) {
    // weak check — also flag if checkout main for mutation
  }

  if (args[0] === "push") {
    if (!manifest.operations.includes("git.push")) {
      return {
        allow: false,
        reason: `remote/PR operations before PR phase denied (phase=${manifest.phase})`,
      };
    }
    return { allow: true, reason: "git.push allowed", operation: "git.push" };
  }

  if (
    args[0] === "commit" ||
    args[0] === "add" ||
    args[0] === "cherry-pick" ||
    args[0] === "worktree"
  ) {
    const writeOp =
      manifest.phase === "Integration"
        ? "git.write.integration"
        : "git.write.lane";
    if (!manifest.operations.includes(writeOp) && !manifest.operations.includes("git.write.lane") && !manifest.operations.includes("git.write.integration")) {
      return { allow: false, reason: `git write not allowed in ${manifest.phase}` };
    }
    return { allow: true, reason: "git write allowed", operation: writeOp };
  }

  if (!manifest.operations.includes("git.read")) {
    return { allow: false, reason: "git.read not allowed" };
  }
  return { allow: true, reason: "git read allowed", operation: "git.read" };
}

function classifyBd(
  manifest: PhaseCapabilityManifest,
  args: string[],
): SandboxDecision {
  const mutators = ["create", "update", "close", "comment", "dep"];
  const isMut = mutators.some((m) => args.includes(m) || args[0] === m);
  if (isMut) {
    if (!manifest.operations.includes("bd.write.controller")) {
      return {
        allow: false,
        reason: "child Beads mutation denied (controller write only)",
      };
    }
    return {
      allow: true,
      reason: "controller bd write",
      operation: "bd.write.controller",
    };
  }
  if (!manifest.operations.includes("bd.read")) {
    return { allow: false, reason: "bd.read not allowed" };
  }
  return { allow: true, reason: "bd read", operation: "bd.read" };
}

function classifyGh(
  manifest: PhaseCapabilityManifest,
  args: string[],
): SandboxDecision {
  let commandIndex = 0;
  while (commandIndex < args.length) {
    const arg = args[commandIndex]!;
    if (arg === "-R" || arg === "--repo") {
      commandIndex += 2;
    } else if (
      arg.startsWith("--repo=") ||
      (arg.startsWith("-R") && arg.length > 2)
    ) {
      commandIndex += 1;
    } else {
      break;
    }
  }

  const command = args[commandIndex];
  let prActionIndex = commandIndex + 1;
  while (command === "pr" && prActionIndex < args.length) {
    const arg = args[prActionIndex]!;
    if (arg === "-R" || arg === "--repo") {
      prActionIndex += 2;
    } else if (
      arg.startsWith("--repo=") ||
      (arg.startsWith("-R") && arg.length > 2)
    ) {
      prActionIndex += 1;
    } else {
      break;
    }
  }
  const prAction = command === "pr" ? args[prActionIndex] : undefined;
  if (prAction === "create" || prAction === "merge") {
    if (!manifest.operations.includes("gh.pr")) {
      return {
        allow: false,
        reason: `remote/PR operations before PR phase denied (phase=${manifest.phase})`,
      };
    }
    return { allow: true, reason: "gh.pr allowed", operation: "gh.pr" };
  }

  let explicitApiMethod: string | undefined;
  let apiDefaultsToPost = false;
  let apiEndpoint: string | undefined;
  if (command === "api") {
    for (let i = commandIndex + 1; i < args.length; i += 1) {
      const arg = args[i]!;
      if (arg === "--") {
        apiEndpoint ??= args[i + 1];
        break;
      }
      let option = arg;
      while (option.startsWith("-i") && option.length > 2) {
        option = `-${option.slice(2)}`;
      }
      if (option === "--method" || option === "-X") {
        explicitApiMethod = args[i + 1]?.toUpperCase();
        i += 1;
        continue;
      }
      if (option.startsWith("--method=")) {
        explicitApiMethod = option.slice("--method=".length).toUpperCase();
        continue;
      }
      if (option.startsWith("-X") && option.length > 2) {
        explicitApiMethod = option.slice(2).replace(/^=/, "").toUpperCase();
        continue;
      }
      if (
        option === "-f" ||
        option === "-F" ||
        option === "--raw-field" ||
        option === "--field" ||
        option === "--input"
      ) {
        apiDefaultsToPost = true;
        i += 1;
        continue;
      }
      if (
        (option.startsWith("-f") && option.length > 2) ||
        (option.startsWith("-F") && option.length > 2) ||
        option.startsWith("--raw-field=") ||
        option.startsWith("--field=") ||
        option.startsWith("--input=")
      ) {
        apiDefaultsToPost = true;
        continue;
      }
      if (
        option === "--cache" ||
        option === "-H" ||
        option === "--header" ||
        option === "--hostname" ||
        option === "-q" ||
        option === "--jq" ||
        option === "-p" ||
        option === "--preview" ||
        option === "-t" ||
        option === "--template"
      ) {
        i += 1;
        continue;
      }
      if (
        option.startsWith("--cache=") ||
        (option.startsWith("-H") && option.length > 2) ||
        option.startsWith("--header=") ||
        option.startsWith("--hostname=") ||
        (option.startsWith("-q") && option.length > 2) ||
        option.startsWith("--jq=") ||
        (option.startsWith("-p") && option.length > 2) ||
        option.startsWith("--preview=") ||
        (option.startsWith("-t") && option.length > 2) ||
        option.startsWith("--template=")
      ) {
        continue;
      }
      if (!arg.startsWith("-") && apiEndpoint === undefined) {
        apiEndpoint = arg;
      }
    }
  }

  const apiMethod =
    explicitApiMethod ?? (apiDefaultsToPost ? "POST" : "GET");
  let apiPath: string | undefined;
  let malformedAbsoluteApiUrl = false;
  if (apiEndpoint !== undefined) {
    if (/^https?:\/\//i.test(apiEndpoint)) {
      try {
        apiPath = new URL(apiEndpoint).pathname.replace(
          /^\/(?:api\/v3\/)?/,
          "",
        );
      } catch {
        malformedAbsoluteApiUrl = true;
      }
    } else {
      apiPath = apiEndpoint.replace(/^\//, "").replace(/[?#].*$/, "");
    }
  }
  if (
    command === "api" &&
    GH_MUTATING_METHODS[apiMethod] === true &&
    malformedAbsoluteApiUrl
  ) {
    return { allow: false, reason: "malformed mutating GitHub API URL denied" };
  }
  const isInlineReviewMutation =
    (command === "pr" &&
      (prAction === "comment" || prAction === "review")) ||
    (command === "api" &&
      GH_MUTATING_METHODS[apiMethod] === true &&
      apiPath !== undefined &&
      GH_INLINE_REVIEW_ENDPOINT.test(apiPath));

  if (isInlineReviewMutation) {
    if (!manifest.operations.includes("gh.pr.inline-review")) {
      return {
        allow: false,
        reason: `inline review mutation requires gh.pr.inline-review (phase=${manifest.phase})`,
      };
    }
    return {
      allow: true,
      reason: "gh.pr.inline-review allowed",
      operation: "gh.pr.inline-review",
    };
  }

  if (!manifest.operations.includes("cli.execute")) {
    return { allow: false, reason: "gh not allowed" };
  }
  return { allow: true, reason: "gh read-ish", operation: "cli.execute" };
}

/** Caches must resolve only under runTemp. */
export function resolveWritableCachePath(
  manifest: PhaseCapabilityManifest,
  cacheName: string,
): SandboxDecision {
  if (!cacheName || cacheName.includes("..") || cacheName.startsWith("/")) {
    return { allow: false, reason: "invalid cache name" };
  }
  const target = join(manifest.canonicalRoots.runTemp, "cache", cacheName);
  const d = classifyPathAccess(manifest, target, "write");
  if (!d.allow) {
    return {
      allow: false,
      reason: `cache outside runTemp denied: ${d.reason}`,
    };
  }
  return {
    allow: true,
    reason: "cache under runTemp",
    operation: "fs.write.runTemp",
    resolvedPath: target,
  };
}
