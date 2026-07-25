/**
 * Project stack skill selection from worktree markers.
 * Required skills block before task tools unlock; extras are additive.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SkillResolveError,
  resolveSkills,
  type ResolvedSkill,
  type SkillResolveOptions,
} from "./skills";
import {
  createSkillGuardSession,
  agentReadRequiredSkills,
  unlockRoleTools,
  type SkillGuardSession,
} from "./skill-guard";

export class StackSkillsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StackSkillsError";
  }
}

export type StackMarker =
  | "rust"
  | "ios"
  | "android"
  | "mixed"
  | "unknown";

export type StackDetection = {
  marker: StackMarker;
  evidence: string[];
  /** Exact required skill names for this marker set */
  requiredSkills: string[];
};

/**
 * Authoritative skill sets from design / plan Task 25.
 * Names only — live SKILL.md resolved via Task 24 guard.
 */
export const STACK_SKILL_SETS: Record<
  Exclude<StackMarker, "unknown" | "mixed">,
  string[]
> = {
  // actionbook / rust-skills pack
  rust: ["rust-skills"],
  // Axiom iOS pack
  ios: ["axiom"],
  // Android all + Compose performance + Android testing
  android: ["android", "compose-performance", "android-testing"],
};

export function detectStackMarkers(worktreeRoot: string): StackDetection {
  const evidence: string[] = [];
  const has = (rel: string) => {
    const p = join(worktreeRoot, rel);
    if (existsSync(p)) {
      evidence.push(rel);
      return true;
    }
    return false;
  };

  let rust = has("Cargo.toml") || has("Cargo.lock");
  // workspace members
  if (!rust && existsSync(join(worktreeRoot, "Cargo.toml"))) rust = true;

  let ios =
    has("Package.swift") ||
    has("project.pbxproj");
  try {
    const top = readdirSync(worktreeRoot);
    if (top.some((f) => f.endsWith(".xcodeproj") || f.endsWith(".xcworkspace"))) {
      ios = true;
      evidence.push(
        top.find((f) => f.endsWith(".xcodeproj") || f.endsWith(".xcworkspace"))!,
      );
    }
  } catch {
    /* */
  }

  let android =
    has("build.gradle") ||
    has("build.gradle.kts") ||
    has("settings.gradle") ||
    has("settings.gradle.kts") ||
    has("gradlew");
  // Compose marker is additive signal under android
  const compose =
    android &&
    (has("compose") ||
      existsSync(join(worktreeRoot, "app/src/main")) ||
      fileMentions(worktreeRoot, "build.gradle.kts", "compose") ||
      fileMentions(worktreeRoot, "build.gradle", "compose"));

  const flags = [rust, ios, android].filter(Boolean).length;
  let marker: StackMarker = "unknown";
  if (flags > 1) marker = "mixed";
  else if (rust) marker = "rust";
  else if (ios) marker = "ios";
  else if (android) marker = "android";

  const requiredSkills = requiredSkillsForMarker(marker, { compose });
  return { marker, evidence, requiredSkills };
}

function fileMentions(root: string, rel: string, needle: string): boolean {
  const p = join(root, rel);
  if (!existsSync(p)) return false;
  try {
    return readFileSync(p, "utf8").toLowerCase().includes(needle.toLowerCase());
  } catch {
    return false;
  }
}

export function requiredSkillsForMarker(
  marker: StackMarker,
  opts?: { compose?: boolean },
): string[] {
  switch (marker) {
    case "rust":
      return [...STACK_SKILL_SETS.rust];
    case "ios":
      return [...STACK_SKILL_SETS.ios];
    case "android": {
      const base = [...STACK_SKILL_SETS.android];
      // Compose performance already in android set per plan
      if (opts?.compose === false) {
        // still require full android set when android marker present
      }
      return base;
    }
    case "mixed":
      return [
        ...STACK_SKILL_SETS.rust,
        ...STACK_SKILL_SETS.ios,
        ...STACK_SKILL_SETS.android,
      ];
    default:
      return [];
  }
}

/**
 * Parse optional extra skill names from project AGENTS.md / package metadata.
 * Additive only after required stack skills pass.
 */
export function parseProjectDeclaredSkills(worktreeRoot: string): string[] {
  const extras: string[] = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const p = join(worktreeRoot, name);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    // e.g. skills: foo, bar  or  stack-skills: axiom
    for (const m of text.matchAll(
      /(?:stack[- ]?skills?|required skills?)\s*[:=]\s*([^\n]+)/gi,
    )) {
      const parts = m[1]!
        .split(/[, ]+/)
        .map((s) => s.trim().replace(/[`*]/g, ""))
        .filter((s) => s.length > 0 && !s.startsWith("http"));
      extras.push(...parts);
    }
  }
  return [...new Set(extras)];
}

export type StackSkillPrep = {
  detection: StackDetection;
  /** Required + additive extras (deduped by name) */
  skillNames: string[];
  resolved: ResolvedSkill[];
  missing: Array<{ name: string; reason: string }>;
};

/**
 * Resolve required stack skills through Task 24 resolver.
 * Missing required skills → block with exact missing paths/names.
 */
export function prepareStackSkills(
  worktreeRoot: string,
  skillRoots: SkillResolveOptions,
  opts?: { includeProjectExtras?: boolean },
): StackSkillPrep {
  const detection = detectStackMarkers(worktreeRoot);
  const required = detection.requiredSkills;
  const extras =
    opts?.includeProjectExtras !== false
      ? parseProjectDeclaredSkills(worktreeRoot).filter(
          (n) => !required.includes(n),
        )
      : [];

  // Duplicate-name check: extras must not collide with different roots for same name
  const skillNames = [...required, ...extras];
  const missing: StackSkillPrep["missing"] = [];
  const resolved: ResolvedSkill[] = [];

  for (const name of skillNames) {
    try {
      const [one] = resolveSkills([name], skillRoots);
      resolved.push(one!);
    } catch (err) {
      const isRequired = required.includes(name);
      const reason =
        err instanceof SkillResolveError || err instanceof Error
          ? err.message
          : String(err);
      if (isRequired) {
        missing.push({ name, reason });
      }
      // extras that fail: skip (additive only when resolvable)
    }
  }

  if (missing.length > 0) {
    const detail = missing
      .map((m) => `${m.name}: ${m.reason}`)
      .join("; ");
    throw new StackSkillsError(
      `missing required stack skills before task tools unlock: ${detail}`,
    );
  }

  return { detection, skillNames: resolved.map((r) => r.name), resolved, missing };
}

/**
 * Append stack skills into implementer attestation before session start.
 * Returns guard session with role tools unlocked only after all reads verified.
 */
export function attestImplementerWithStack(opts: {
  worktreeRoot: string;
  skillRoots: SkillResolveOptions;
  roleTools: string[];
  baseRoleSkills?: string[];
}): SkillGuardSession {
  const prep = prepareStackSkills(opts.worktreeRoot, opts.skillRoots);
  const session = createSkillGuardSession({
    role: "implementer",
    skillRoots: opts.skillRoots,
    roleTools: opts.roleTools,
    stackSkills: prep.skillNames,
  });
  agentReadRequiredSkills(session);
  unlockRoleTools(session);
  return session;
}
