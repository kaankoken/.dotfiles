import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OMP_ROOT = join(import.meta.dir, "..");
const MANIFEST = join(OMP_ROOT, "agents/design-manifest.json");
const PARITY = join(OMP_ROOT, "agents/parity-manifest.json");

describe("design-manifest pack", () => {
  test("lists five design agents on disk", () => {
    const m = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
      agentCount: number;
      agents: Array<{ name: string; ompDestination: string }>;
    };
    expect(m.agentCount).toBe(5);
    expect(m.agents.map((a) => a.name).sort()).toEqual(
      [
        "adr-writer",
        "arc42-reviewer",
        "arc42-writer",
        "pdr-reviewer",
        "pdr-writer",
      ].sort(),
    );
    for (const a of m.agents) {
      const path = join(OMP_ROOT, a.ompDestination.replace(/^omp\//, ""));
      expect(existsSync(path)).toBe(true);
      const raw = readFileSync(path, "utf8");
      expect(raw).toMatch(new RegExp(`name:\\s*${a.name}`));
    }
  });

  test("does not inflate goal-harness 19-role parity", () => {
    const parity = JSON.parse(readFileSync(PARITY, "utf8")) as {
      agentCount: number;
      agents: Array<{ name: string }>;
    };
    expect(parity.agentCount).toBe(19);
    for (const name of [
      "pdr-writer",
      "arc42-writer",
      "adr-writer",
      "wf7-fable-reviewer",
    ]) {
      expect(parity.agents.some((a) => a.name === name)).toBe(false);
    }
  });

  test("schemas referenced exist", () => {
    for (const rel of [
      "schemas/pdr.output.schema.json",
      "schemas/arc42.output.schema.json",
      "schemas/adr.output.schema.json",
    ]) {
      expect(existsSync(join(OMP_ROOT, rel))).toBe(true);
    }
  });

  test("adr-writer is JSON-only; controller owns disk writes", () => {
    const m = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
      agents: Array<{
        name: string;
        writeScope: string;
        allowedTools: string[];
        reasoningEffort: string;
        modelPhase: string;
      }>;
    };
    const adr = m.agents.find((a) => a.name === "adr-writer")!;
    expect(adr.writeScope).toBe("none");
    expect(adr.allowedTools).not.toContain("write");
    expect(adr.allowedTools).not.toContain("edit");
    expect(adr.reasoningEffort).toBe("max");
    expect(adr.modelPhase).toBe("design-adr");

    const md = readFileSync(join(OMP_ROOT, "agents/adr-writer.md"), "utf8");
    expect(md).toMatch(/JSON only|Emit.*JSON/i);
    expect(md).toMatch(/Controller will write|controller writes/i);
    expect(md).not.toMatch(/then write each ADR file/i);
    // tools frontmatter must not grant write/edit
    expect(md).toMatch(/tools:\s*\[[^\]]*\]/);
    expect(md).not.toMatch(/tools:\s*\[[^\]]*\bwrite\b/);
    expect(md).not.toMatch(/tools:\s*\[[^\]]*\bedit\b/);
  });
});
