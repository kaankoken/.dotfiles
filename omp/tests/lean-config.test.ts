import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const OMP_ROOT = join(import.meta.dir, "..");
const DOTFILES_ROOT = join(OMP_ROOT, "..");

function walkFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}

describe("lean OMP configuration", () => {
  test("config.yml has lean shared-stack values", () => {
    const path = join(OMP_ROOT, "config.yml");
    expect(existsSync(path)).toBe(true);
    const config = parseYaml(readFileSync(path, "utf8")) as Record<
      string,
      any
    >;
    expect(config.compaction.strategy).toBe("shake");
    expect(config.memory.backend).toBe("off");
    expect(config.todo.enabled).toBe(false);
    expect(config.autolearn.enabled).toBe(false);
    expect(config.edit.mode).toBe("hashline");
    expect(config.lsp.enabled).toBe(true);
    expect(config.task.maxConcurrency).toBe(8);
    expect(config.tools.approvalMode).toBe("always-ask");
  });

  test("mcp.json allowlist is exactly four servers", () => {
    const path = join(OMP_ROOT, "mcp.json");
    expect(existsSync(path)).toBe(true);
    const mcp = JSON.parse(readFileSync(path, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    const keys = Object.keys(mcp.mcpServers).sort();
    expect(keys).toEqual(
      ["context-mode", "context7", "headroom", "tokensave"].sort(),
    );
  });

  test("package.json has no pi-dynamic-workflows or pi-mcp-adapter", () => {
    const pkgPath = join(DOTFILES_ROOT, "package.json");
    if (!existsSync(pkgPath)) return;
    const raw = readFileSync(pkgPath, "utf8");
    expect(raw).not.toContain("@quintinshaw/pi-dynamic-workflows");
    expect(raw).not.toContain("pi-mcp-adapter");
  });

  test("no forbidden orchestration / memory references in omp tree", () => {
    const files = walkFiles(OMP_ROOT).filter(
      (p) =>
        !p.includes(`${"tests"}/`) &&
        !p.endsWith("compatibility.json") &&
        !p.endsWith("package-lock.json") &&
        !p.includes("node_modules"),
    );
    // Split patterns so this test file itself is not scanned (tests excluded).
    const bannedParts = [
      "sw" + "arm",
      "task" + "plane",
      "pi-" + "xai",
      "pi-dynamic-" + "workflows",
      "hind" + "sight",
      "mnemo" + "pi",
    ];
    const banned = new RegExp(bannedParts.join("|"), "i");
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(banned.test(text)).toBe(false);
      if (f.endsWith("config.yml")) {
        expect(text).toMatch(/todo:\s*\n\s*enabled:\s*false/);
        expect(text).toMatch(/autolearn:\s*\n\s*enabled:\s*false/);
      }
    }
  });

  test("no retain/recall/reflect memory ops in omp config", () => {
    const cfg = readFileSync(join(OMP_ROOT, "config.yml"), "utf8");
    expect(cfg).not.toMatch(/\bretain\b|\brecall\b|\breflect\b/);
  });

  test("foreign skill discovery disabled except approved roots", () => {
    const config = parseYaml(
      readFileSync(join(OMP_ROOT, "config.yml"), "utf8"),
    ) as Record<string, any>;
    const skills = config.skills ?? {};
    expect(skills.enableClaudeUser).toBe(false);
    expect(skills.enableClaudeProject).toBe(false);
    expect(skills.enableCodexUser).toBe(false);
    expect(skills.enablePiUser).toBe(false);
    expect(skills.enablePiProject).toBe(false);
    expect(skills.enableAgentsUser).toBe(true);
    expect(skills.enableAgentsProject).toBe(true);
    expect(Array.isArray(skills.customDirectories)).toBe(true);
    expect(skills.customDirectories.length).toBeGreaterThan(0);
  });

  test("Superpowers customDirectories points at skill-parent root", () => {
    const config = parseYaml(
      readFileSync(join(OMP_ROOT, "config.yml"), "utf8"),
    ) as Record<string, any>;
    const dirs: string[] = config.skills.customDirectories;
    const superpowersRoot = dirs.find((d) => d.includes("superpowers"));
    expect(superpowersRoot).toBeTruthy();
    // expand ~
    const expanded = superpowersRoot!.replace(/^~/, process.env.HOME ?? "");
    expect(existsSync(expanded)).toBe(true);
    const children = readdirSync(expanded);
    // immediate children should include known skill dirs (not nested SKILL.md only)
    expect(children).toContain("brainstorming");
  });

  test("no Superpowers SKILL.md bodies under omp/", () => {
    const files = walkFiles(OMP_ROOT);
    for (const f of files) {
      if (f.endsWith("SKILL.md")) {
        // fail if any skill body vendored
        expect(f).not.toMatch(/superpowers/i);
        // still ban any SKILL.md under omp except none expected
        throw new Error(`unexpected SKILL.md under omp: ${f}`);
      }
    }
  });

  test("config does not disable OMP bundled agents globally", () => {
    const config = parseYaml(
      readFileSync(join(OMP_ROOT, "config.yml"), "utf8"),
    ) as Record<string, any>;
    // no agents.disabled=true / enableAgents=false style kill switch
    const raw = JSON.stringify(config);
    expect(raw).not.toMatch(/"agents"\s*:\s*\{\s*"enabled"\s*:\s*false/);
    expect(config.agents?.enabled).not.toBe(false);
  });

  test("AGENTS.md references shared stack and is OMP-delta only", () => {
    const path = join(OMP_ROOT, "AGENTS.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toMatch(/agent-stack|AGENTS\.shared|RTK\.md/);
    expect(text.toLowerCase()).toContain("omp");
  });
});
