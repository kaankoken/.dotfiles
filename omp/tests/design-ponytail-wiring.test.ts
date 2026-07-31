import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
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

  test("PR fable/sol load ponytail-review and ponytail-audit", () => {
    for (const name of ["pr-fable-reviewer", "pr-sol-reviewer"]) {
      const raw = readFileSync(join(OMP_ROOT, `agents/${name}.md`), "utf8");
      expect(raw).toMatch(/ponytail-review/);
      expect(raw).toMatch(/ponytail-audit/);
      expect(raw).toMatch(/delete:|stdlib:|yagni:/);
      expect(raw).toMatch(/tools:\s*\[pr_review_snapshot\]/);
    }
  });

  test("PR grok-judge loads ponytail-review and ponytail-audit", () => {
    const raw = readFileSync(join(OMP_ROOT, "agents/pr-grok-judge.md"), "utf8");
    expect(raw).toMatch(/Load live skills|load.*ponytail-review/i);
    expect(raw).toMatch(/ponytail-review/);
    expect(raw).toMatch(/ponytail-audit/);
    expect(raw).toMatch(/tools:\s*\[pr_review_snapshot\]/);
    // must be load contract, not merely tag mention in passing
    expect(raw).toMatch(/multi-file|snapshot/i);
  });
});

test("design-manifest requiredSkills contain zero caveman", () => {
  const m = JSON.parse(
    readFileSync(join(OMP_ROOT, "agents/design-manifest.json"), "utf8"),
  ) as { agents: Array<{ name: string; requiredSkills?: string[] }> };
  for (const a of m.agents) {
    expect(a.requiredSkills ?? [], a.name).not.toContain("caveman");
  }
});

test("pack overlays and templates do not require caveman", () => {
  for (const pack of ["pack-rust", "pack-ios", "pack-android"]) {
    const y = parseYaml(
      readFileSync(join(OMP_ROOT, "configs", `${pack}.yml`), "utf8"),
    ) as { skills?: { includeSkills?: string[] } };
    const include = y.skills?.includeSkills ?? [];
    expect(include, pack).not.toContain("caveman");
    expect(include, pack).not.toContain("caveman-*");
    expect(include, pack).not.toContain("cavecrew");
    expect(include).toContain("ponytail");
  }
  const rootT = readFileSync(
    join(OMP_ROOT, "templates/project/AGENTS.md.tmpl"),
    "utf8",
  );
  const subT = readFileSync(
    join(OMP_ROOT, "templates/project/subdir-AGENTS.md.tmpl"),
    "utf8",
  );
  expect(rootT.toLowerCase()).not.toMatch(/\bcaveman\b/);
  expect(subT.toLowerCase()).not.toMatch(/\bcaveman\b/);
});

test("goal-harness and design-flow default skill mandates omit caveman", () => {
  const gh = readFileSync(
    join(OMP_ROOT, "skills/goal-harness/SKILL.md"),
    "utf8",
  );
  const df = readFileSync(
    join(OMP_ROOT, "skills/design-flow/SKILL.md"),
    "utf8",
  );
  expect(gh.toLowerCase()).not.toMatch(/\bcaveman\b/);
  expect(df.toLowerCase()).not.toMatch(/\bcaveman\b/);
  expect(gh).toMatch(/ponytail/);
});
