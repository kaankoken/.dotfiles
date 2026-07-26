import { describe, expect, test, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  STACK_SKILL_SETS,
  StackSkillsError,
  detectStackMarkers,
  parseProjectDeclaredSkills,
  prepareStackSkills,
  requiredSkillsForMarker,
  attestImplementerWithStack,
} from "../extensions/goal-harness/stack-skills";

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
  const d = mkdtempSync(join(tmpdir(), "omp-stack-"));
  temps.push(d);
  return d;
}

function skillRoot(names: string[]): string {
  const root = tmp();
  for (const n of names) {
    mkdirSync(join(root, n), { recursive: true });
    writeFileSync(join(root, n, "SKILL.md"), `# ${n}\n`);
  }
  return root;
}

describe("stack marker detection", () => {
  test("Rust workspace requires actionbook rust-skills", () => {
    const proj = tmp();
    writeFileSync(join(proj, "Cargo.toml"), "[package]\nname='x'\n");
    const d = detectStackMarkers(proj);
    expect(d.marker).toBe("rust");
    expect(d.requiredSkills).toEqual(STACK_SKILL_SETS.rust);
    expect(d.evidence).toContain("Cargo.toml");
  });

  test("Swift/Xcode/iOS requires Axiom", () => {
    const proj = tmp();
    writeFileSync(join(proj, "Package.swift"), "// swift\n");
    const d = detectStackMarkers(proj);
    expect(d.marker).toBe("ios");
    expect(d.requiredSkills).toEqual(["axiom"]);
  });

  test("Android/Gradle/Compose requires android + compose-performance + android-testing", () => {
    const proj = tmp();
    writeFileSync(join(proj, "settings.gradle.kts"), "rootProject.name='app'\n");
    writeFileSync(
      join(proj, "build.gradle.kts"),
      "plugins { id('org.jetbrains.compose') }\n",
    );
    const d = detectStackMarkers(proj);
    expect(d.marker).toBe("android");
    expect(d.requiredSkills).toEqual([
      "android",
      "compose-performance",
      "android-testing",
    ]);
  });

  test("mixed multi-stack unions skill sets", () => {
    const proj = tmp();
    writeFileSync(join(proj, "Cargo.toml"), "[package]\n");
    writeFileSync(join(proj, "Package.swift"), "//\n");
    const d = detectStackMarkers(proj);
    expect(d.marker).toBe("mixed");
    expect(d.requiredSkills).toContain("rust-skills");
    expect(d.requiredSkills).toContain("axiom");
  });
});

describe("stack skill resolution and blocking", () => {
  test("missing required stack skills block with exact missing names", () => {
    const proj = tmp();
    writeFileSync(join(proj, "Cargo.toml"), "[package]\n");
    const emptySkills = skillRoot([]); // no rust-skills
    expect(() =>
      prepareStackSkills(proj, { customDirectories: [emptySkills] }),
    ).toThrow(StackSkillsError);
    try {
      prepareStackSkills(proj, { customDirectories: [emptySkills] });
    } catch (e) {
      expect(String(e)).toMatch(/rust-skills/);
      expect(String(e)).toMatch(/missing required stack skills/);
    }
  });

  test("required skills resolve then extras additive after duplicate checks", () => {
    const proj = tmp();
    writeFileSync(join(proj, "Cargo.toml"), "[package]\n");
    writeFileSync(
      join(proj, "AGENTS.md"),
      "stack-skills: extra-tool, rust-skills\n",
    );
    const roots = skillRoot(["rust-skills", "extra-tool"]);
    const prep = prepareStackSkills(proj, { customDirectories: [roots] });
    expect(prep.skillNames).toContain("rust-skills");
    expect(prep.skillNames).toContain("extra-tool");
    // rust-skills not duplicated
    expect(prep.skillNames.filter((n) => n === "rust-skills")).toHaveLength(1);
  });

  test("parseProjectDeclaredSkills reads AGENTS.md", () => {
    const proj = tmp();
    writeFileSync(join(proj, "AGENTS.md"), "required skills: foo, bar\n");
    expect(parseProjectDeclaredSkills(proj)).toEqual(["foo", "bar"]);
  });

  test("attestImplementerWithStack unlocks only after stack skills present", () => {
    const proj = tmp();
    writeFileSync(join(proj, "Package.swift"), "//\n");
    const roots = skillRoot([
      "axiom",
      "subagent-driven-development",
      "test-driven-development",
      "receiving-code-review",
      "ponytail",
      "caveman",
    ]);
    const session = attestImplementerWithStack({
      worktreeRoot: proj,
      skillRoots: { customDirectories: [roots] },
      roleTools: ["bash", "edit"],
    });
    expect(session.unlocked).toBe(true);
    expect(session.required.map((s) => s.name)).toContain("axiom");
  });

  test("requiredSkillsForMarker table matches design", () => {
    expect(requiredSkillsForMarker("rust")).toEqual(["rust-skills"]);
    expect(requiredSkillsForMarker("ios")).toEqual(["axiom"]);
    expect(requiredSkillsForMarker("android")).toEqual([
      "android",
      "compose-performance",
      "android-testing",
    ]);
    expect(requiredSkillsForMarker("unknown")).toEqual([]);
  });
});
