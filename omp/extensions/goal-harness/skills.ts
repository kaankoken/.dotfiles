/**
 * Live Superpowers skill resolution.
 * Names + paths + hashes only — never vendors skill bodies into OMP.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  accessSync,
  constants as fsConstants,
  lstatSync,
} from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import requiredSkillsSchema from "../../schemas/required-skills.schema.json";

export class SkillResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillResolveError";
  }
}

/** Runtime role keys for REQUIRED_SKILLS_BY_ROLE. */
export type SkillRole =
  | "parent-orchestrator"
  | "gate-controller"
  | "spec-producer"
  | "plan-producer"
  | "bitesize-producer"
  | "implementation-organizer"
  | "implementer"
  | "task-fixer"
  | "bug-producer"
  | "bug-fixer"
  | "spec-reviewer"
  | "plan-reviewer"
  | "bitesize-reviewer"
  | "task-reviewer"
  | "milestone-organizer"
  | "pr-agent";

export type RoleSkillRequirement = {
  skills: string[];
  fromParityManifest?: boolean;
  parityAgent?: string;
  forbid?: string[];
  includeAutomaticStackSkills?: boolean;
};

/**
 * Exact runtime mapping from plan Task 24.
 * Stores names and manifest references only — never skill content.
 */
export const REQUIRED_SKILLS_BY_ROLE: Record<SkillRole, RoleSkillRequirement> =
  {
    "parent-orchestrator": {
      skills: [
        "using-superpowers",
        "goal-harness",
        "requesting-code-review",
      ],
    },
    "gate-controller": {
      skills: [
        "using-superpowers",
        "goal-harness",
        "requesting-code-review",
      ],
    },
    "spec-producer": {
      skills: [
        "brainstorming",
        "receiving-code-review",
        "caveman",
        "ponytail",
      ],
    },
    "plan-producer": {
      skills: [
        "writing-plans",
        "receiving-code-review",
        "caveman",
        "ponytail",
      ],
      fromParityManifest: true,
      parityAgent: "plan-writer",
    },
    "bitesize-producer": {
      skills: [
        "writing-plans",
        "receiving-code-review",
        "caveman",
        "ponytail",
      ],
      fromParityManifest: true,
      parityAgent: "bite-size-writer",
    },
    "implementation-organizer": {
      skills: [
        "subagent-driven-development",
        "using-git-worktrees",
        "requesting-code-review",
      ],
    },
    implementer: {
      skills: [
        "subagent-driven-development",
        "test-driven-development",
        "receiving-code-review",
        "ponytail",
        "caveman",
      ],
      includeAutomaticStackSkills: true,
    },
    "task-fixer": {
      skills: [
        "subagent-driven-development",
        "test-driven-development",
        "receiving-code-review",
        "ponytail",
        "caveman",
      ],
      includeAutomaticStackSkills: true,
    },
    "bug-producer": {
      skills: [
        "systematic-debugging",
        "test-driven-development",
        "receiving-code-review",
      ],
    },
    "bug-fixer": {
      skills: [
        "systematic-debugging",
        "test-driven-development",
        "receiving-code-review",
      ],
    },
    "spec-reviewer": {
      skills: [],
      fromParityManifest: true,
      parityAgent: "spec-reviewer",
      forbid: ["receiving-code-review"],
    },
    "plan-reviewer": {
      skills: [],
      fromParityManifest: true,
      parityAgent: "plan-reviewer",
      forbid: ["receiving-code-review"],
    },
    "bitesize-reviewer": {
      skills: [],
      fromParityManifest: true,
      parityAgent: "bite-size-reviewer",
      forbid: ["receiving-code-review"],
    },
    "task-reviewer": {
      skills: ["ponytail-review", "ponytail-audit"],
      fromParityManifest: true,
      parityAgent: "code-reviewer",
      forbid: ["receiving-code-review"],
    },
    "milestone-organizer": {
      skills: [
        "requesting-code-review",
        "verification-before-completion",
      ],
    },
    "pr-agent": {
      skills: ["finishing-a-development-branch"],
    },
  };

export const REQUIRED_SKILLS_SCHEMA = requiredSkillsSchema;

export type ResolvedSkill = {
  name: string;
  /** Canonical realpath to SKILL.md */
  path: string;
  sha256: string;
  /** Optional version from frontmatter or package */
  version?: string;
  bytes: number;
};

export type SkillResolveOptions = {
  /**
   * Directories whose *children* are skill folders containing SKILL.md.
   * Nested roots are NOT auto-scanned unless listed here.
   */
  customDirectories: string[];
};

function sha256Bytes(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function parseOptionalVersion(content: string): string | undefined {
  const m = content.match(/^version:\s*["']?([^\s"']+)/m);
  return m?.[1];
}

/**
 * Minimal schema validation for REQUIRED_SKILLS_BY_ROLE (no external AJV dep).
 */
export function validateRequiredSkillsMapping(
  mapping: unknown = REQUIRED_SKILLS_BY_ROLE,
): { ok: true } | { ok: false; reason: string } {
  if (!mapping || typeof mapping !== "object") {
    return { ok: false, reason: "mapping not object" };
  }
  for (const [role, req] of Object.entries(
    mapping as Record<string, RoleSkillRequirement>,
  )) {
    if (!req || typeof req !== "object") {
      return { ok: false, reason: `role ${role}: invalid` };
    }
    if (!Array.isArray(req.skills)) {
      return { ok: false, reason: `role ${role}: skills not array` };
    }
    for (const s of req.skills) {
      if (typeof s !== "string" || !s) {
        return { ok: false, reason: `role ${role}: empty skill name` };
      }
    }
    if (req.forbid) {
      for (const f of req.forbid) {
        if (req.skills.includes(f)) {
          return {
            ok: false,
            reason: `role ${role}: forbidden skill ${f} listed in skills`,
          };
        }
      }
    }
  }
  return { ok: true };
}

/**
 * Discover skill directories under customDirectories only (direct children).
 * Returns map name → list of candidate SKILL.md absolute paths.
 */
export function discoverSkillCandidates(
  opts: SkillResolveOptions,
): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const root of opts.customDirectories) {
    const abs = resolve(root);
    if (!existsSync(abs)) continue;
    let entries: string[];
    try {
      entries = readdirSync(abs);
    } catch {
      continue;
    }
    for (const child of entries) {
      const skillDir = join(abs, child);
      const skillMd = join(skillDir, "SKILL.md");
      if (!existsSync(skillMd)) continue;
      // Only direct child dirs — nested skill roots under subfolders ignored
      try {
        const st = lstatSync(skillDir);
        if (!st.isDirectory() && !st.isSymbolicLink()) continue;
      } catch {
        continue;
      }
      const list = found.get(child) ?? [];
      list.push(skillMd);
      found.set(child, list);
    }
  }
  return found;
}

/**
 * Resolve one skill by name: canonicalize, dedupe identical realpaths,
 * reject different realpath duplicates, hash complete bytes.
 */
export function resolveSkill(
  name: string,
  opts: SkillResolveOptions,
): ResolvedSkill {
  if (!name || name.includes("/") || name.includes("..")) {
    throw new SkillResolveError(`invalid skill name: ${name}`);
  }
  const candidates = discoverSkillCandidates(opts).get(name) ?? [];
  if (candidates.length === 0) {
    throw new SkillResolveError(`missing skill: ${name}`);
  }

  const byReal = new Map<string, string>();
  for (const p of candidates) {
    let real: string;
    try {
      real = realpathSync(p);
    } catch {
      throw new SkillResolveError(`unreadable skill path: ${p}`);
    }
    byReal.set(real, p);
  }

  if (byReal.size > 1) {
    throw new SkillResolveError(
      `duplicate skill ${name}: different realpaths ${[...byReal.keys()].join(", ")}`,
    );
  }

  const path = [...byReal.keys()][0]!;
  try {
    accessSync(path, fsConstants.R_OK);
  } catch {
    throw new SkillResolveError(`unreadable skill file: ${path}`);
  }

  let content: Buffer;
  try {
    content = readFileSync(path);
  } catch {
    throw new SkillResolveError(`unreadable skill file: ${path}`);
  }

  const text = content.toString("utf8");
  return {
    name,
    path,
    sha256: sha256Bytes(content),
    version: parseOptionalVersion(text),
    bytes: content.length,
  };
}

/** Resolve many skills; fails closed on any missing/duplicate. */
export function resolveSkills(
  names: string[],
  opts: SkillResolveOptions,
): ResolvedSkill[] {
  return names.map((n) => resolveSkill(n, opts));
}

/**
 * Expand role requirements (including optional parity-manifest merge).
 * Returns skill *names* only.
 */
export function skillNamesForRole(
  role: SkillRole,
  parity?: {
    agents: Array<{
      name: string;
      requiredSuperpowers?: string[];
      requiredStackSkills?: string[];
    }>;
  },
  stackSkills: string[] = [],
): string[] {
  const req = REQUIRED_SKILLS_BY_ROLE[role];
  if (!req) throw new SkillResolveError(`unknown role: ${role}`);
  const names = new Set(req.skills);
  if (req.fromParityManifest && parity && req.parityAgent) {
    const agent = parity.agents.find((a) => a.name === req.parityAgent);
    if (agent) {
      for (const s of agent.requiredSuperpowers ?? []) names.add(s);
      for (const s of agent.requiredStackSkills ?? []) names.add(s);
    }
  }
  if (req.includeAutomaticStackSkills) {
    for (const s of stackSkills) names.add(s);
  }
  for (const f of req.forbid ?? []) {
    names.delete(f);
  }
  return [...names];
}

/**
 * Beads attestation payload: path/hash/version only — never skill content.
 */
export function beadsSkillAttestation(
  skills: ResolvedSkill[],
): Array<{ name: string; path: string; sha256: string; version?: string }> {
  return skills.map((s) => ({
    name: s.name,
    path: s.path,
    sha256: s.sha256,
    ...(s.version ? { version: s.version } : {}),
  }));
}

/**
 * Detect if content under omp agents/prompts/skills/goal-harness embeds
 * Superpowers skill body markers (copied authoritative text).
 */
export function findCopiedSkillBodies(rootDir: string): string[] {
  const offenders: string[] = [];
  const markers = [
    "# Test-Driven Development",
    "NO PRODUCTION CODE WITHOUT A FAILING TEST",
    "## Iron Law",
    "Using Superpowers",
  ];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git") continue;
        walk(p);
      } else if (ent.isFile() && /\.(md|ts|js|txt)$/.test(ent.name)) {
        const text = readFileSync(p, "utf8");
        if (markers.some((m) => text.includes(m))) {
          offenders.push(p);
        }
      }
    }
  };
  walk(rootDir);
  return offenders;
}

export function rehashFile(path: string): string {
  return sha256Bytes(readFileSync(path));
}
