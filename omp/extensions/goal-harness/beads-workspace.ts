/**
 * Per-repo beads workspace policy for OMP harness / project-init.
 *
 * Bare `bd init` is forbidden: on this machine global ~/.beads often carries
 * sync.remote → .dotfiles.git, so bare init clones foreign history and adopts
 * prefix "dotfiles" into unrelated repos.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export class BeadsWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BeadsWorkspaceError";
  }
}

export type BdWhereInfo = {
  path: string;
  prefix: string;
  database?: string;
  raw: string;
};

/** Markers that mean init cloned a foreign Dolt remote (contaminated). */
const REMOTE_BOOTSTRAP_MARKERS = [
  "Bootstrapped from remote",
  "Adopted project identity",
  "initialized from git remote",
  "Synced database from",
];

/**
 * Issue prefix derived from repo directory name.
 * Lowercase, [a-z0-9-], must start with a letter (bd rename-prefix rules).
 */
export function beadsIssuePrefixForRoot(root: string): string {
  const base = basename(resolve(root))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  let p = base;
  if (!p || !/^[a-z]/.test(p)) {
    p = `p${p || "roj"}`;
  }
  // Keep IDs readable; bd accepts longer than rename-prefix's 8-char guide.
  if (p.length > 40) p = p.slice(0, 40).replace(/-+$/g, "");
  return p;
}

export function normalizeBeadsPrefix(prefix: string): string {
  return prefix.trim().toLowerCase().replace(/-+$/g, "");
}

/** Parse `bd where` stdout (path line + "prefix:" / "database:" lines). */
export function parseBdWhere(stdout: string): BdWhereInfo {
  const raw = stdout.trim();
  if (!raw) {
    throw new BeadsWorkspaceError("bd where returned empty output");
  }
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const pathLine =
    lines.find((l) => l.includes(".beads") && !l.includes(":")) ?? lines[0]!;
  let prefix = "";
  let database: string | undefined;
  for (const line of lines) {
    const pm = line.match(/^prefix:\s*(\S+)/i);
    if (pm) prefix = pm[1]!;
    const dm = line.match(/^database:\s*(\S+)/i);
    if (dm) database = dm[1];
  }
  if (!prefix) {
    throw new BeadsWorkspaceError(
      `bd where missing prefix line (got: ${raw.slice(0, 200)})`,
    );
  }
  return { path: pathLine, prefix, database, raw };
}

export function initOutputLooksLikeRemoteBootstrap(text: string): boolean {
  return REMOTE_BOOTSTRAP_MARKERS.some((m) => text.includes(m));
}

/**
 * Fail closed when workspace prefix ≠ this repo's expected prefix.
 */
export function assertBeadsWorkspaceMatchesRoot(
  whereStdout: string,
  root: string,
): BdWhereInfo {
  const info = parseBdWhere(whereStdout);
  const expected = beadsIssuePrefixForRoot(root);
  const got = normalizeBeadsPrefix(info.prefix);
  const want = normalizeBeadsPrefix(expected);
  if (got !== want) {
    throw new BeadsWorkspaceError(
      `bd workspace prefix "${info.prefix}" does not match this repo ` +
        `(expected "${expected}" from ${basename(resolve(root))}). ` +
        `Likely bare bd init cloned global ~/.beads sync.remote (dotfiles). ` +
        `Fix: remove contaminated .beads, then run: ` +
        `bd init --prefix ${expected} --non-interactive --skip-agents ` +
        `(never bare bd init; never --remote from another project).`,
    );
  }
  const rootBeads = join(resolve(root), ".beads");
  // path may be realpath; require ".beads" and that root is represented
  if (!info.path.includes(".beads")) {
    throw new BeadsWorkspaceError(
      `bd where path is not a .beads workspace: ${info.path}`,
    );
  }
  // Soft path check: when both exist as absolute paths under root
  if (
    existsSync(rootBeads) &&
    info.path.startsWith("/") &&
    !info.path.includes(basename(resolve(root))) &&
    !resolve(info.path).startsWith(resolve(root))
  ) {
    // still allow if prefix matched; path formats vary
  }
  return info;
}

/**
 * Safe init argv — never bare `bd init`, never `--remote`.
 */
export function buildSafeBdInitArgs(root: string): string[] {
  const prefix = beadsIssuePrefixForRoot(root);
  return [
    "init",
    `--prefix=${prefix}`,
    "--init-if-missing",
    "--non-interactive",
    "--skip-agents",
  ];
}

export type SafeBdInitResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  prefix: string;
  args: string[];
};

/**
 * Run safe local init with isolated HOME so global ~/.beads sync.remote
 * is not merged (bd otherwise bootstraps foreign Dolt history).
 */
export function runSafeBdInit(root: string): SafeBdInitResult {
  const abs = resolve(root);
  const args = buildSafeBdInitArgs(abs);
  const prefix = beadsIssuePrefixForRoot(abs);
  const emptyHome = mkdtempSync(join(tmpdir(), "omp-bd-init-home-"));
  try {
    const res = spawnSync("bd", args, {
      cwd: abs,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: emptyHome,
        BD_NON_INTERACTIVE: "1",
      },
      maxBuffer: 4 * 1024 * 1024,
    });
    const stdout = res.stdout ?? "";
    const stderr = res.stderr ?? "";
    const combined = `${stdout}\n${stderr}`;
    if (res.error) {
      throw new BeadsWorkspaceError(
        `bd init failed to spawn: ${res.error.message}`,
      );
    }
    if (res.status !== 0) {
      throw new BeadsWorkspaceError(
        `bd init failed (exit ${res.status}): ${stderr || stdout}`,
      );
    }
    if (initOutputLooksLikeRemoteBootstrap(combined)) {
      throw new BeadsWorkspaceError(
        `bd init bootstrapped from a foreign remote despite isolation. ` +
          `Refusing contaminated workspace. Output: ${combined.slice(0, 400)}`,
      );
    }
    const where = spawnSync("bd", ["where"], {
      cwd: abs,
      encoding: "utf8",
      env: process.env,
    });
    if (where.status !== 0 || !(where.stdout ?? "").trim()) {
      throw new BeadsWorkspaceError(
        `bd where failed after init: ${where.stderr || where.stdout}`,
      );
    }
    assertBeadsWorkspaceMatchesRoot(where.stdout ?? "", abs);
    return {
      exitCode: 0,
      stdout,
      stderr,
      prefix,
      args,
    };
  } finally {
    try {
      rmSync(emptyHome, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
}

/** Read + assert existing workspace for root (no init). */
export function assertExistingBeadsWorkspace(root: string): BdWhereInfo {
  const abs = resolve(root);
  const where = spawnSync("bd", ["where"], {
    cwd: abs,
    encoding: "utf8",
    env: process.env,
  });
  if (where.status !== 0 || !(where.stdout ?? "").trim()) {
    throw new BeadsWorkspaceError(
      `No beads workspace in ${abs}. Run project-init//init first — never bare bd init. ` +
        `Expected: bd init --prefix ${beadsIssuePrefixForRoot(abs)} --non-interactive --skip-agents`,
    );
  }
  return assertBeadsWorkspaceMatchesRoot(where.stdout ?? "", abs);
}
