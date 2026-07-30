import { describe, expect, test } from "bun:test";
import {
  DOMAIN_PACKS,
  DOMAIN_COLD_START_FORBIDDEN_GLOBS,
  entrySkillNamesForMarker,
  matchSkillGlob,
  packsForStackMarker,
  packOverlayIncludeGlobs,
  skillMatchesAnyGlob,
} from "../extensions/goal-harness/domain-packs";

describe("domain packs (on-demand)", () => {
  test("stack markers map to pack ids", () => {
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
  });

  test("glob match for pack overlays", () => {
    expect(matchSkillGlob("rust-*", "rust-router")).toBe(true);
    expect(matchSkillGlob("rust-*", "coding-guidelines")).toBe(false);
    expect(matchSkillGlob("axiom-*", "axiom-swiftui")).toBe(true);
    expect(matchSkillGlob("m0*", "m01-ownership")).toBe(true);
    expect(skillMatchesAnyGlob("unsafe-checker", DOMAIN_PACKS.rust.includeGlobs)).toBe(
      true,
    );
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
  });

  test("stack labels remain for AGENTS.md / STACK_SKILL_SETS compatibility", () => {
    expect(DOMAIN_PACKS.rust.stackLabels).toEqual(["rust-skills"]);
    expect(DOMAIN_PACKS.ios.stackLabels).toEqual(["axiom"]);
    expect(DOMAIN_PACKS.android.stackLabels).toContain("android");
  });
});
