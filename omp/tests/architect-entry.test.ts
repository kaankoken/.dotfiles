import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const OMP_ROOT = join(import.meta.dir, "..");
const SKILL_DIR = join(OMP_ROOT, "skills/architect");
const RUNTIME_PATH = "~/.omp/agent/skills/architect/SKILL.md";
// Built by concatenation so this file never matches its own guard.
const COLD_NEEDLE = "skill:" + "//architect";

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const VENDORED = [
  "SKILL.md",
  "references/modern-patterns.md",
  "references/scalability-reliability-guide.md",
  "references/data-architecture-patterns.md",
  "references/migration-modernization-guide.md",
  "references/api-gateway-service-mesh.md",
  "references/operational-playbook.md",
  "assets/planning/architecture-blueprint.md",
  "assets/patterns/microservices-template.md",
  "assets/patterns/event-driven-template.md",
  "assets/operations/scalability-checklist.md",
];

describe("architect entry contract", () => {
  test("commands/architect.md is a stop-clean in-session shell", () => {
    const p = join(OMP_ROOT, "commands/architect.md");
    expect(existsSync(p)).toBe(true);
    const cmd = readFileSync(p, "utf8");
    expect(cmd).toMatch(/never auto|do \*\*not\*\*/i);
    expect(cmd).toMatch(/\/design/);
    expect(cmd).toMatch(/\/harness/);
    expect(cmd).toContain(RUNTIME_PATH);
    expect(cmd).toMatch(/docs\/adr/);
    expect(cmd).toMatch(/next free `?NNNN`?|NNNN/);
  });

  test("skills/architect/SKILL.md carries name + OMP ADR contract", () => {
    const p = join(SKILL_DIR, "SKILL.md");
    expect(existsSync(p)).toBe(true);
    const skill = readFileSync(p, "utf8");
    expect(skill).toMatch(/(^|\n)name:\s*architect(\n|$)/);
    expect(skill).toMatch(/MADR-lite/i);
    expect(skill).toMatch(/docs\/adr/);
    expect(skill).toMatch(/controller|session writes/i);
  });

  test("stub phrases are gone from live wiring", () => {
    for (const sub of ["skills", "workflows", "agents"]) {
      for (const f of walk(join(OMP_ROOT, sub))) {
        if (!/\.(md|ts|json)$/.test(f)) continue;
        const raw = readFileSync(f, "utf8");
        expect(raw, f).not.toMatch(/until then brainstorming only/i);
        expect(raw, f).not.toMatch(/architect[^\n]*exists later/i);
        expect(raw, f).not.toMatch(/Future architect/i);
      }
    }
  });

  test("vendored tree is link-clean, drops dead upstream files, and is complete", () => {
    // Link/guard sweep FIRST so adaptation failures surface file-by-file
    // (Task 3) before the completeness asserts (SKILL.md arrives in Task 4).
    const files = walk(SKILL_DIR).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const raw = readFileSync(f, "utf8");
      // Dead upstream content must not be vendored or referenced.
      expect(raw, f).not.toMatch(/\.\.\/software-/);
      expect(raw, f).not.toMatch(/architecture-trends-2026/);
      expect(raw, f).not.toMatch(/sources\.json/);
      expect(raw, f).not.toMatch(/adr-template\.md/);
      // Every markdown link must be root-relative (references/… or assets/…)
      // or external — and must resolve on disk.
      for (const m of raw.matchAll(/\]\(([^)]+)\)/g)) {
        const target = m[1].trim();
        if (/^(https?:|#|mailto:)/.test(target)) continue;
        expect(target, `${f} → ${target}`).toMatch(/^(references|assets)\//);
        expect(existsSync(join(SKILL_DIR, target.split("#")[0])), `${f} → ${target}`).toBe(true);
      }
      // Path mentions outside link syntax must resolve too.
      for (const m of raw.matchAll(/(?:references|assets)\/[A-Za-z0-9_./-]+\.md/g)) {
        expect(existsSync(join(SKILL_DIR, m[0])), `${f} → ${m[0]}`).toBe(true);
      }
    }
    // Completeness: exactly the ten kept upstream files + SKILL.md.
    for (const rel of VENDORED) {
      expect(existsSync(join(SKILL_DIR, rel)), rel).toBe(true);
    }
    expect(files.length).toBe(VENDORED.length);
  });

  test("design flow embeds architect by required path load", () => {
    for (const rel of [
      "skills/design-flow/SKILL.md",
      "agents/pdr-writer.md",
      "agents/arc42-writer.md",
      "workflows/design-flow.ts",
      "extensions/design-flow/workflow.ts",
    ]) {
      expect(readFileSync(join(OMP_ROOT, rel), "utf8"), rel).toContain(RUNTIME_PATH);
    }
    // Spec §7: ADR phase untouched by architect.
    const adr = readFileSync(join(OMP_ROOT, "agents/adr-writer.md"), "utf8");
    expect(adr).not.toMatch(/skills\/architect\/SKILL\.md/);
    // AGENTS.md documents the standalone entry.
    const agentsDoc = readFileSync(join(OMP_ROOT, "AGENTS.md"), "utf8");
    expect(agentsDoc).toMatch(/\/architect/);
  });

  test("design-manifest wires architect by name (writers only)", () => {
    const m = JSON.parse(
      readFileSync(join(OMP_ROOT, "agents/design-manifest.json"), "utf8"),
    ) as {
      agentCount: number;
      phases: string[];
      agents: Array<{ name: string; requiredSkills?: string[] }>;
    };
    const by = Object.fromEntries(
      m.agents.map((a) => [a.name, a.requiredSkills ?? []]),
    );
    expect(by["pdr-writer"]).toContain("architect");
    expect(by["pdr-writer"]).toContain("brainstorming");
    expect(by["pdr-writer"]).toContain("ponytail");
    expect(by["arc42-writer"]).toContain("architect");
    expect(by["arc42-writer"]).toContain("brainstorming");
    expect(by["adr-writer"]).not.toContain("architect");
    expect(by["adr-writer"]).toContain("ponytail");
    expect(by["adr-writer"]).not.toContain("brainstorming");
    expect(by["pdr-reviewer"] ?? []).not.toContain("architect");
    expect(by["arc42-reviewer"] ?? []).not.toContain("architect");
    expect(m.agentCount).toBe(5);
    expect(m.phases).toEqual(["Intake", "Pdr", "Arc42", "Adr", "Handoff"]);
  });

  test("cold catalog never resolves architect", () => {
    const roots = ["commands", "skills", "workflows", "agents", "extensions"];
    const files = roots.flatMap((r) => walk(join(OMP_ROOT, r)));
    files.push(join(OMP_ROOT, "AGENTS.md"), join(OMP_ROOT, "config.yml"));
    for (const f of files) {
      if (!/\.(md|ts|json|yml)$/.test(f)) continue;
      expect(readFileSync(f, "utf8"), f).not.toContain(COLD_NEEDLE);
    }
  });
});
