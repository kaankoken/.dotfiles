import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BLOCKING_CLASSES,
  NIT_ONLY_CLASSES,
  reviewRequiresRevision,
} from "../extensions/goal-harness/gate-revision";

const OMP_ROOT = join(import.meta.dir, "..");
const AGENTS = join(OMP_ROOT, "agents");

const REVIEWERS = [
  "spec-reviewer.md",
  "plan-reviewer.md",
  "bite-size-reviewer.md",
  "code-reviewer.md",
] as const;

describe("REVIEW-POLICY (blocking vs nits)", () => {
  test("shared policy file exists with defer-evidence and default PASS", () => {
    const path = join(AGENTS, "REVIEW-POLICY.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toMatch(/Default to PASS/i);
    expect(text).toMatch(/Defer-evidence/);
    expect(text).toMatch(/Never blocking/);
    expect(text).toMatch(/exhaustive evidence/);
    for (const cls of BLOCKING_CLASSES) {
      // policy uses prose labels; ensure core words present
      expect(text.toLowerCase()).toMatch(
        /wrong|impossible|unsafe|unverifiable|dependenc/,
      );
      void cls;
    }
    expect(NIT_ONLY_CLASSES.length).toBeGreaterThan(3);
  });

  test("every reviewer mandates REVIEW-POLICY and default ok true", () => {
    for (const name of REVIEWERS) {
      const text = readFileSync(join(AGENTS, name), "utf8");
      expect(text).toContain("REVIEW-POLICY.md");
      expect(text).toMatch(/Default:.*ok: true|default to \*\*PASS\*\*/i);
      expect(text).toMatch(/ok: false/i);
    }
  });

  test("plan-reviewer defers early evidence factories", () => {
    const text = readFileSync(join(AGENTS, "plan-reviewer.md"), "utf8");
    expect(text).toMatch(/Defer-evidence|defer.*evidence/i);
    expect(text).toMatch(/product/i);
  });

  test("writers do not rewrite for nits under ok true", () => {
    for (const name of [
      "spec-writer.md",
      "plan-writer.md",
      "bite-size-writer.md",
    ]) {
      const text = readFileSync(join(AGENTS, name), "utf8");
      expect(text).toMatch(/ok: true|Nits under/i);
      expect(text).toMatch(/not\*\*\s*rewrite|not rewrite|do not invent/i);
    }
  });

  test("nits never require revision; only ok false does", () => {
    expect(
      reviewRequiresRevision({
        ok: true,
        feedback: "add more Playwright later; evidence incomplete",
        blocking: [],
      }),
    ).toBe(false);
    expect(
      reviewRequiresRevision({
        ok: false,
        feedback: "unsafe",
        blocking: ["remove force-push to main"],
      }),
    ).toBe(true);
  });
});
