import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const OMP_ROOT = join(import.meta.dir, "..");

describe("design entry stop-clean contract", () => {
  test("/design entry forbids auto-harness and superpowers paths", () => {
    const cmd = readFileSync(join(OMP_ROOT, "commands/design.md"), "utf8");
    expect(cmd).toMatch(/do \*\*not\*\*|Do \*\*not\*\*|never auto/i);
    expect(cmd).toMatch(/\/harness/);
    expect(cmd).toMatch(/docs\/adr/);

    const skill = readFileSync(
      join(OMP_ROOT, "skills/design-flow/SKILL.md"),
      "utf8",
    );
    expect(skill).toMatch(
      /Never write under `docs\/superpowers\/`|never.*docs\/superpowers/i,
    );
    expect(skill).toMatch(/resolveModelRoute|model-router/);
    expect(skill).toMatch(/best-effort|bd/);
    expect(skill).toMatch(/controller writes|Controller writes/i);
    expect(skill).toMatch(/JSON-only|JSON only/i);
    expect(skill).toMatch(/no novel ADR|minItems\s*1/i);
    expect(skill).toMatch(/resolveModelRoute|resolveReviewerModel/);

    const facade = readFileSync(
      join(OMP_ROOT, "workflows/design-flow.ts"),
      "utf8",
    );
    expect(facade).toMatch(/Never auto-start \/harness/);
    expect(facade).toMatch(/buildDesignStartMessage/);
  });
});
