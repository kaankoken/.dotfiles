import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync, cpSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectStack,
  runProjectInit,
  skillRequirementsFor,
} from "../extensions/goal-harness/project-init";

const FIX = join(import.meta.dir, "fixtures/project-init");

function cloneFixture(name: string): string {
  const dest = mkdtempSync(join(tmpdir(), `pi-${name}-`));
  cpSync(join(FIX, name), dest, { recursive: true });
  return dest;
}

describe("project-init scaffold", () => {
  test("empty Rust project scaffolds AGENTS + CLAUDE + stack skills", () => {
    const root = cloneFixture("empty-rust");
    let bdArgs: string[] | null = null;
    const r = runProjectInit({
      root,
      description: "Demo rust crate",
      runBdInit: (args) => {
        bdArgs = args;
        return { exitCode: 0, stdout: "ok" };
      },
    });
    expect(r.stack).toBe("rust");
    expect(r.skillRequirements).toContain("rust-skills");
    expect(r.skillRequirements).toContain("ponytail");
    expect(r.ponytailNote).toMatch(/nixup toolchain/);
    expect(r.worktreeConvention).toMatch(/worktree/i);
    expect(r.stoppedAfterScaffold).toBe(true);
    expect(r.bdInitRan).toBe(true);
    expect(bdArgs![0]).toBe("init");
    // Never bare bd init — always explicit --prefix from repo basename.
    expect(bdArgs!.some((a) => a.startsWith("--prefix="))).toBe(true);
    expect(bdArgs!).toContain("--init-if-missing");
    expect(bdArgs!).toContain("--non-interactive");
    expect(bdArgs!).toContain("--skip-agents");
    expect(bdArgs!).not.toContain("--remote");
    expect(bdArgs!.length).toBeGreaterThan(1);
    const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(agents).toMatch(/Demo rust crate|Quality rules/);
    expect(agents).toMatch(/Nested AGENTS map/);
    expect(agents).toMatch(/Exclusions/);
    expect(lstatSync(join(root, "CLAUDE.md")).isSymbolicLink()).toBe(true);
    // no harness phase issues
    expect(agents).not.toMatch(/create Spec|Implement phase|PR issues/);
    rmSync(root, { recursive: true, force: true });
  });

  test("iOS nested packages get scoped AGENTS", () => {
    const root = cloneFixture("ios-nested");
    const r = runProjectInit({
      root,
      description: "iOS app",
      runBdInit: () => ({ exitCode: 0, stdout: "" }),
    });
    expect(r.stack).toBe("ios");
    expect(r.skillRequirements).toContain("axiom");
    expect(existsSync(join(root, "App/AGENTS.md"))).toBe(true);
    expect(existsSync(join(root, "Packages/Lib/AGENTS.md"))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  test("Android/Compose project detects android skills", () => {
    const root = cloneFixture("android-compose");
    const r = runProjectInit({
      root,
      description: "Android app",
      runBdInit: () => ({ exitCode: 0, stdout: "" }),
    });
    expect(r.stack).toBe("android");
    expect(r.skillRequirements).toEqual(
      expect.arrayContaining(["android", "compose-performance", "android-testing"]),
    );
    rmSync(root, { recursive: true, force: true });
  });

  test("preserves existing AGENTS.md and non-symlink CLAUDE.md", () => {
    const root = cloneFixture("mixed-existing");
    const before = readFileSync(join(root, "AGENTS.md"), "utf8");
    const r = runProjectInit({
      root,
      runBdInit: () => ({ exitCode: 0, stdout: "" }),
    });
    expect(r.preserved.some((p) => p.endsWith("AGENTS.md"))).toBe(true);
    const after = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(after).toContain("Keep me");
    // non-symlink CLAUDE preserved
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toContain("not a symlink");
    expect(existsSync(join(root, "src/AGENTS.md"))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  test("excludes vendor/node_modules from nested AGENTS", () => {
    const root = cloneFixture("with-vendor");
    runProjectInit({
      root,
      description: "vendor case",
      runBdInit: () => ({ exitCode: 0, stdout: "" }),
    });
    expect(existsSync(join(root, "src/AGENTS.md"))).toBe(true);
    expect(existsSync(join(root, "node_modules/pkg/AGENTS.md"))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  test("skips bd init when .beads already present", () => {
    const root = cloneFixture("with-beads");
    let called = false;
    const r = runProjectInit({
      root,
      description: "has beads",
      skipBeadsAssert: true, // fixture is a marker only
      runBdInit: () => {
        called = true;
        return { exitCode: 0, stdout: "" };
      },
    });
    expect(called).toBe(false);
    expect(r.bdInitRan).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  test("refuses existing .beads with foreign prefix", () => {
    const root = cloneFixture("with-beads");
    expect(() =>
      runProjectInit({
        root,
        description: "contaminated",
        runBdInit: () => ({ exitCode: 0, stdout: "" }),
        readBdWhere: () => ({
          exitCode: 0,
          stdout:
            `${root}/.beads\n  prefix: dotfiles\n  database: ${root}/.beads/embeddeddolt\n`,
        }),
      }),
    ).toThrow(/prefix "dotfiles"|does not match|foreign|dotfiles/);
    rmSync(root, { recursive: true, force: true });
  });

  test("refuses init stdout that bootstrapped from remote", () => {
    const root = cloneFixture("empty-rust");
    expect(() =>
      runProjectInit({
        root,
        description: "remote clone",
        runBdInit: () => ({
          exitCode: 0,
          stdout:
            "Bootstrapped from remote: git+ssh://example/.dotfiles.git\n" +
            "Adopted project identity from existing database\n",
        }),
      }),
    ).toThrow(/foreign remote|Bootstrapped|contaminated/);
    rmSync(root, { recursive: true, force: true });
  });

  test("asks for scope when no description inferable", () => {
    const root = cloneFixture("empty-rust");
    // remove nothing — no README
    expect(() =>
      runProjectInit({
        root,
        runBdInit: () => ({ exitCode: 0, stdout: "" }),
      }),
    ).toThrow(/ask for scope/);
    const r = runProjectInit({
      root,
      askScope: () => "Inferred from user",
      runBdInit: () => ({ exitCode: 0, stdout: "" }),
    });
    expect(r.askedScope).toBe(true);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toMatch(/Inferred from user/);
    rmSync(root, { recursive: true, force: true });
  });

  test("detectStack helpers", () => {
    expect(detectStack(join(FIX, "empty-rust"))).toBe("rust");
    expect(detectStack(join(FIX, "ios-nested"))).toBe("ios");
    expect(detectStack(join(FIX, "android-compose"))).toBe("android");
    expect(skillRequirementsFor("rust")).toContain("rust-skills");
  });
});
