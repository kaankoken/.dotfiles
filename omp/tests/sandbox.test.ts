import { describe, expect, test, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildPhaseCapabilities,
  validatePhaseCapabilities,
  CapabilityError,
  PHASE_CAPABILITIES_SCHEMA,
  type PhaseCapabilityManifest,
} from "../extensions/goal-harness/capabilities";
import {
  classifyCommand,
  classifyPathAccess,
  resolveCanonicalPath,
  resolveWritableCachePath,
  SandboxError,
} from "../extensions/goal-harness/sandbox";
import {
  cachePathForLane,
  clearRunApprovals,
  createInterceptor,
  grantRunApproval,
  interceptToolCall,
  preflightOmpApprovalConfig,
} from "../extensions/goal-harness/audit";
import {
  preflightHarnessSandbox,
  registerSandboxToolHandler,
} from "../extensions/goal-harness/index";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) {
    try {
      rmSync(temps.pop()!, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "omp-sandbox-"));
  temps.push(d);
  return d;
}

function baseRoots(repo: string): {
  repo: string;
  worktree: string;
  runTemp: string;
  integration?: string;
  migrationTargets?: string[];
} {
  const worktree = join(repo, "lane");
  const runTemp = join(repo, "tmp");
  mkdirSync(worktree, { recursive: true });
  mkdirSync(runTemp, { recursive: true });
  return { repo, worktree, runTemp };
}

function implManifest(repo: string): PhaseCapabilityManifest {
  const roots = baseRoots(repo);
  return buildPhaseCapabilities({
    phase: "Implement",
    agent: "implementer",
    runId: "run-1",
    issueId: "iss-1",
    canonicalRoots: roots,
    controller: false,
  });
}

describe("phase capabilities", () => {
  test("manifest requires phase agent runId issueId roots network operations", () => {
    expect(PHASE_CAPABILITIES_SCHEMA).toBeTruthy();
    const repo = tmp();
    const m = buildPhaseCapabilities({
      phase: "Research",
      agent: "web-scout",
      runId: "r1",
      issueId: "",
      canonicalRoots: baseRoots(repo),
    });
    expect(m.phase).toBe("Research");
    expect(m.agent).toBe("web-scout");
    expect(m.runId).toBe("r1");
    expect(m.canonicalRoots.repo).toBeTruthy();
    expect(m.network.mode).toBeTruthy();
    expect(m.operations.length).toBeGreaterThan(0);
    validatePhaseCapabilities(m);
  });

  test("non-writing phases are read-only for fs writes", () => {
    const repo = tmp();
    const m = buildPhaseCapabilities({
      phase: "Spec",
      agent: "spec-writer",
      runId: "r1",
      canonicalRoots: baseRoots(repo),
      controller: true,
    });
    expect(m.operations.some((o) => o.startsWith("fs.write."))).toBe(false);
    expect(m.operations).toContain("fs.read.repo");
    expect(m.operations).toContain("bd.write.controller");
  });

  test("Implement allows lane and runTemp writes only", () => {
    const repo = tmp();
    const m = implManifest(repo);
    expect(m.operations).toContain("fs.write.lane");
    expect(m.operations).toContain("fs.write.runTemp");
    expect(m.operations).not.toContain("git.push");
    expect(m.operations).not.toContain("gh.pr");
  });

  test("Integration allows integration git/fs ops", () => {
    const repo = tmp();
    const roots = baseRoots(repo);
    roots.integration = join(repo, "integration");
    mkdirSync(roots.integration, { recursive: true });
    const m = buildPhaseCapabilities({
      phase: "Integration",
      agent: "controller",
      runId: "r1",
      canonicalRoots: roots,
      controller: true,
    });
    expect(m.operations).toContain("fs.write.integration");
    expect(m.operations).toContain("git.write.integration");
  });

  test("push/PR only during PR phase", () => {
    const repo = tmp();
    const m = buildPhaseCapabilities({
      phase: "PR",
      agent: "pr-opener",
      runId: "r1",
      canonicalRoots: baseRoots(repo),
      controller: true,
    });
    expect(m.operations).toContain("git.push");
    expect(m.operations).toContain("gh.pr");
    const early = buildPhaseCapabilities({
      phase: "Milestone",
      agent: "milestone-organizer",
      runId: "r1",
      canonicalRoots: baseRoots(tmp()),
      controller: true,
    });
    expect(early.operations).not.toContain("git.push");
  });

  test("migration-target writes require explicit targets", () => {
    const repo = tmp();
    const roots = baseRoots(repo);
    roots.migrationTargets = [join(repo, "dotfiles-target")];
    mkdirSync(roots.migrationTargets[0]!, { recursive: true });
    const m = buildPhaseCapabilities({
      phase: "Implement",
      agent: "controller",
      runId: "r1",
      canonicalRoots: roots,
      migrationWrite: true,
      controller: true,
    });
    expect(m.operations).toContain("fs.write.migrationTarget");
    expect(() =>
      buildPhaseCapabilities({
        phase: "Implement",
        agent: "c",
        runId: "r1",
        canonicalRoots: baseRoots(tmp()),
        migrationWrite: true,
      }),
    ).toThrow(/migrationTargets/);
  });

  test("unknown fields and out-of-matrix ops fail validation", () => {
    const repo = tmp();
    const m = implManifest(repo);
    expect(() =>
      validatePhaseCapabilities({ ...m, extra: true }),
    ).toThrow(/unknown field/);
    expect(() =>
      validatePhaseCapabilities({
        ...m,
        operations: [...m.operations, "git.push"],
      }),
    ).toThrow(/outside phase matrix|git.push/);
  });

  test("builder is pure (no fs inspect beyond caller-provided roots)", () => {
    // no throw with nonexistent path strings — pure construction
    const m = buildPhaseCapabilities({
      phase: "Init",
      agent: "project-init",
      runId: "r",
      canonicalRoots: {
        repo: "/nonexistent/repo",
        worktree: "/nonexistent/wt",
        runTemp: "/nonexistent/tmp",
      },
      controller: true,
    });
    expect(m.phase).toBe("Init");
  });
});

describe("path and command policy", () => {
  test("denies unrelated home/system paths", () => {
    const repo = tmp();
    const m = implManifest(repo);
    const d = classifyPathAccess(m, "/etc/passwd", "read");
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/unrelated|denied/);
  });

  test("denies SSH/GPG/cloud/browser/OMP credential paths", () => {
    const repo = tmp();
    const m = implManifest(repo);
    for (const p of [
      join(repo, ".ssh/id_rsa"),
      "/Users/x/.aws/credentials",
      "/tmp/.omp/agent/auth.json",
    ]) {
      // put .ssh under repo still denied by marker
      if (p.includes(".ssh")) {
        mkdirSync(dirnameSafe(p), { recursive: true });
        writeFileSync(p, "secret");
      }
      const d = classifyPathAccess(m, p, "read");
      expect(d.allow).toBe(false);
    }
  });

  test("denies path traversal and unresolved env/glob", () => {
    const repo = tmp();
    const m = implManifest(repo);
    expect(() => resolveCanonicalPath(`${m.canonicalRoots.worktree}/../..`)).toThrow(
      /traversal|unrelated/,
    );
    // normalize may collapse .. — classify should still deny outside roots
    const d = classifyPathAccess(
      m,
      join(m.canonicalRoots.worktree, "..", "..", "etc"),
      "read",
    );
    expect(d.allow).toBe(false);
    expect(() => resolveCanonicalPath("$HOME/.ssh")).toThrow(/env\/glob/);
    expect(() => resolveCanonicalPath("/tmp/*.txt")).toThrow(/env\/glob/);
  });

  test("nearest-existing-parent resolution for non-existing descendants", () => {
    const repo = tmp();
    const m = implManifest(repo);
    const child = join(m.canonicalRoots.worktree, "a", "b", "c.ts");
    const r = resolveCanonicalPath(child);
    expect(r.exists).toBe(false);
    expect(existsSync(r.nearestParent)).toBe(true);
    const w = classifyPathAccess(m, child, "write");
    expect(w.allow).toBe(true);
    expect(w.operation).toBe("fs.write.lane");
  });

  test("symlink chains resolve and stay within policy", () => {
    const repo = tmp();
    const m = implManifest(repo);
    const real = join(m.canonicalRoots.worktree, "real.txt");
    writeFileSync(real, "x");
    const link = join(m.canonicalRoots.worktree, "link.txt");
    symlinkSync(real, link);
    const r = resolveCanonicalPath(link);
    expect(r.exists).toBe(true);
    expect(classifyPathAccess(m, link, "read").allow).toBe(true);
  });

  test("denies broad recursive deletion and forbidden git forms", () => {
    const repo = tmp();
    const m = implManifest(repo);
    expect(classifyCommand(m, ["rm", "-rf", "/"]).allow).toBe(false);
    expect(classifyCommand(m, ["git", "clean", "-xfd"]).allow).toBe(false);
    expect(classifyCommand(m, ["git", "reset", "--hard"]).allow).toBe(false);
    expect(classifyCommand(m, ["git", "push", "--force"]).allow).toBe(false);
    expect(classifyCommand(m, ["git", "rebase", "main"]).allow).toBe(false);
  });

  test("denies remote/PR ops before PR phase", () => {
    const repo = tmp();
    const m = implManifest(repo);
    expect(classifyCommand(m, ["git", "push", "origin", "HEAD"]).allow).toBe(
      false,
    );
    expect(classifyCommand(m, ["gh", "pr", "create"]).allow).toBe(false);
  });

  test("denies child Beads mutation without controller op", () => {
    const repo = tmp();
    const m = implManifest(repo);
    expect(m.operations).not.toContain("bd.write.controller");
    expect(classifyCommand(m, ["bd", "create", "x"]).allow).toBe(false);
  });

  test("unclassifiable command without policy fails closed", () => {
    const repo = tmp();
    const m = buildPhaseCapabilities({
      phase: "Research",
      agent: "scout",
      runId: "r",
      canonicalRoots: baseRoots(repo),
      networkMode: "none",
    });
    // remove cli by building research — has cli.execute; use empty
    expect(classifyCommand(m, []).allow).toBe(false);
  });
});

describe("preflight audit approval cache", () => {
  test("incompatible/missing approvalMode blocks entry", () => {
    const compat = { settings: ["tools.approvalMode"] };
    expect(
      preflightOmpApprovalConfig({ approvalMode: "always-ask" }, compat).ok,
    ).toBe(true);
    expect(
      preflightOmpApprovalConfig({ approvalMode: "yolo" }, compat).ok,
    ).toBe(true);
    expect(
      preflightOmpApprovalConfig({ approvalMode: "write" }, compat).ok,
    ).toBe(true);
    expect(
      preflightOmpApprovalConfig({ approvalMode: "never" }, compat).ok,
    ).toBe(false);
    expect(
      preflightOmpApprovalConfig({ approvalMode: "auto-approve-all" }, compat)
        .ok,
    ).toBe(false);
    expect(preflightOmpApprovalConfig({}, compat).ok).toBe(false);
    expect(
      preflightOmpApprovalConfig(
        { approvalMode: "always-ask", extensionGuard: false },
        compat,
      ).ok,
    ).toBe(false);
  });

  test("every tool call checked; denials written through Beads sink", () => {
    const repo = tmp();
    const m = implManifest(repo);
    const notes: string[] = [];
    const state = createInterceptor(m, {
      appendNotes: (_id, n) => {
        notes.push(n);
      },
    });
    const d = interceptToolCall(state, {
      tool: "bash",
      argv: ["git", "push", "--force"],
    });
    expect(d.allow).toBe(false);
    expect(notes.some((n) => n.includes("deny"))).toBe(true);
    expect(state.events.some((e) => e.kind === "deny")).toBe(true);
  });

  test("one-run approval never global and does not survive run", () => {
    const repo = tmp();
    const m = implManifest(repo);
    const notes: string[] = [];
    const state = createInterceptor(m, {
      appendNotes: (_i, n) => {
        notes.push(n);
      },
    });
    const req = {
      tool: "bash",
      argv: ["bd", "create", "x"],
    };
    expect(interceptToolCall(state, req).allow).toBe(false);
    const ap = grantRunApproval(state, req, "appr-1");
    expect(ap.expiresWithRun).toBe(true);
    expect(ap.runId).toBe("run-1");
    expect(interceptToolCall(state, req).allow).toBe(true);
    clearRunApprovals(state);
    expect(interceptToolCall(state, req).allow).toBe(false);
    expect(notes.some((n) => n.includes("approval"))).toBe(true);
  });

  test("writable caches resolve only below lane/run temp root", () => {
    const repo = tmp();
    const m = implManifest(repo);
    const ok = resolveWritableCachePath(m, "cargo");
    expect(ok.allow).toBe(true);
    expect(ok.resolvedPath).toContain(m.canonicalRoots.runTemp);
    const state = createInterceptor(m);
    const c = cachePathForLane(state, "bun");
    expect(c.allow).toBe(true);
    expect(c.resolvedPath?.startsWith(m.canonicalRoots.runTemp)).toBe(true);
  });

  test("preflightHarnessSandbox and tool handler wire from index", () => {
    const repo = tmp();
    const m = implManifest(repo);
    const pf = preflightHarnessSandbox({
      approvalMode: "always-ask",
      extensionGuard: true,
    });
    expect(pf.ok).toBe(true);
    const bad = preflightHarnessSandbox({ approvalMode: "never" });
    expect(bad.ok).toBe(false);

    const notes: string[] = [];
    const handler = registerSandboxToolHandler(m, {
      appendNotes: (_i, n) => {
        notes.push(n);
      },
    });
    const d = handler({ tool: "bash", argv: ["git", "reset", "--hard"] });
    expect(d.allow).toBe(false);
  });
});

function dirnameSafe(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? p : p.slice(0, i);
}
