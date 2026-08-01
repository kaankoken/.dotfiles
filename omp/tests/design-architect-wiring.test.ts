import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const OMP_ROOT = join(import.meta.dir, "..");
const ARCH_PATH = "~/.agents/skills/architect/SKILL.md";

function read(rel: string): string {
  return readFileSync(join(OMP_ROOT, rel), "utf8");
}

describe("architect skill design-flow wiring", () => {
  test("design-flow skill names architect path and fail-open", () => {
    const skill = read("skills/design-flow/SKILL.md");
    expect(skill).toContain(ARCH_PATH);
    expect(skill).toMatch(/fail-open/i);
    expect(skill).not.toMatch(/Future architect skill hooks here/i);
    expect(skill).not.toMatch(/When skill `architect` exists later/i);
  });

  test("commands/design.md points writers at architect; no auto-harness", () => {
    const cmd = read("commands/design.md");
    expect(cmd).toContain(ARCH_PATH);
    expect(cmd).toMatch(/do \*\*not\*\*|Do \*\*not\*\*|never auto/i);
    expect(cmd).toMatch(/\/harness/);
  });

  test("facade + workflow prompts path-load architect", () => {
    const facade = read("workflows/design-flow.ts");
    expect(facade).toContain(ARCH_PATH);
    expect(facade).toMatch(/fail-open/i);
    expect(facade).not.toMatch(/Future architect skill/i);

    const wf = read("extensions/design-flow/workflow.ts");
    expect(wf).toContain(ARCH_PATH);
    expect(wf).toMatch(/fail-open/i);
  });

  test("writer agents name architect absolute path", () => {
    for (const f of [
      "agents/pdr-writer.md",
      "agents/arc42-writer.md",
      "agents/adr-writer.md",
    ]) {
      const body = read(f);
      expect(body, f).toContain(ARCH_PATH);
    }
  });

  test("design-manifest writers require bare architect; adr skips brainstorming", () => {
    const m = JSON.parse(read("agents/design-manifest.json")) as {
      agents: Array<{ name: string; requiredSkills?: string[] }>;
    };
    const by = Object.fromEntries(m.agents.map((a) => [a.name, a.requiredSkills ?? []]));

    expect(by["pdr-writer"]).toContain("architect");
    expect(by["pdr-writer"]).toContain("brainstorming");
    expect(by["pdr-writer"]).toContain("ponytail");

    expect(by["arc42-writer"]).toContain("architect");
    expect(by["arc42-writer"]).toContain("brainstorming");

    expect(by["adr-writer"]).toContain("architect");
    expect(by["adr-writer"]).toContain("ponytail");
    expect(by["adr-writer"]).not.toContain("brainstorming");

    expect(by["pdr-reviewer"] ?? []).not.toContain("architect");
    expect(by["arc42-reviewer"] ?? []).not.toContain("architect");
  });
});
