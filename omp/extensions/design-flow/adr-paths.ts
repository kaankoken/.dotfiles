/**
 * ADR path helpers for design-flow.
 * Only docs/adr/NNNN-slug.md — never superpowers plans/specs.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, normalize, relative, resolve, sep } from "node:path";

export const ADR_DIR = "docs/adr" as const;

const FORBIDDEN_PREFIXES = [
  "docs/superpowers",
  "docs/plans",
  ".superpowers",
] as const;

export class AdrPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdrPathError";
  }
}

/** kebab-case slug from title; empty → "untitled". */
export function slugifyTitle(title: string): string {
  const s = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s.length > 0 ? s : "untitled";
}

export function formatAdrId(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 9999) {
    throw new AdrPathError(`ADR id out of range: ${n}`);
  }
  return String(n).padStart(4, "0");
}

/** Scan docs/adr for NNNN-*.md and return next integer id. */
export function nextAdrNumber(repoRoot: string): number {
  const dir = join(repoRoot, ADR_DIR);
  if (!existsSync(dir)) return 1;
  let max = 0;
  for (const name of readdirSync(dir)) {
    const m = name.match(/^(\d{4})-/);
    if (!m) continue;
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return max + 1;
}

export function adrRelativePath(id: number, title: string): string {
  return `${ADR_DIR}/${formatAdrId(id)}-${slugifyTitle(title)}.md`;
}

export function adrAbsolutePath(
  repoRoot: string,
  id: number,
  title: string,
): string {
  return join(repoRoot, adrRelativePath(id, title));
}

/**
 * Fail closed if path escapes docs/adr or hits forbidden superpowers/plans trees.
 */
export function assertAllowedAdrWritePath(
  repoRoot: string,
  absoluteOrRelative: string,
): string {
  const root = resolve(repoRoot);
  const abs = normalize(
    absoluteOrRelative.startsWith(root)
      ? absoluteOrRelative
      : resolve(root, absoluteOrRelative),
  );
  const rel = relative(root, abs);
  if (rel.startsWith("..") || rel === "") {
    throw new AdrPathError(`ADR path escapes repo: ${absoluteOrRelative}`);
  }
  const relPosix = rel.split(sep).join("/");
  for (const bad of FORBIDDEN_PREFIXES) {
    if (relPosix === bad || relPosix.startsWith(`${bad}/`)) {
      throw new AdrPathError(
        `forbidden design artifact path (superpowers/plans not allowed): ${relPosix}`,
      );
    }
  }
  if (!(relPosix === ADR_DIR || relPosix.startsWith(`${ADR_DIR}/`))) {
    throw new AdrPathError(
      `ADR writes must stay under ${ADR_DIR}/ (got ${relPosix})`,
    );
  }
  if (relPosix === ADR_DIR || relPosix.endsWith("/")) {
    throw new AdrPathError(`ADR path must be a file under ${ADR_DIR}/`);
  }
  if (!/^\d{4}-[a-z0-9][a-z0-9-]*\.md$/.test(relPosix.slice(ADR_DIR.length + 1))) {
    throw new AdrPathError(
      `ADR filename must match NNNN-slug.md (got ${relPosix})`,
    );
  }
  return abs;
}

/** MADR-lite markdown body. */
export function renderAdrMarkdown(input: {
  title: string;
  status: string;
  context: string;
  decision: string;
  consequences: string;
  date?: string;
  id?: number;
}): string {
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const heading =
    input.id !== undefined
      ? `# ${formatAdrId(input.id)}. ${input.title}`
      : `# ${input.title}`;
  return [
    heading,
    "",
    `- Status: ${input.status}`,
    `- Date: ${date}`,
    "",
    "## Context",
    "",
    input.context.trim(),
    "",
    "## Decision",
    "",
    input.decision.trim(),
    "",
    "## Consequences",
    "",
    input.consequences.trim(),
    "",
  ].join("\n");
}
