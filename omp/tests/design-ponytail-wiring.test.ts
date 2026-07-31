import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REQUIRED_SKILLS_BY_ROLE } from "../extensions/goal-harness/skills";
import { MILESTONE_ANGLES } from "../workflows/milestone";

const OMP_ROOT = join(import.meta.dir, "..");

describe("ponytail reviewer wiring", () => {
  test("harness code-reviewer names both skills", () => {
    const raw = readFileSync(join(OMP_ROOT, "agents/code-reviewer.md"), "utf8");
    expect(raw).toMatch(/ponytail-review/);
    expect(raw).toMatch(/ponytail-audit/);
    const parity = JSON.parse(
      readFileSync(join(OMP_ROOT, "agents/parity-manifest.json"), "utf8"),
    ) as {
      agents: Array<{ name: string; requiredSuperpowers: string[] }>;
    };
    const cr = parity.agents.find((a) => a.name === "code-reviewer")!;
    expect(cr.requiredSuperpowers).toContain("ponytail-review");
    expect(cr.requiredSuperpowers).toContain("ponytail-audit");
    expect(REQUIRED_SKILLS_BY_ROLE["task-reviewer"].skills).toEqual(
      expect.arrayContaining(["ponytail-review", "ponytail-audit"]),
    );
  });

  test("milestone ponytail angle references both skills", () => {
    const angle = MILESTONE_ANGLES.find((a) => a.includes("ponytail"));
    expect(angle).toBeTruthy();
    expect(angle).toMatch(/ponytail-review/);
    expect(angle).toMatch(/ponytail-audit/);
  });

  test("WF7 fable/sol load ponytail-review and ponytail-audit", () => {
    for (const name of ["wf7-fable-reviewer", "wf7-sol-reviewer"]) {
      const raw = readFileSync(join(OMP_ROOT, `agents/${name}.md`), "utf8");
      expect(raw).toMatch(/ponytail-review/);
      expect(raw).toMatch(/ponytail-audit/);
      expect(raw).toMatch(/delete:|stdlib:|yagni:/);
      expect(raw).toMatch(/tools:\s*\[pr_review_snapshot\]/);
    }
  });

  test("WF7 grok-judge loads ponytail-review and ponytail-audit", () => {
    const raw = readFileSync(join(OMP_ROOT, "agents/wf7-grok-judge.md"), "utf8");
    expect(raw).toMatch(/Load live skills|load.*ponytail-review/i);
    expect(raw).toMatch(/ponytail-review/);
    expect(raw).toMatch(/ponytail-audit/);
    expect(raw).toMatch(/tools:\s*\[pr_review_snapshot\]/);
    // must be load contract, not merely tag mention in passing
    expect(raw).toMatch(/multi-file|snapshot/i);
  });
});
