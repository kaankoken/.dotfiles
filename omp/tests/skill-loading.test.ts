import { describe, expect, test, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  symlinkSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  REQUIRED_SKILLS_BY_ROLE,
  REQUIRED_SKILLS_SCHEMA,
  SkillResolveError,
  beadsSkillAttestation,
  discoverSkillCandidates,
  findCopiedSkillBodies,
  rehashFile,
  resolveSkill,
  resolveSkills,
  skillNamesForRole,
  validateRequiredSkillsMapping,
} from "../extensions/goal-harness/skills";
import {
  SkillToolError,
  approveSkills,
  createSkillToolState,
  harnessReadSkill,
} from "../extensions/goal-harness/skill-tool";
import {
  SkillGuardError,
  agentReadRequiredSkills,
  assertToolsUnlocked,
  attestAndUnlock,
  createSkillGuardSession,
  unlockRoleTools,
  verifyAttestation,
} from "../extensions/goal-harness/skill-guard";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) {
    const t = temps.pop()!;
    try {
      rmSync(t, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
});

function tempRoot(): string {
  const d = mkdtempSync(join(tmpdir(), "omp-skills-"));
  temps.push(d);
  return d;
}

function writeSkill(
  root: string,
  name: string,
  body = `# ${name}\n\nDo the thing.\n`,
): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, body);
  return path;
}

function sha(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("required skill mapping", () => {
  test("REQUIRED_SKILLS_BY_ROLE validates against schema shape", () => {
    expect(REQUIRED_SKILLS_SCHEMA).toBeTruthy();
    const v = validateRequiredSkillsMapping();
    expect(v.ok).toBe(true);
  });

  test("exact runtime mapping rows present", () => {
    expect(REQUIRED_SKILLS_BY_ROLE["parent-orchestrator"].skills).toEqual([
      "using-superpowers",
      "goal-harness",
      "requesting-code-review",
    ]);
    expect(REQUIRED_SKILLS_BY_ROLE["gate-controller"].skills).toEqual(
      REQUIRED_SKILLS_BY_ROLE["parent-orchestrator"].skills,
    );
    expect(REQUIRED_SKILLS_BY_ROLE["spec-producer"].skills).toContain(
      "brainstorming",
    );
    expect(REQUIRED_SKILLS_BY_ROLE["plan-producer"].skills).toContain(
      "writing-plans",
    );
    expect(REQUIRED_SKILLS_BY_ROLE["bitesize-producer"].fromParityManifest).toBe(
      true,
    );
    expect(
      REQUIRED_SKILLS_BY_ROLE["implementation-organizer"].skills,
    ).toContain("using-git-worktrees");
    expect(REQUIRED_SKILLS_BY_ROLE.implementer.includeAutomaticStackSkills).toBe(
      true,
    );
    expect(REQUIRED_SKILLS_BY_ROLE["bug-fixer"].skills).toContain(
      "systematic-debugging",
    );
    expect(REQUIRED_SKILLS_BY_ROLE["task-reviewer"].forbid).toContain(
      "receiving-code-review",
    );
    expect(REQUIRED_SKILLS_BY_ROLE["milestone-organizer"].skills).toContain(
      "verification-before-completion",
    );
    expect(REQUIRED_SKILLS_BY_ROLE["pr-agent"].skills).toEqual([
      "finishing-a-development-branch",
    ]);
  });

  test("mapping stores names only never skill content bodies", () => {
    const blob = JSON.stringify(REQUIRED_SKILLS_BY_ROLE);
    expect(blob).not.toMatch(/# Test-Driven Development/);
    expect(blob).not.toMatch(/Iron Law/);
    expect(blob.length).toBeLessThan(5000);
  });

  test("reviewers forbid receiving-code-review even if parity lists it", () => {
    const names = skillNamesForRole("task-reviewer", {
      agents: [
        {
          name: "code-reviewer",
          requiredSuperpowers: ["requesting-code-review", "receiving-code-review"],
        },
      ],
    });
    expect(names).not.toContain("receiving-code-review");
    expect(names).toContain("requesting-code-review");
  });
});

describe("resolution", () => {
  test("one exact SKILL.md resolves", () => {
    const root = tempRoot();
    const path = writeSkill(root, "using-superpowers", "# Using Superpowers\n");
    const r = resolveSkill("using-superpowers", { customDirectories: [root] });
    expect(r.name).toBe("using-superpowers");
    // macOS /var → /private/var realpath
    expect(r.path.endsWith("using-superpowers/SKILL.md")).toBe(true);
    expect(r.sha256).toBe(sha(path));
    expect(r.bytes).toBeGreaterThan(0);
  });

  test("missing skill fails", () => {
    const root = tempRoot();
    expect(() =>
      resolveSkill("nope", { customDirectories: [root] }),
    ).toThrow(SkillResolveError);
    expect(() =>
      resolveSkill("nope", { customDirectories: [root] }),
    ).toThrow(/missing skill/);
  });

  test("two different realpaths with same name fail as duplicate", () => {
    const a = tempRoot();
    const b = tempRoot();
    writeSkill(a, "caveman", "# A\n");
    writeSkill(b, "caveman", "# B different\n");
    expect(() =>
      resolveSkill("caveman", { customDirectories: [a, b] }),
    ).toThrow(/duplicate skill/);
  });

  test("two symlinks to the same realpath deduplicate safely", () => {
    const realRoot = tempRoot();
    const path = writeSkill(realRoot, "ponytail", "# Ponytail\n");
    const linkRoot = tempRoot();
    mkdirSync(join(linkRoot, "ponytail"), { recursive: true });
    // symlink SKILL.md to real file
    symlinkSync(path, join(linkRoot, "ponytail", "SKILL.md"));
    const r = resolveSkill("ponytail", {
      customDirectories: [realRoot, linkRoot],
    });
    expect(r.sha256).toBe(sha(path));
  });

  test("unreadable file fails", () => {
    const root = tempRoot();
    const path = writeSkill(root, "locked", "# x\n");
    chmodSync(path, 0o000);
    try {
      expect(() =>
        resolveSkill("locked", { customDirectories: [root] }),
      ).toThrow(/unreadable/);
    } finally {
      chmodSync(path, 0o644);
    }
  });

  test("nested root assumptions fail unless customDirectories points at parent", () => {
    const root = tempRoot();
    // skill buried under nested/extra/foo/SKILL.md — not a direct child of root
    mkdirSync(join(root, "nested", "extra", "foo"), { recursive: true });
    writeFileSync(join(root, "nested", "extra", "foo", "SKILL.md"), "# buried\n");
    expect(() =>
      resolveSkill("foo", { customDirectories: [root] }),
    ).toThrow(/missing skill/);
    // pointing customDirectories at the direct parent works
    const r = resolveSkill("foo", {
      customDirectories: [join(root, "nested", "extra")],
    });
    expect(r.name).toBe("foo");
  });

  test("content SHA-256 is complete bytes", () => {
    const root = tempRoot();
    const body = "line1\nline2\n" + "x".repeat(1000);
    const path = writeSkill(root, "hashme", body);
    const r = resolveSkill("hashme", { customDirectories: [root] });
    expect(r.sha256).toBe(
      createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex"),
    );
    expect(rehashFile(path)).toBe(r.sha256);
  });

  test("content changed between preflight and read fails", () => {
    const root = tempRoot();
    const path = writeSkill(root, "drift", "# v1\n");
    const r = resolveSkill("drift", { customDirectories: [root] });
    writeFileSync(path, "# v2 changed\n");
    expect(rehashFile(path)).not.toBe(r.sha256);
    const state = createSkillToolState();
    approveSkills(state, [r]);
    expect(() =>
      harnessReadSkill(state, r.name, r.path, r.sha256),
    ).toThrow(/changed before read|stale/);
  });

  test("path/hash/version not skill content written to Beads attestation", () => {
    const root = tempRoot();
    writeSkill(root, "s1", "version: 1.2.3\n# Secret body NEVER in beads\n");
    const skills = resolveSkills(["s1"], { customDirectories: [root] });
    const att = beadsSkillAttestation(skills);
    expect(att[0]!.name).toBe("s1");
    expect(att[0]!.path).toBeTruthy();
    expect(att[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(att[0]!.version).toBe("1.2.3");
    expect(JSON.stringify(att)).not.toContain("Secret body");
  });

  test("no copied authoritative skill text under omp agents/prompts/skills/goal-harness", () => {
    const omp = join(import.meta.dir, "..");
    for (const sub of ["agents", "prompts", "skills/goal-harness"]) {
      const offenders = findCopiedSkillBodies(join(omp, sub));
      expect(offenders).toEqual([]);
    }
  });
});

describe("harness_read_skill", () => {
  test("approved path returns complete bytes and verified event", () => {
    const root = tempRoot();
    const path = writeSkill(root, "brainstorming", "# Brainstorming full text\n");
    const r = resolveSkill("brainstorming", { customDirectories: [root] });
    const state = createSkillToolState();
    approveSkills(state, [r]);
    const { content, event } = harnessReadSkill(
      state,
      r.name,
      r.path,
      r.sha256,
    );
    expect(content).toContain("Brainstorming full text");
    expect(event.verified).toBe(true);
    expect(event.actualSha256).toBe(r.sha256);
    expect(state.reads).toHaveLength(1);
  });

  test("unapproved skill rejected", () => {
    const state = createSkillToolState();
    expect(() =>
      harnessReadSkill(state, "nope", "/tmp/x", "abc"),
    ).toThrow(/not preflight-approved/);
  });

  test("unreadable fails", () => {
    const root = tempRoot();
    const path = writeSkill(root, "x", "# x\n");
    const r = resolveSkill("x", { customDirectories: [root] });
    const state = createSkillToolState();
    approveSkills(state, [r]);
    chmodSync(path, 0o000);
    try {
      expect(() =>
        harnessReadSkill(state, r.name, r.path, r.sha256),
      ).toThrow(/unreadable/);
    } finally {
      chmodSync(path, 0o644);
    }
  });

  test("changed-before-read fails", () => {
    const root = tempRoot();
    const path = writeSkill(root, "y", "# y1\n");
    const r = resolveSkill("y", { customDirectories: [root] });
    writeFileSync(path, "# y2\n");
    const state = createSkillToolState();
    approveSkills(state, [r]);
    expect(() =>
      harnessReadSkill(state, r.name, r.path, r.sha256),
    ).toThrow(SkillToolError);
  });

  test("arbitrary path for approved name rejected", () => {
    const root = tempRoot();
    writeSkill(root, "z", "# z\n");
    const r = resolveSkill("z", { customDirectories: [root] });
    const other = tempRoot();
    const evil = writeSkill(other, "z", "# evil\n");
    const state = createSkillToolState();
    approveSkills(state, [r]);
    expect(() =>
      harnessReadSkill(state, r.name, evil, r.sha256),
    ).toThrow(/not approved|mismatch|changed/);
  });

  test("tool has no write capability in API", () => {
    const state = createSkillToolState();
    expect((state as { write?: unknown }).write).toBeUndefined();
    expect(typeof harnessReadSkill).toBe("function");
  });
});

describe("attestation and tool unlock", () => {
  function rootsWith(...names: string[]) {
    const root = tempRoot();
    for (const n of names) writeSkill(root, n, `# ${n}\n`);
    return { customDirectories: [root] };
  }

  test("full sequence unlocks parent orchestrator tools", () => {
    const roots = rootsWith(
      "using-superpowers",
      "goal-harness",
      "requesting-code-review",
    );
    const session = attestAndUnlock({
      role: "parent-orchestrator",
      skillRoots: roots,
      roleTools: ["bash", "read", "agent", "bd"],
    });
    expect(session.unlocked).toBe(true);
    expect(session.unlockedTools).toContain("bash");
    assertToolsUnlocked(session, "bash");
  });

  test("claimed-but-unobserved read fails", () => {
    const roots = rootsWith(
      "using-superpowers",
      "goal-harness",
      "requesting-code-review",
    );
    const session = createSkillGuardSession({
      role: "parent-orchestrator",
      skillRoots: roots,
      roleTools: ["bash"],
    });
    // skip agentReadRequiredSkills
    expect(() => unlockRoleTools(session)).toThrow(/unobserved/);
  });

  test("Spec producer required skills", () => {
    const roots = rootsWith(
      "brainstorming",
      "receiving-code-review",
      "caveman",
      "ponytail",
    );
    const session = attestAndUnlock({
      role: "spec-producer",
      skillRoots: roots,
      roleTools: ["write", "read"],
    });
    expect(session.briefs.map((b) => b.name).sort()).toEqual(
      [
        "brainstorming",
        "caveman",
        "ponytail",
        "receiving-code-review",
      ].sort(),
    );
  });

  test("Plan producer required skills", () => {
    const roots = rootsWith(
      "writing-plans",
      "receiving-code-review",
      "caveman",
      "ponytail",
    );
    const session = attestAndUnlock({
      role: "plan-producer",
      skillRoots: roots,
      roleTools: ["write"],
    });
    expect(session.unlocked).toBe(true);
  });

  test("implementer required skills + stack", () => {
    const roots = rootsWith(
      "subagent-driven-development",
      "test-driven-development",
      "receiving-code-review",
      "ponytail",
      "caveman",
      "rust-skills",
    );
    const session = attestAndUnlock({
      role: "implementer",
      skillRoots: roots,
      roleTools: ["bash", "edit"],
      stackSkills: ["rust-skills"],
    });
    expect(session.required.map((s) => s.name)).toContain("rust-skills");
  });

  test("bug fixer required skills", () => {
    const roots = rootsWith(
      "systematic-debugging",
      "test-driven-development",
      "receiving-code-review",
    );
    const session = attestAndUnlock({
      role: "bug-fixer",
      skillRoots: roots,
      roleTools: ["bash"],
    });
    expect(session.unlocked).toBe(true);
  });

  test("reviewer has no receiving-code-review", () => {
    const roots = rootsWith(
      "requesting-code-review",
      "ponytail-review",
      "ponytail-audit",
    );
    const session = attestAndUnlock({
      role: "task-reviewer",
      skillRoots: roots,
      roleTools: ["read"],
      parity: {
        agents: [
          {
            name: "code-reviewer",
            requiredSuperpowers: [
              "requesting-code-review",
              "ponytail-review",
              "ponytail-audit",
            ],
          },
        ],
      },
    });
    expect(session.required.map((s) => s.name)).not.toContain(
      "receiving-code-review",
    );
    expect(session.required.map((s) => s.name)).toEqual(
      expect.arrayContaining(["ponytail-review", "ponytail-audit"]),
    );
  });

  test("Milestone organizer skills", () => {
    const roots = rootsWith(
      "requesting-code-review",
      "verification-before-completion",
    );
    const session = attestAndUnlock({
      role: "milestone-organizer",
      skillRoots: roots,
      roleTools: ["bash"],
    });
    expect(session.unlocked).toBe(true);
  });

  test("PR agent finishing-a-development-branch", () => {
    const roots = rootsWith("finishing-a-development-branch");
    const session = attestAndUnlock({
      role: "pr-agent",
      skillRoots: roots,
      roleTools: ["bash", "gh"],
    });
    expect(session.briefs[0]!.name).toBe("finishing-a-development-branch");
  });

  test("tools locked until attestation", () => {
    const roots = rootsWith(
      "using-superpowers",
      "goal-harness",
      "requesting-code-review",
    );
    const session = createSkillGuardSession({
      role: "parent-orchestrator",
      skillRoots: roots,
      roleTools: ["bash"],
    });
    expect(() => assertToolsUnlocked(session, "bash")).toThrow(/locked/);
    agentReadRequiredSkills(session);
    unlockRoleTools(session);
    assertToolsUnlocked(session, "bash");
  });
});
