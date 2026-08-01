import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ANDROID_EXPLICIT_ONLY_SKILLS,
  DOMAIN_PACKS,
  DOMAIN_COLD_START_FORBIDDEN_GLOBS,
  entrySkillNamesForMarker,
  matchSkillGlob,
  packsForStackMarker,
  packOverlayIncludeGlobs,
  skillMatchesAnyGlob,
} from "../extensions/goal-harness/domain-packs";

const OMP_ROOT = join(import.meta.dir, "..");

describe("domain packs (on-demand)", () => {
  test("stack markers map to pack ids (gcp never marker-derived)", () => {
    expect(packsForStackMarker("rust")).toEqual(["rust"]);
    expect(packsForStackMarker("ios")).toEqual(["ios"]);
    expect(packsForStackMarker("android")).toEqual(["android"]);
    expect(packsForStackMarker("mixed")).toEqual(["rust", "ios", "android"]);
    expect(packsForStackMarker("unknown")).toEqual([]);
  });

  test("entry skills are real names, not pack labels", () => {
    expect(entrySkillNamesForMarker("rust")).toContain("rust-router");
    expect(entrySkillNamesForMarker("rust")).not.toContain("rust-skills");
    expect(entrySkillNamesForMarker("ios")).toContain("axiom-swiftui");
    expect(entrySkillNamesForMarker("ios")).not.toContain("axiom");
    expect(entrySkillNamesForMarker("android")).toContain("android-cli");
    expect(entrySkillNamesForMarker("android")).not.toContain("android");
    expect(DOMAIN_PACKS.gcp.entrySkills).toContain("gcloud");
    expect(DOMAIN_PACKS.gcp.entrySkills).not.toContain("gcp");
  });

  test("glob match for pack overlays", () => {
    expect(matchSkillGlob("rust-*", "rust-router")).toBe(true);
    expect(matchSkillGlob("rust-*", "coding-guidelines")).toBe(false);
    expect(matchSkillGlob("axiom-*", "axiom-swiftui")).toBe(true);
    expect(matchSkillGlob("m0*", "m01-ownership")).toBe(true);
    expect(skillMatchesAnyGlob("unsafe-checker", DOMAIN_PACKS.rust.includeGlobs)).toBe(
      true,
    );
    expect(matchSkillGlob("gke-*", "gke-basics")).toBe(true);
  });

  test("cold-start forbidden globs cover all domain packs", () => {
    for (const pack of Object.values(DOMAIN_PACKS)) {
      for (const g of pack.includeGlobs) {
        expect(DOMAIN_COLD_START_FORBIDDEN_GLOBS).toContain(g);
      }
    }
  });

  test("pack overlay globs match pack includeGlobs", () => {
    expect(packOverlayIncludeGlobs("rust")).toEqual(DOMAIN_PACKS.rust.includeGlobs);
    expect(packOverlayIncludeGlobs("ios")).toContain("axiom-*");
    expect(packOverlayIncludeGlobs("android")).toContain("android-cli");
    expect(packOverlayIncludeGlobs("gcp")).toContain("gcloud");
  });

  test("stack labels remain for AGENTS.md / STACK_SKILL_SETS compatibility", () => {
    expect(DOMAIN_PACKS.rust.stackLabels).toEqual(["rust-skills"]);
    expect(DOMAIN_PACKS.ios.stackLabels).toEqual(["axiom"]);
    expect(DOMAIN_PACKS.android.stackLabels).toContain("android");
    expect(DOMAIN_PACKS.gcp.stackLabels).toEqual(["gcp", "google-cloud"]);
  });

  test("DOMAIN_PACKS.gcp is live with cloud root fragments", () => {
    expect(DOMAIN_PACKS.gcp.id).toBe("gcp");
    expect(DOMAIN_PACKS.gcp.stackLabels).toContain("gcp");
    expect(DOMAIN_PACKS.gcp.rootFragments.some((f) => f.includes("google-skills"))).toBe(
      true,
    );
    expect(DOMAIN_PACKS.gcp.entrySkills).toContain("gcloud");
    // packsForStackMarker mixed still excludes gcp
    expect(packsForStackMarker("mixed")).not.toContain("gcp");
  });

  test("android default pack excludes Play/Google-services bleed", () => {
    for (const name of ANDROID_EXPLICIT_ONLY_SKILLS) {
      expect(DOMAIN_PACKS.android.includeGlobs).not.toContain(name);
    }
    expect(DOMAIN_PACKS.android.includeGlobs).toContain("android-cli");
  });

  test("README cold catalog matches lean allowlist", () => {
    const text = readFileSync(join(OMP_ROOT, "README.md"), "utf8");
    expect(text).toMatch(/intent-router/);
    expect(text).toMatch(/beads/);
    expect(text.toLowerCase()).not.toMatch(/\bcaveman\b/);
    expect(text).toMatch(/headroom/);
    expect(text).toMatch(/context-mode/);
    expect(text).toMatch(/stack-gcp|google\/skills|google-skills/);
  });
});
