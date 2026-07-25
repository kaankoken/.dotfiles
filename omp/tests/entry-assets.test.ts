import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OMP_ROOT = join(import.meta.dir, "..");

describe("harness entry assets", () => {
  test("commands/init.md is scaffold-only /init", () => {
    const path = join(OMP_ROOT, "commands/init.md");
    expect(existsSync(path)).toBe(true);
    const raw = readFileSync(path, "utf8");
    expect(raw).toMatch(/\/init|init/);
    expect(raw).toMatch(/project-init|scaffold/i);
    expect(raw).not.toMatch(/Spec → Plan → Implement|automatic Spec|open PR after init/i);
    expect(raw).not.toMatch(/phase.*Implement.*PR/i);
  });

  test("no goal/guided-goal/harness command files shadow natives", () => {
    const cmdDir = join(OMP_ROOT, "commands");
    expect(existsSync(cmdDir)).toBe(true);
    const files = readdirSync(cmdDir);
    expect(files).not.toContain("goal.md");
    expect(files).not.toContain("guided-goal.md");
    expect(files).not.toContain("harness.md");
    expect(files).toContain("init.md");
  });

  test("prompts/harness.md is internal controller not a command", () => {
    const path = join(OMP_ROOT, "prompts/harness.md");
    expect(existsSync(path)).toBe(true);
    expect(existsSync(join(OMP_ROOT, "commands/harness.md"))).toBe(false);
    const raw = readFileSync(path, "utf8");
    expect(raw).toMatch(/controller|internal|harness/i);
    expect(raw).not.toMatch(/^name:\s*harness\s*$/m);
  });

  test("goal-harness skill is OMP-specific without Superpowers bodies", () => {
    const path = join(OMP_ROOT, "skills/goal-harness/SKILL.md");
    expect(existsSync(path)).toBe(true);
    const raw = readFileSync(path, "utf8");
    expect(raw).toMatch(/omp|Oh My Pi|\/harness/i);
    expect(raw).toMatch(/superpowers|brainstorming|writing-plans|test-driven-development/i);
    expect(raw).not.toMatch(/# Test-Driven Development|# Iron Law|NO PRODUCTION CODE WITHOUT/);
    expect(raw).not.toMatch(/## When to Use\n\n\*\*Always:\*\*/);
    expect(raw).not.toMatch(/~\/\.pi\//);
  });

  test("project templates use OMP paths and preserve AGENTS/CLAUDE", () => {
    const rootT = join(OMP_ROOT, "templates/project/AGENTS.md.tmpl");
    const subT = join(OMP_ROOT, "templates/project/subdir-AGENTS.md.tmpl");
    expect(existsSync(rootT)).toBe(true);
    expect(existsSync(subT)).toBe(true);
    const root = readFileSync(rootT, "utf8");
    const sub = readFileSync(subT, "utf8");
    expect(root).not.toMatch(/~\/\.pi\/|modules\/agents\/pi/);
    expect(sub).not.toMatch(/~\/\.pi\//);
    expect(root).toMatch(/omp|Oh My Pi|\/harness|\/init/i);
    expect(root).toMatch(/symlink|ln -sfn AGENTS\.md CLAUDE\.md/);
    expect(root).toMatch(/preserve|do not overwrite|existing AGENTS/i);
    expect(sub).toMatch(/ln -sfn AGENTS\.md CLAUDE\.md/);
  });
});
