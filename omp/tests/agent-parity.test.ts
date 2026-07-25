import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const OMP_ROOT = join(import.meta.dir, "..");
const MANIFEST_PATH = join(OMP_ROOT, "agents/parity-manifest.json");
const SCHEMA_PATH = join(OMP_ROOT, "schemas/parity-manifest.schema.json");

const expectedAgents = [
  "project-init",
  "spec-writer",
  "spec-reviewer",
  "plan-writer",
  "plan-reviewer",
  "bite-size-writer",
  "bite-size-reviewer",
  "implementer",
  "milestone-organizer",
  "code-reviewer",
  "code-graph-scout",
  "code-search-scout",
  "docs-scout",
  "web-scout",
  "web-browse-scout",
  "browser-use-scout",
  "webwright-scout",
  "stack-scout",
  "pr-opener",
] as const;

const requiredFields = [
  "name",
  "piSource",
  "ompDestination",
  "phase",
  "purpose",
  "inputs",
  "outputs",
  "writeScope",
  "allowedTools",
  "forbiddenActions",
  "requiredSuperpowers",
  "requiredStackSkills",
  "outputSchema",
  "modelRoute",
  "reasoningEffort",
  "worktreeResponsibility",
  "reviewResponsibility",
  "piBaseline",
  "ompNativeDeltas",
] as const;

const allowedNativeDeltas = new Set([
  "strict-output-schemas",
  "fail-closed-post-validation",
  "narrower-tools-write-scopes",
  "corrected-superpowers-ownership",
  "direct-live-skill-md-loading",
  "omp-native-hashline-lsp-ast-search-web-task",
  "real-harness-managed-worktrees",
  "bundled-omp-scout-reviewer-librarian-strengths",
  "beads-broker-ownership",
]);

function parseFrontmatter(text: string): {
  name?: string;
  description?: string;
  body: string;
} {
  if (!text.startsWith("---")) return { body: text };
  const parts = text.split("---", 3);
  if (parts.length < 3) return { body: text };
  const fm: Record<string, string> = {};
  const lines = parts[1].trim().split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const colon = line.indexOf(":");
    if (colon === -1) {
      i++;
      continue;
    }
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    if (val === ">" || val === "|") {
      const chunks: string[] = [];
      i++;
      while (
        i < lines.length &&
        (lines[i].startsWith("  ") || lines[i].startsWith("\t"))
      ) {
        chunks.push(lines[i].trim());
        i++;
      }
      fm[key] = chunks.join(" ");
      continue;
    }
    fm[key] = val.replace(/^"|"$/g, "");
    i++;
  }
  return {
    name: fm.name,
    description: fm.description,
    body: parts[2],
  };
}

function piRoot(): string {
  const env = process.env.PI_HARNESS_ROOT;
  expect(env && env.length > 0).toBe(true);
  return env!;
}

describe("19-agent Pi parity contract", () => {
  test("parity-manifest.json exists with exactly 19 ordered agents", () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
    expect(existsSync(SCHEMA_PATH)).toBe(true);
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      agentCount: number;
      agents: Array<Record<string, unknown>>;
    };
    expect(manifest.agentCount).toBe(19);
    expect(manifest.agents.length).toBe(19);
    expect(manifest.agents.map((a) => a.name)).toEqual([...expectedAgents]);
    // ui-designer must not inflate count
    expect(manifest.agents.some((a) => a.name === "ui-designer")).toBe(false);
  });

  test("every entry has required fields and valid native deltas only", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      agents: Array<Record<string, unknown>>;
    };
    for (const entry of manifest.agents) {
      for (const field of requiredFields) {
        expect(field in entry).toBe(true);
      }
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.piSource).toBe("string");
      expect(typeof entry.ompDestination).toBe("string");
      expect(Array.isArray(entry.inputs)).toBe(true);
      expect(Array.isArray(entry.outputs)).toBe(true);
      expect(Array.isArray(entry.allowedTools)).toBe(true);
      expect(Array.isArray(entry.forbiddenActions)).toBe(true);
      expect(Array.isArray(entry.requiredSuperpowers)).toBe(true);
      expect(Array.isArray(entry.requiredStackSkills)).toBe(true);
      expect(Array.isArray(entry.ompNativeDeltas)).toBe(true);
      for (const d of entry.ompNativeDeltas as string[]) {
        expect(allowedNativeDeltas.has(d)).toBe(true);
      }
      // no Superpowers instruction bodies embedded
      const blob = JSON.stringify(entry);
      expect(blob).not.toMatch(/# Test-Driven Development|# Iron Law|NO PRODUCTION CODE WITHOUT/);
      expect(blob).not.toMatch(/SKILL\.md\n---/);
    }
  });

  test("each entry matches its Pi source frontmatter/body baseline", () => {
    const root = piRoot();
    const agentsDir = join(root, "agents");
    expect(existsSync(agentsDir)).toBe(true);
    const onDisk = readdirSync(agentsDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
    expect(onDisk.sort()).toEqual([...expectedAgents].sort());

    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      agents: Array<Record<string, any>>;
    };

    for (const entry of manifest.agents) {
      const piPath = join(root, "agents", `${entry.name}.md`);
      expect(existsSync(piPath)).toBe(true);
      const raw = readFileSync(piPath, "utf8");
      const { name, description, body } = parseFrontmatter(raw);
      expect(name || entry.name).toBe(entry.name);
      expect(entry.piSource).toContain(`${entry.name}.md`);
      expect(entry.ompDestination).toBe(`omp/agents/${entry.name}.md`);
      const bodySha = createHash("sha256").update(body).digest("hex");
      expect(entry.piBaseline.frontmatterName).toBe(name || entry.name);
      if (description) {
        expect(String(entry.piBaseline.description)).toContain(
          description.slice(0, Math.min(20, description.length)),
        );
      }
      expect(entry.piBaseline.bodySha256).toBe(bodySha);
      // responsibility not weakened: purpose non-empty; reviewers stay read-scoped
      expect(String(entry.purpose).length).toBeGreaterThan(5);
      if (String(entry.name).includes("reviewer") || String(entry.name).includes("scout")) {
        expect(["none", "read-only", "harness-artifacts"]).toContain(
          // writeScope for scouts/reviewers must not be broad production
          entry.writeScope === "worktree" ? "BROAD" : entry.writeScope,
        );
        expect(entry.writeScope).not.toBe("worktree");
        expect(entry.writeScope).not.toBe("production");
      }
      // model route + effort present
      expect(String(entry.modelRoute).length).toBeGreaterThan(0);
      expect(String(entry.reasoningEffort).length).toBeGreaterThan(0);
      // tools/skills/schema present
      expect((entry.allowedTools as string[]).length).toBeGreaterThan(0);
      expect(String(entry.outputSchema).length).toBeGreaterThan(0);
    }
  });

  test("no missing or extra roles vs expected set", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      agents: Array<{ name: string }>;
    };
    const names = new Set(manifest.agents.map((a) => a.name));
    for (const n of expectedAgents) {
      expect(names.has(n)).toBe(true);
    }
    expect(names.size).toBe(19);
  });
});
