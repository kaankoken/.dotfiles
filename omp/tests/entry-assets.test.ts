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

  test("intent-router skill and agent exist with route taxonomy", () => {
    const skill = join(OMP_ROOT, "skills/intent-router/SKILL.md");
    const agent = join(OMP_ROOT, "agents/intent-router.md");
    expect(existsSync(skill)).toBe(true);
    expect(existsSync(agent)).toBe(true);
    const sk = readFileSync(skill, "utf8");
    const ag = readFileSync(agent, "utf8");
    // §4.3 route ids
    for (const route of [
      "harness",
      "design",
      "init",
      "review_pr",
      "code_review",
      "stack",
      "mcp",
      "local",
      "ambiguous",
    ]) {
      expect(sk).toContain(route);
    }
    expect(sk).toMatch(/boundGoal/);
    expect(sk).toMatch(/double-start|already active|at most one/i);
    expect(sk).toMatch(/buildStartMessage|handleHarnessCommand|\/harness/);
    expect(sk).toMatch(/buildDesignStartMessage|\/design/);
    expect(sk).toMatch(/buildReviewPrControllerMessage/);
    expect(sk).toMatch(/\/pr-reviewer/);
    expect(sk).not.toMatch(/\/review-pr\b/);
    expect(sk).not.toMatch(/intent-dispatch\.ts/);
    expect(sk).not.toMatch(/\bcaveman\b/i);
    // agent is thin optional spawn
    expect(ag).toMatch(/intent-router/);
    expect(ag).toMatch(/tools:\s*\[.*read/i);
  });

  test("still no commands/harness.md (extension-only /harness)", () => {
    const files = readdirSync(join(OMP_ROOT, "commands"));
    expect(files).not.toContain("harness.md");
    expect(files).not.toContain("goal.md");
    expect(files).not.toContain("guided-goal.md");
  });

  test("AGENTS.md documents freeform intent routing and lean cold catalog", () => {
    const text = readFileSync(join(OMP_ROOT, "AGENTS.md"), "utf8");
    expect(text).toMatch(/intent-router/);
    expect(text).toMatch(/freeform/i);
    expect(text).not.toMatch(/ultra-core Superpowers|caveman\/ponytail roots/i);
    expect(text.toLowerCase()).not.toMatch(/\bcaveman\b/);
    expect(text).toMatch(/tokensave/);
    expect(text).toMatch(/headroom/);
    expect(text).toMatch(/context-mode/);
    expect(text).toMatch(/context7/);
    expect(text).toMatch(/intent-router/);
    expect(text).toMatch(/beads/);
    expect(text).toMatch(/\/pr-reviewer/);
    expect(text).toMatch(/\/code-review/);
    expect(text).not.toMatch(/\/review-pr\b/);
  });

  test("intent-router agent is outside parity-manifest 19", () => {
    const manifest = JSON.parse(
      readFileSync(join(OMP_ROOT, "agents/parity-manifest.json"), "utf8"),
    ) as { agentCount: number; agents: Array<{ name: string }> };
    expect(manifest.agentCount).toBe(19);
    expect(manifest.agents.map((a) => a.name)).not.toContain("intent-router");
    expect(existsSync(join(OMP_ROOT, "agents/intent-router.md"))).toBe(true);
  });

  test("commands/code-review.md maps to code-reviewer not PR dual-review controller", () => {
    const path = join(OMP_ROOT, "commands/code-review.md");
    expect(existsSync(path)).toBe(true);
    const raw = readFileSync(path, "utf8");
    expect(raw).toMatch(/code-reviewer/);
    expect(raw).toMatch(/REVIEW-POLICY|ponytail-review/i);
    expect(raw).toMatch(/\/pr-reviewer/);
    expect(raw).not.toMatch(/WF7|wf7-|pr-fable-reviewer|pr-grok-judge/i);
    expect(raw).not.toMatch(/\/review-pr\b/);
  });

  test("no always-on stack or mcp-stack slash command files", () => {
    const cmds = readdirSync(join(OMP_ROOT, "commands")).filter((f) =>
      f.endsWith(".md"),
    );
    for (const name of [
      "stack-rust.md",
      "stack-ios.md",
      "stack-android.md",
      "mcp-stack.md",
      "harness.md",
      "pr-reviewer.md",
    ]) {
      expect(cmds).not.toContain(name);
    }
    // Only empty-shell flow files
    for (const name of ["init.md", "design.md", "code-review.md"]) {
      expect(cmds).toContain(name);
    }
  });

  test("intent-router dispatches stack via skill:// and mcp via /mcp enable", () => {
    const raw = readFileSync(
      join(OMP_ROOT, "skills/intent-router/SKILL.md"),
      "utf8",
    );
    expect(raw).toMatch(/skill:\/\/stack-/);
    expect(raw).toMatch(/\/mcp enable context7/);
    expect(raw).not.toMatch(/commands\/stack-/);
    expect(raw).not.toMatch(/\/mcp-stack/);
  });

  test("stack skills remain on disk for path loads", () => {
    for (const name of ["stack-rust", "stack-ios", "stack-android", "stack-gcp"]) {
      const raw = readFileSync(
        join(OMP_ROOT, "skills", name, "SKILL.md"),
        "utf8",
      );
      expect(raw).toMatch(/on-demand|not cold/i);
      expect(raw).not.toMatch(/user invokes \/stack-/i);
    }
  });
});
