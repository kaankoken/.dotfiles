/**
 * Scaffold-only project initialization for /init.
 * Never creates Spec/Plan/Implement/PR harness issues.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync, existsSync, lstatSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";

export type StackKind = "rust" | "ios" | "android" | "mixed" | "unknown";

export type ProjectInitOptions = {
  root: string;
  description?: string;
  /** Injected for tests */
  runBdInit?: (args: string[]) => { exitCode: number; stdout: string };
  askScope?: () => string;
};

export type ProjectInitResult = {
  wrote: string[];
  preserved: string[];
  stack: StackKind;
  skillRequirements: string[];
  worktreeConvention: string;
  ponytailNote: string;
  bdInitRan: boolean;
  askedScope: boolean;
  stoppedAfterScaffold: true;
};

const EXCLUDE_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "target",
  "vendor",
  "build",
  "dist",
  ".build",
  "DerivedData",
  ".gradle",
  ".cache",
  "Pods",
  ".worktrees",
  "worktrees",
  "Carthage",
  "coverage",
  "__pycache__",
  ".tox",
  ".venv",
  "venv",
]);

function isExcludedDir(name: string): boolean {
  if (EXCLUDE_DIR_NAMES.has(name)) return true;
  if (name.startsWith(".") && name !== ".") return true;
  return false;
}

export function detectStack(root: string): StackKind {
  const has = (p: string) => existsSync(join(root, p));
  const rust = has("Cargo.toml");
  const ios =
    has("Package.swift") ||
    readdirSync(root).some((f) => f.endsWith(".xcodeproj") || f.endsWith(".xcworkspace"));
  const android = has("build.gradle") || has("build.gradle.kts") || has("settings.gradle") || has("settings.gradle.kts");
  const n = [rust, ios, android].filter(Boolean).length;
  if (n > 1) return "mixed";
  if (rust) return "rust";
  if (ios) return "ios";
  if (android) return "android";
  return "unknown";
}

export function skillRequirementsFor(stack: StackKind): string[] {
  switch (stack) {
    case "rust":
      return ["rust-skills", "ponytail"];
    case "ios":
      return ["axiom", "ponytail"];
    case "android":
      return ["android", "compose-performance", "android-testing", "ponytail"];
    case "mixed":
      return ["rust-skills", "axiom", "android", "ponytail"];
    default:
      return ["ponytail"];
  }
}

export function listProjectOwnedDirs(root: string): string[] {
  const out: string[] = [root];
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (isExcludedDir(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue; // never follow symlink outside
      if (!st.isDirectory()) continue;
      // only project-owned if contains a tracked-like file or nested project marker
      const children = readdirSync(full);
      const hasFiles = children.some((c) => {
        if (isExcludedDir(c)) return false;
        try {
          return statSync(join(full, c)).isFile();
        } catch {
          return false;
        }
      });
      const hasNested = children.some((c) => {
        if (isExcludedDir(c)) return false;
        try {
          return statSync(join(full, c)).isDirectory();
        } catch {
          return false;
        }
      });
      if (hasFiles || hasNested) {
        out.push(full);
        walk(full, depth + 1);
      }
    }
  };
  walk(root, 0);
  return out;
}

function stackToolsTable(stack: StackKind): string {
  if (stack === "rust") {
    return "| Rust | `cargo`, `bacon`, `cargo nextest` |\n| Prefer | `rtk cargo …` |";
  }
  if (stack === "ios") {
    return "| iOS | `xcodebuild`, Axiom skills |\n| Prefer | axiom audits |";
  }
  if (stack === "android") {
    return "| Android | Gradle, Compose |\n| Prefer | android skills |";
  }
  return "| Stack | detect locally |";
}

function renderRootAgents(opts: {
  description: string;
  stack: StackKind;
  structure: string;
  nestedMap: string;
}): string {
  return `# ${opts.description}

Project-local agent instructions for the shared agent stack (Claude / Codex / Cursor / Grok / Oh My Pi).

## Quality rules (1–8)

1. No errors, warnings, test failures
2. No warning suppressions in production (tests OK)
3. Everything wired — no stubs/TODO/TBD/FIXME
4. Always use project skill set (rust-skills, axiom, …)
5. Always latest deps — check web
6. Do all tasks from superpowers specs & plans
7. Specs/plans always tracked in bd (SoT)
8. Do not add unnecessary docstrings or comments to the codebase. You can add only explanatory comments to the codebase for methods/functions, or other stuff. This is not a notebook that you made for yourself.

## Tools

Prefer: rtk, bd, tokensave, sg, headroom, context-mode, context7, caveman, ponytail.
Never codebase-memory.

## Stack tools

${stackToolsTable(opts.stack)}

**ponytail** is part of the nixup toolchain (code minimalism).

## Structure

${opts.structure}

## Nested AGENTS map

${opts.nestedMap}

## Exclusions

Do not scaffold under \`.git\`, worktree roots, vendor/deps, build/generated, or cache/tool state.

## Worktree convention

Feature work uses git worktrees under project \`.worktrees/\` or external roots when configured by the harness. Prefer isolated branches; never dirty main without intent.

## CLAUDE.md

Root and nested \`CLAUDE.md\` are symlinks to sibling \`AGENTS.md\` (\`ln -sfn AGENTS.md CLAUDE.md\`).
`;
}

function renderSubdirAgents(subdir: string, scope: string): string {
  return `# ${subdir}

Scope: **${scope}**

Inherits root CLI contract. Work under \`${subdir}/\` unless the user expands scope.

\`\`\`bash
ln -sfn AGENTS.md CLAUDE.md
\`\`\`
`;
}

function ensureClaudeSymlink(dir: string, wrote: string[]): void {
  const claude = join(dir, "CLAUDE.md");
  const agents = join(dir, "AGENTS.md");
  if (!existsSync(agents)) return;
  if (existsSync(claude)) {
    try {
      if (lstatSync(claude).isSymbolicLink()) return;
      // existing regular file: leave as documented placeholder (preserve)
      return;
    } catch {
      return;
    }
  }
  try {
    symlinkSync("AGENTS.md", claude);
    wrote.push(claude);
  } catch {
    // placeholder where symlinks unsupported
    writeFileSync(claude, "See AGENTS.md (symlink unsupported on this FS)\n");
    wrote.push(claude);
  }
}

function beadsAlreadyInit(root: string): boolean {
  return existsSync(join(root, ".beads"));
}

/**
 * Deterministic scaffold. Stops after writing instruction tree + optional bd init.
 * Never creates Spec/Plan/Implement/PR issues.
 */
export function runProjectInit(opts: ProjectInitOptions): ProjectInitResult {
  const root = resolve(opts.root);
  const wrote: string[] = [];
  const preserved: string[] = [];
  let askedScope = false;

  let description = opts.description?.trim() ?? "";
  if (!description) {
    // try README first line
    const readme = join(root, "README.md");
    if (existsSync(readme)) {
      const first = readFileSync(readme, "utf8").split("\n").find((l) => l.trim());
      if (first) description = first.replace(/^#\s*/, "").trim();
    }
  }
  if (!description) {
    askedScope = true;
    description = opts.askScope?.() ?? "";
    if (!description) {
      throw new Error("project-init: no description; ask for scope");
    }
  }

  const stack = detectStack(root);
  const skills = skillRequirementsFor(stack);
  const dirs = listProjectOwnedDirs(root);

  const structureLines = dirs
    .filter((d) => d !== root)
    .map((d) => `- \`${relative(root, d) || "."}/\``)
    .join("\n") || "- (root only)";

  const nestedMap = [
    "| Path | Scope |",
    "|------|--------|",
    "| `/AGENTS.md` | repo-wide |",
    ...dirs
      .filter((d) => d !== root)
      .map((d) => `| \`/${relative(root, d)}/AGENTS.md\` | ${relative(root, d)} |`),
  ].join("\n");

  // root AGENTS.md
  const rootAgents = join(root, "AGENTS.md");
  if (existsSync(rootAgents)) {
    preserved.push(rootAgents);
    // merge: append marker if not present
    const existing = readFileSync(rootAgents, "utf8");
    if (
      !existing.includes("Quality rules (1–7)") &&
      !existing.includes("Quality rules (1–8)") &&
      !existing.includes("Quality goals")
    ) {
      writeFileSync(
        rootAgents,
        existing.trimEnd() +
          "\n\n<!-- project-init merge: quality 1–8 + stack -->\n" +
          renderRootAgents({
            description,
            stack,
            structure: structureLines,
            nestedMap,
          }),
      );
      wrote.push(rootAgents);
    }
  } else {
    writeFileSync(
      rootAgents,
      renderRootAgents({
        description,
        stack,
        structure: structureLines,
        nestedMap,
      }),
    );
    wrote.push(rootAgents);
  }
  ensureClaudeSymlink(root, wrote);

  for (const dir of dirs) {
    if (dir === root) continue;
    const rel = relative(root, dir);
    const agentsPath = join(dir, "AGENTS.md");
    if (existsSync(agentsPath)) {
      preserved.push(agentsPath);
    } else {
      mkdirSync(dir, { recursive: true });
      writeFileSync(agentsPath, renderSubdirAgents(rel, `code under ${rel}/`));
      wrote.push(agentsPath);
    }
    ensureClaudeSymlink(dir, wrote);
  }

  let bdInitRan = false;
  if (!beadsAlreadyInit(root)) {
    const run =
      opts.runBdInit ??
      (() => ({
        exitCode: 0,
        stdout: "init",
      }));
    const res = run([
      "init",
      "--init-if-missing",
      "--non-interactive",
      "--skip-agents",
    ]);
    if (res.exitCode === 0) bdInitRan = true;
  }

  return {
    wrote,
    preserved,
    stack,
    skillRequirements: skills,
    worktreeConvention:
      "Use git worktrees under .worktrees/ or harness-managed external roots; isolated feature branches.",
    ponytailNote: "ponytail is part of the nixup toolchain (code minimalism skill).",
    bdInitRan,
    askedScope,
    stoppedAfterScaffold: true,
  };
}

/** Guard: path must stay inside root (no symlink escape). */
export function assertInsideRoot(root: string, target: string): void {
  const r = resolve(root);
  const t = resolve(target);
  if (t !== r && !t.startsWith(r + "/") && !t.startsWith(r + "\\")) {
    throw new Error(`path escapes repository root: ${target}`);
  }
}
