import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PR_REVIEW_ROLE_SPECS } from "../extensions/pr-review/contracts";

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
  const candidates = [
    process.env.PI_HARNESS_ROOT,
    // nixup worktree (migration)
    "/Users/legolas/Desktop/personal/.worktrees/nixup-omp-goal-harness-migration/modules/agents/pi",
    // primary nix-setup checkout
    "/Users/legolas/Desktop/personal/nix-setup/modules/agents/pi",
  ].filter((p): p is string => Boolean(p && p.length > 0));
  for (const c of candidates) {
    if (existsSync(join(c, "agents"))) return c;
  }
  throw new Error(
    "PI_HARNESS_ROOT not set and no local Pi agents dir found (set PI_HARNESS_ROOT)",
  );
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

  const planningSeven = [
    "project-init",
    "spec-writer",
    "spec-reviewer",
    "plan-writer",
    "plan-reviewer",
    "bite-size-writer",
    "bite-size-reviewer",
  ] as const;

  test("initialization spec plan bite-size OMP agents have frontmatter tools/spawns", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      agents: Array<{ name: string; allowedTools: string[] }>;
    };
    const byName = Object.fromEntries(manifest.agents.map((a) => [a.name, a]));

    for (const name of planningSeven) {
      const path = join(OMP_ROOT, "agents", `${name}.md`);
      expect(existsSync(path)).toBe(true);
      const raw = readFileSync(path, "utf8");
      const fm = parseOmpAgentFrontmatter(raw);
      expect(fm.name).toBe(name);
      expect(String(fm.description).length).toBeGreaterThan(5);
      expect(Array.isArray(fm.tools)).toBe(true);
      expect(Array.isArray(fm.spawns)).toBe(true);
      const allow = new Set(byName[name].allowedTools);
      for (const t of fm.tools as string[]) {
        expect(allow.has(t) || allow.size === 0 || true).toBe(true);
        // tools must be subset of manifest allowlist when allowlist is non-empty
        if (byName[name].allowedTools.length > 0) {
          expect(byName[name].allowedTools).toContain(t);
        }
      }
      const isReviewer = name.endsWith("-reviewer");
      if (isReviewer) {
        expect((fm.spawns as string[]).length).toBe(0);
        expect(fm.tools).not.toContain("write");
        expect(fm.tools).not.toContain("edit");
      } else {
        // producers must not declare reviewer dispatch or human approval ownership
        expect(JSON.stringify(fm.spawns)).not.toMatch(/spec-reviewer|plan-reviewer|human-approval/);
      }
      // no copied Superpowers skill bodies
      expect(raw).not.toMatch(/# Test-Driven Development|# Iron Law|NO PRODUCTION CODE WITHOUT/);
      expect(raw).not.toMatch(/## When to Use\n\n\*\*Always:\*\*/);
      expect(raw).not.toMatch(/brainstorming skill\n\n## Overview/i);
    }
  });

  test("implementation milestone review delivery boundaries", () => {
    const roles = [
      "implementer",
      "milestone-organizer",
      "code-reviewer",
      "pr-opener",
    ] as const;
    for (const name of roles) {
      const path = join(OMP_ROOT, "agents", `${name}.md`);
      expect(existsSync(path)).toBe(true);
      const raw = readFileSync(path, "utf8");
      const fm = parseOmpAgentFrontmatter(raw);
      expect(fm.name).toBe(name);
      expect(Array.isArray(fm.tools)).toBe(true);
      expect(Array.isArray(fm.spawns)).toBe(true);
    }
    const impl = readFileSync(join(OMP_ROOT, "agents/implementer.md"), "utf8");
    expect(impl).toMatch(/Cannot|cannot/);
    expect(impl).toMatch(/worktree/i);
    expect(impl.toLowerCase()).toMatch(/do not create your own|cannot.*create.*worktree/);
    expect(impl).toMatch(/close Beads|spawn reviewers|open PRs/i);

    const mile = readFileSync(
      join(OMP_ROOT, "agents/milestone-organizer.md"),
      "utf8",
    );
    expect(mile).toMatch(/fresh command evidence|Milestone PASS/i);
    expect(mile).toMatch(/code-reviewer/);

    const rev = readFileSync(join(OMP_ROOT, "agents/code-reviewer.md"), "utf8");
    expect(rev).toMatch(/Read-only|read-only/);
    expect(rev).toMatch(/Do not load `receiving-code-review`/);
    expect(rev).not.toMatch(/tools: \[.*write/);

    const pr = readFileSync(join(OMP_ROOT, "agents/pr-opener.md"), "utf8");
    expect(pr).toMatch(/Milestone gate PASS|Milestone PASS/);
    expect(pr).toMatch(/Only.*remote mutation|gh pr/i);
  });

  test("research scouts primary paths and read-only tools", () => {
    const scouts: Record<string, string> = {
      "code-graph-scout": "tokensave",
      "code-search-scout": "ast-search",
      "docs-scout": "context7",
      "web-scout": "web_search",
      "web-browse-scout": "chrome-cdp",
      "browser-use-scout": "browser-use",
      "webwright-scout": "webwright",
      "stack-scout": "stack-skills",
    };
    for (const [name, primary] of Object.entries(scouts)) {
      const path = join(OMP_ROOT, "agents", `${name}.md`);
      expect(existsSync(path)).toBe(true);
      const raw = readFileSync(path, "utf8");
      const fm = parseOmpAgentFrontmatter(raw);
      expect(fm.name).toBe(name);
      expect(fm.primaryPath).toBe(primary);
      expect(fm.tools).not.toContain("write");
      expect(fm.tools).not.toContain("edit");
      expect((fm.spawns as string[]).length).toBe(0);
      expect(raw).toMatch(
        new RegExp(primary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
      );
    }
  });
});

function parseOmpAgentFrontmatter(text: string): Record<string, unknown> {
  if (!text.startsWith("---")) throw new Error("missing frontmatter");
  const parts = text.split("---", 3);
  const fm: Record<string, unknown> = {};
  for (const line of parts[1].trim().split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      fm[key] = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      fm[key] = val.replace(/^"|"$/g, "");
    }
  }
  return fm;
}

describe("PR review standalone user roles", () => {
  test("remain outside the frozen 19-role parity manifest", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      agentCount: number;
      agents: Array<{ name: string }>;
    };
    expect(manifest.agentCount).toBe(19);
    expect(manifest.agents).toHaveLength(19);
    for (const role of PR_REVIEW_ROLE_SPECS) {
      expect(manifest.agents.some(({ name }) => name === role.agent)).toBe(false);
    }
  });

  test("pin exact models and expose only snapshot reads with no spawns", () => {
    for (const role of PR_REVIEW_ROLE_SPECS) {
      const path = join(OMP_ROOT, "agents", `${role.agent}.md`);
      expect(existsSync(path)).toBe(true);
      const raw = readFileSync(path, "utf8");
      const fm = parseOmpAgentFrontmatter(raw);
      expect(fm.name).toBe(role.agent);
      expect(fm.model).toBe(role.model);
      expect(fm.tools).toEqual(["pr_review_snapshot"]);
      expect(fm.spawns).toEqual([]);
      expect(raw).toMatch(/untrusted data/i);
      expect(raw).toMatch(/terminal.*yield|yield.*terminal/i);
      expect(raw).toMatch(/strict.*outputSchema|outputSchema.*strict/i);
      expect(raw).toMatch(/bash|shell/i);
      expect(raw).toMatch(/write|edit/i);
      expect(raw).toMatch(/spawn/i);
      expect(raw).toMatch(/hub/i);
      expect(raw).toMatch(/GitHub mutation/i);
    }
  });
});
