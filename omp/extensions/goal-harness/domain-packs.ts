/**
 * Domain skill packs loaded on demand — not in cold-start includeSkills.
 *
 * Pack roots stay in config.yml customDirectories so harness resolveSkill and
 * filesystem reads work. Cold includeSkills is only intent-router + beads;
 * stack-* routers and pack entry skills load via skill://stack-* or stack-scout.
 *
 * GCP pack roots: google/skills cloud category (non-recursive discovery).
 * Install: git clone https://github.com/google/skills
 *   → ~/.claude/plugins/marketplaces/google-skills (pin SHA in README).
 * Android pack excludes Play/Google-services bleed (explicit path load only).
 */

import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import type { StackMarker } from "./stack-skills";

export type DomainPackId = "rust" | "ios" | "android" | "gcp";

export type DomainPack = {
  id: DomainPackId;
  /** Logical stack label (matches STACK_SKILL_SETS / AGENTS.md) */
  stackLabels: string[];
  /** customDirectories path fragments (expand ~ yourself) */
  rootFragments: string[];
  /**
   * Entry skills to load first when pack is activated (must be real skill
   * directory names under a pack root).
   */
  entrySkills: string[];
  /**
   * Globs for optional full-catalog overlays (configs/pack-*.yml).
   * Matched against skill directory names only.
   */
  includeGlobs: string[];
};

/** Authoritative pack map — names only, never skill bodies. */
export const DOMAIN_PACKS: Record<DomainPackId, DomainPack> = {
  rust: {
    id: "rust",
    stackLabels: ["rust-skills"],
    rootFragments: [
      "marketplaces/rust-skills/skills",
      ".claude/plugins/marketplaces/rust-skills/skills",
    ],
    entrySkills: ["rust-router", "coding-guidelines"],
    includeGlobs: [
      "rust-*",
      "coding-guidelines",
      "core-*",
      "domain-*",
      "m0*",
      "m1*",
      "meta-cognition-parallel",
      "unsafe-checker",
    ],
  },
  ios: {
    id: "ios",
    stackLabels: ["axiom"],
    rootFragments: [
      "axiom-marketplace/axiom-codex/skills",
      ".claude/plugins/marketplaces/axiom-marketplace/axiom-codex/skills",
    ],
    entrySkills: ["axiom-swiftui", "axiom-swift", "axiom-build"],
    includeGlobs: ["axiom-*"],
  },
  android: {
    id: "android",
    stackLabels: ["android", "compose-performance", "android-testing"],
    rootFragments: [".agents/skills"],
    entrySkills: [
      "android-cli",
      "testing-setup",
      "migrate-xml-views-to-jetpack-compose",
      "navigation-3",
    ],
    // Play/Google-services skills are NOT default android — explicit path only
    // (Play ≠ GCP; see skills/stack-android/SKILL.md).
    includeGlobs: [
      "android-cli",
      "adaptive",
      "agp-9-upgrade",
      "appfunctions",
      "camera1-to-camerax",
      "display-*",
      "edge-to-edge",
      "migrate-xml-views-to-jetpack-compose",
      "navigation-3",
      "perfetto-*",
      "r8-analyzer",
      "styles",
      "testing-setup",
    ],
  },
  gcp: {
    id: "gcp",
    stackLabels: ["gcp", "google-cloud"],
    rootFragments: [
      "marketplaces/google-skills/skills/cloud",
      ".claude/plugins/marketplaces/google-skills/skills/cloud",
    ],
    entrySkills: [
      "gcloud",
      "google-cloud-recipe-auth",
      "google-cloud-recipe-onboarding",
    ],
    includeGlobs: [
      "gcloud",
      "gke-*",
      "bigquery-*",
      "bigtable-*",
      "cloud-*",
      "google-cloud-*",
      "google-agents-cli-onboarding",
      "alloydb-*",
      "spanner-*",
      "gemini-*",
      "agent-platform-*",
      "firebase-basics",
      "datalineage-*",
      "workload-manager-*",
      "detection-engineering-*",
    ],
  },
};

/** Skills distilled out of default android (explicit path / ask only). */
export const ANDROID_EXPLICIT_ONLY_SKILLS = [
  "engage-sdk-integration",
  "play-billing-library-version-upgrade",
  "verified-email",
] as const;

/** Cold-start includeSkills must never list these domain globs. */
export const DOMAIN_COLD_START_FORBIDDEN_GLOBS: string[] = [
  ...DOMAIN_PACKS.rust.includeGlobs,
  ...DOMAIN_PACKS.ios.includeGlobs,
  ...DOMAIN_PACKS.android.includeGlobs,
  ...DOMAIN_PACKS.gcp.includeGlobs,
];

export function expandHome(path: string, home = homedir()): string {
  if (path.startsWith("~/")) return join(home, path.slice(2));
  if (path === "~") return home;
  return path;
}

/**
 * Resolve pack skill roots that exist on disk (absolute paths).
 * Accepts config customDirectories plus known fragments under $HOME.
 */
export function resolvePackRoots(
  pack: DomainPack,
  customDirectories: string[] = [],
  home = homedir(),
): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const add = (p: string) => {
    const abs = resolve(expandHome(p, home));
    if (seen.has(abs)) return;
    if (!existsSync(abs)) return;
    seen.add(abs);
    roots.push(abs);
  };

  for (const d of customDirectories) {
    const abs = expandHome(d, home);
    if (pack.rootFragments.some((f) => abs.includes(f) || abs.endsWith(f))) {
      add(abs);
    }
  }
  for (const frag of pack.rootFragments) {
    add(join(home, frag.replace(/^\//, "")));
  }
  return roots;
}

/** Glob-ish match for skill names (Bun.Glob-compatible * only). */
export function matchSkillGlob(pattern: string, name: string): boolean {
  if (pattern === name) return true;
  if (!pattern.includes("*")) return pattern === name;
  const re = new RegExp(
    `^${pattern
      .split("*")
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  );
  return re.test(name);
}

export function skillMatchesAnyGlob(name: string, globs: string[]): boolean {
  return globs.some((g) => matchSkillGlob(g, name));
}

/**
 * Discover skill dirs under pack roots that match includeGlobs.
 * Non-recursive (OMP layout: <root>/<name>/SKILL.md).
 */
export function listPackSkillNames(
  pack: DomainPack,
  customDirectories: string[] = [],
  home = homedir(),
): string[] {
  const names = new Set<string>();
  for (const root of resolvePackRoots(pack, customDirectories, home)) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (skillMatchesAnyGlob(ent, pack.includeGlobs)) {
        if (existsSync(join(root, ent, "SKILL.md"))) names.add(ent);
      }
    }
  }
  return [...names].sort();
}

/**
 * Absolute SKILL.md paths for entry skills (first existing root wins per name).
 */
export function resolveEntrySkillPaths(
  pack: DomainPack,
  customDirectories: string[] = [],
  home = homedir(),
): Array<{ name: string; path: string }> {
  const roots = resolvePackRoots(pack, customDirectories, home);
  const out: Array<{ name: string; path: string }> = [];
  for (const name of pack.entrySkills) {
    for (const root of roots) {
      const p = join(root, name, "SKILL.md");
      if (existsSync(p)) {
        out.push({ name, path: p });
        break;
      }
    }
  }
  return out;
}

/** Map stack marker → domain pack ids (mixed unions). GCP is never marker-derived. */
export function packsForStackMarker(marker: StackMarker): DomainPackId[] {
  switch (marker) {
    case "rust":
      return ["rust"];
    case "ios":
      return ["ios"];
    case "android":
      return ["android"];
    case "mixed":
      return ["rust", "ios", "android"];
    default:
      return [];
  }
}

/**
 * Live skill names to load for a stack marker (entry skills only).
 * Does not use pack labels like "rust-skills" — those are AGENTS.md labels.
 */
export function entrySkillNamesForMarker(marker: StackMarker): string[] {
  const names: string[] = [];
  for (const id of packsForStackMarker(marker)) {
    names.push(...DOMAIN_PACKS[id].entrySkills);
  }
  return names;
}

/** Overlay includeSkills = cold core + pack globs (for configs/pack-*.yml). */
export function packOverlayIncludeGlobs(packId: DomainPackId): string[] {
  return [...DOMAIN_PACKS[packId].includeGlobs];
}
