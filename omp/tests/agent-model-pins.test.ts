import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const AGENTS = join(import.meta.dir, "../agents");

/** Every role agent must pin a designated model (soft task + hard path). */
describe("agent model pins", () => {
  test("every agents/*.md role has model: frontmatter", () => {
    const files = readdirSync(AGENTS).filter(
      (f) => f.endsWith(".md") && f !== "REVIEW-POLICY.md",
    );
    expect(files.length).toBeGreaterThan(10);
    const missing: string[] = [];
    const pins: Record<string, string> = {};
    for (const f of files) {
      const raw = readFileSync(join(AGENTS, f), "utf8");
      expect(raw.startsWith("---"), f).toBe(true);
      const fm = raw.split("---", 2)[1] ?? "";
      const m = fm.match(/^model:\s*(.+)$/m);
      if (!m) missing.push(f);
      else pins[f] = m[1]!.trim();
    }
    expect(missing).toEqual([]);
    // Big gates must not default to Grok
    expect(pins["spec-writer.md"]).toMatch(/fable/i);
    expect(pins["plan-writer.md"]).toMatch(/fable/i);
    expect(pins["spec-reviewer.md"]).toMatch(/opus/i);
    expect(pins["plan-reviewer.md"]).toMatch(/opus/i);
    expect(pins["implementer.md"]).toMatch(/grok/i);
    // OpenAI demote: writers not sol primary
    expect(pins["spec-writer.md"]).not.toMatch(/sol|terra/i);
    expect(pins["plan-writer.md"]).not.toMatch(/sol|terra/i);
  });
});
