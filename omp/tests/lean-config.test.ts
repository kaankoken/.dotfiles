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
    expect(config.task.showResolvedModelBadge).toBe(true);
    // Auto mode + smart-approve high-risk gate (not always-ask).
    expect(config.tools.approvalMode).toBe("yolo");
    for (const tool of [
      "read",
      "search",
      "find",
      "lsp",
      "web_search",
      "bash",
      "edit",
      "write",
    ]) {
      expect(config.tools.approval[tool]).toBe("allow");
    }
  });

  test("smart-approve extension is vendored with built dist entry", () => {
    const root = join(OMP_ROOT, "extensions", "smart-approve");
    expect(existsSync(root)).toBe(true);
    expect(existsSync(join(root, "dist", "index.js"))).toBe(true);
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as {
      name: string;
      version: string;
      omp?: { extensions?: string[] };
    };
    expect(pkg.name).toBe("smart-approve");
    expect(pkg.version).toBe("2.3.0");
    expect(pkg.omp?.extensions).toContain("./dist/index.js");
    const versionPin = readFileSync(join(root, "VERSION"), "utf8").trim();
    expect(versionPin).toBe("2.3.0");
  });

  test("mcp.json cold-loads tokensave only; stack MCPs are opt-in", () => {
    const path = join(OMP_ROOT, "mcp.json");
    expect(existsSync(path)).toBe(true);
    const mcp = JSON.parse(readFileSync(path, "utf8")) as {
      mcpServers: Record<string, { enabled?: boolean; command?: string; url?: string }>;
      disabledServers?: string[];
    };
    const keys = Object.keys(mcp.mcpServers).sort();
    expect(keys).toEqual(
      ["context-mode", "context7", "headroom", "tokensave"].sort(),
    );
    // Cold start: only tokensave connects (no xd:// flood from optional stack MCPs).
    expect(mcp.mcpServers.tokensave?.enabled).not.toBe(false);
    for (const name of ["headroom", "context-mode", "context7"] as const) {
      expect(mcp.mcpServers[name]?.enabled).toBe(false);
    }
    // Foreign MCP from VS Code / Claude plugins / Codex must not cold-mount.
    const disabled = mcp.disabledServers ?? [];
    for (const name of [
      "codebase-memory-mcp",
      "chrome-devtools",
      "node_repl",
      "computer-use",
    ]) {
      expect(disabled).toContain(name);
    }
    expect(existsSync(join(OMP_ROOT, "commands", "mcp-stack.md"))).toBe(true);
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

  test("customDirectories wires stack pack skill parents", () => {
    const config = parseYaml(
      readFileSync(join(OMP_ROOT, "config.yml"), "utf8"),
    ) as Record<string, any>;
    const dirs: string[] = config.skills.customDirectories ?? [];
    const home = process.env.HOME ?? "";
    const expand = (d: string) => d.replace(/^~/, home);

    // Required pack parents (substring match on configured paths)
    const requiredFragments = [
      "superpowers",
      ".agents/skills",
      "omp/agent/skills",
      "marketplaces/caveman/skills",
      "marketplaces/rust-skills/skills",
      "axiom-marketplace/axiom-codex/skills",
    ];
    for (const frag of requiredFragments) {
      expect(
        dirs.some((d) => d.includes(frag)),
        `missing customDirectories entry containing ${frag}`,
      ).toBe(true);
    }

    // Each root exists and has at least one name/SKILL.md child
    const probeSkill: Record<string, string> = {
      superpowers: "using-superpowers",
      "marketplaces/caveman/skills": "caveman",
      "marketplaces/rust-skills/skills": "rust-router",
      "axiom-marketplace/axiom-codex/skills": "axiom-swiftui",
      "omp/agent/skills": "goal-harness",
    };
    for (const [frag, skill] of Object.entries(probeSkill)) {
      const root = dirs.find((d) => d.includes(frag));
      expect(root).toBeTruthy();
      const abs = expand(root!);
      expect(existsSync(abs)).toBe(true);
      expect(existsSync(join(abs, skill, "SKILL.md"))).toBe(true);
    }
  });

  test("includeSkills is cold-core only (domain packs on demand)", () => {
    const config = parseYaml(
      readFileSync(join(OMP_ROOT, "config.yml"), "utf8"),
    ) as Record<string, any>;
    const include: string[] = config.skills.includeSkills ?? [];
    // Pack/group labels that are NOT skill directory names — historically
    // filtered out using-superpowers / requesting-code-review entirely.
    const forbiddenPackLabels = [
      "superpowers",
      "rust-skills",
      "axiom",
      "android",
      "compose-performance",
      "android-testing",
    ];
    for (const label of forbiddenPackLabels) {
      expect(include).not.toContain(label);
    }

    // Cold catalog: harness + superpowers core + caveman/ponytail roots + routers.
    // Domain packs and sub-skills (caveman-*, ponytail-*, webwright) are on-demand.
    const requiredSkillNames = [
      "using-superpowers",
      "requesting-code-review",
      "receiving-code-review",
      "goal-harness",
      "brainstorming",
      "writing-plans",
      "systematic-debugging",
      "test-driven-development",
      "subagent-driven-development",
      "using-git-worktrees",
      "verification-before-completion",
      "finishing-a-development-branch",
      "ponytail",
      "caveman",
      "stack-rust",
      "stack-ios",
      "stack-android",
    ];
    for (const name of requiredSkillNames) {
      expect(include).toContain(name);
    }

    const forbiddenColdExtras = [
      "webwright",
      "writing-skills",
      "caveman-*",
      "ponytail-*",
      "cavecrew",
      "axiom-*",
      "rust-*",
      "android-cli",
      "testing-setup",
      "coding-guidelines",
      "core-*",
      "domain-*",
      "m0*",
      "m1*",
      "meta-cognition-parallel",
      "unsafe-checker",
      "adaptive",
      "agp-9-upgrade",
      "appfunctions",
      "camera1-to-camerax",
      "display-*",
      "edge-to-edge",
      "engage-sdk-integration",
      "migrate-xml-views-to-jetpack-compose",
      "navigation-3",
      "perfetto-*",
      "play-billing-library-version-upgrade",
      "r8-analyzer",
      "styles",
      "verified-email",
    ];
    for (const name of forbiddenColdExtras) {
      expect(include).not.toContain(name);
    }

    // Cold-start tool surface: no image gen / browser tool schemas
    expect(config.generate_image?.enabled).toBe(false);
    expect(config.inspect_image?.mode).toBe("off");
    expect(config.browser?.enabled).toBe(false);
    expect(config.tools?.xdev).toBe(true);
    expect(config.tools?.xdevDocs).toBe("catalog");

    // Thin routers exist under omp/skills
    for (const name of ["stack-rust", "stack-ios", "stack-android"]) {
      expect(
        existsSync(join(OMP_ROOT, "skills", name, "SKILL.md")),
      ).toBe(true);
    }

    // Pack overlays expand domain globs for optional full-catalog sessions
    for (const pack of ["pack-rust", "pack-ios", "pack-android"]) {
      const overlayPath = join(OMP_ROOT, "configs", `${pack}.yml`);
      expect(existsSync(overlayPath)).toBe(true);
      const overlay = parseYaml(readFileSync(overlayPath, "utf8")) as Record<
        string,
        any
      >;
      const oInclude: string[] = overlay.skills?.includeSkills ?? [];
      expect(oInclude).toContain("using-superpowers");
      expect(oInclude).toContain("goal-harness");
    }
    const rustOverlay = parseYaml(
      readFileSync(join(OMP_ROOT, "configs", "pack-rust.yml"), "utf8"),
    ) as Record<string, any>;
    expect(rustOverlay.skills.includeSkills).toContain("rust-*");
    const iosOverlay = parseYaml(
      readFileSync(join(OMP_ROOT, "configs", "pack-ios.yml"), "utf8"),
    ) as Record<string, any>;
    expect(iosOverlay.skills.includeSkills).toContain("axiom-*");
    const androidOverlay = parseYaml(
      readFileSync(join(OMP_ROOT, "configs", "pack-android.yml"), "utf8"),
    ) as Record<string, any>;
    expect(androidOverlay.skills.includeSkills).toContain("android-cli");

    // Stack activation commands exist
    for (const cmd of ["stack-rust", "stack-ios", "stack-android"]) {
      expect(existsSync(join(OMP_ROOT, "commands", `${cmd}.md`))).toBe(true);
    }

    // Superpowers root must exist and every non-glob include that lives there
    // must resolve as name/SKILL.md (guards wrong allowlist again).
    const superpowersRoot = (config.skills.customDirectories as string[])
      .find((d) => d.includes("superpowers"))!
      .replace(/^~/, process.env.HOME ?? "");
    const superpowersSkills = new Set(readdirSync(superpowersRoot));
    for (const name of [
      "using-superpowers",
      "requesting-code-review",
      "brainstorming",
    ]) {
      expect(superpowersSkills.has(name)).toBe(true);
      expect(
        existsSync(join(superpowersRoot, name, "SKILL.md")),
      ).toBe(true);
    }

    // OMP match semantics: includeSkills globs are matched against skill.name
    // only. Pack label "superpowers" must not match harness skill names.
    expect(new Bun.Glob("superpowers").match("using-superpowers")).toBe(false);
    expect(new Bun.Glob("superpowers").match("requesting-code-review")).toBe(
      false,
    );
    expect(new Bun.Glob("using-superpowers").match("using-superpowers")).toBe(
      true,
    );
    expect(
      new Bun.Glob("requesting-code-review").match("requesting-code-review"),
    ).toBe(true);
    // Domain globs still valid for pack overlays (not cold includeSkills)
    expect(new Bun.Glob("axiom-*").match("axiom-swiftui")).toBe(true);
    expect(new Bun.Glob("rust-*").match("rust-router")).toBe(true);
    expect(new Bun.Glob("rust-skills").match("rust-router")).toBe(false);
  });

  test("no Superpowers SKILL.md bodies under omp/", () => {
    const files = walkFiles(OMP_ROOT);
    // Allowed: harness skill + thin on-demand pack routers (not vendored Superpowers).
    const allowedSkillMd =
      /skills\/(goal-harness|stack-rust|stack-ios|stack-android)\/SKILL\.md$/;
    for (const f of files) {
      if (f.endsWith("SKILL.md")) {
        expect(f).not.toMatch(/superpowers/i);
        expect(f).toMatch(allowedSkillMd);
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
