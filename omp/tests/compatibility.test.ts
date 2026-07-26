import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OMP_ROOT = join(import.meta.dir, "..");
const CONTRACT_PATH = join(OMP_ROOT, "compatibility.json");

const requiredSettings = [
  "autolearn.enabled",
  "compaction.strategy",
  "edit.mode",
  "lsp.enabled",
  "memory.backend",
  "task.maxConcurrency",
  "todo.enabled",
  "tools.approvalMode",
] as const;

const requiredSdkOptions = [
  "cwd",
  "model",
  "thinkingLevel",
  "outputSchema",
  "outputSchemaMode",
  "requireYieldTool",
  "enableLsp",
  "sessionManager",
] as const;

const requiredTaskFields = [
  "context",
  "tasks",
  "agent",
  "task",
  "outputSchema",
  "schemaMode",
  "isolated",
] as const;

const requiredAgentFrontmatter = [
  "name",
  "description",
  "tools",
  "spawns",
  "model",
  "thinkingLevel",
  "output",
  "blocking",
  "autoloadSkills",
  "read-summarize",
  "prewalk",
] as const;

const requiredExtensionApis = [
  "on",
  "registerCommand",
  "registerTool",
  "sendMessage",
  "sendUserMessage",
  "setActiveTools",
  "exec",
  "ctx.compact",
  "pi.createAgentSession",
  "pi.SessionManager.inMemory",
] as const;

const requiredCompactionStrategies = [
  "context-full",
  "handoff",
  "shake",
  "snapcompact",
  "off",
] as const;

const requiredCompactModes = ["soft", "remote", "snapcompact"] as const;

export type CommandRunner = (
  argv: string[],
) => { exitCode: number; stdout: string; stderr: string };

/** Default runner invokes real `omp` on PATH (Stage 1 binary). */
export const defaultRunner: CommandRunner = (argv) => {
  const proc = Bun.spawnSync(["omp", ...argv], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode ?? 1,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  };
};

function loadContract() {
  expect(existsSync(CONTRACT_PATH)).toBe(true);
  const raw = readFileSync(CONTRACT_PATH, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function assertStringArray(value: unknown, label: string): string[] {
  expect(Array.isArray(value)).toBe(true);
  const arr = value as unknown[];
  for (const item of arr) {
    expect(typeof item).toBe("string");
  }
  return arr as string[];
}

describe("OMP compatibility contract", () => {
  test("compatibility.json exists with required top-level shape", () => {
    const doc = loadContract();
    for (const key of [
      "ompVersion",
      "upstreamCommit",
      "verifiedAt",
      "settings",
      "sdkOptions",
      "taskFields",
      "agentFrontmatter",
      "extensionApis",
      "compactionStrategies",
      "compactModes",
    ] as const) {
      expect(key in doc).toBe(true);
    }
    expect(typeof doc.ompVersion).toBe("string");
    expect(typeof doc.upstreamCommit).toBe("string");
    expect(typeof doc.verifiedAt).toBe("string");
    expect((doc.ompVersion as string).length).toBeGreaterThan(0);
    expect((doc.upstreamCommit as string).length).toBeGreaterThan(0);
    expect((doc.verifiedAt as string).length).toBeGreaterThan(0);
  });

  test("records required settings, sdk options, and task fields", () => {
    const doc = loadContract();
    const settings = assertStringArray(doc.settings, "settings");
    const sdkOptions = assertStringArray(doc.sdkOptions, "sdkOptions");
    const taskFields = assertStringArray(doc.taskFields, "taskFields");
    for (const k of requiredSettings) {
      expect(settings).toContain(k);
    }
    for (const k of requiredSdkOptions) {
      expect(sdkOptions).toContain(k);
    }
    for (const k of requiredTaskFields) {
      expect(taskFields).toContain(k);
    }
  });

  test("records frontmatter, extension APIs, compaction strategies and modes", () => {
    const doc = loadContract();
    const agentFrontmatter = assertStringArray(
      doc.agentFrontmatter,
      "agentFrontmatter",
    );
    const extensionApis = assertStringArray(doc.extensionApis, "extensionApis");
    const compactionStrategies = assertStringArray(
      doc.compactionStrategies,
      "compactionStrategies",
    );
    const compactModes = assertStringArray(doc.compactModes, "compactModes");
    for (const k of requiredAgentFrontmatter) {
      expect(agentFrontmatter).toContain(k);
    }
    for (const k of requiredExtensionApis) {
      expect(extensionApis).toContain(k);
    }
    for (const k of requiredCompactionStrategies) {
      expect(compactionStrategies).toContain(k);
    }
    for (const k of requiredCompactModes) {
      expect(compactModes).toContain(k);
    }
  });

  test("active binary version matches recorded ompVersion", () => {
    const doc = loadContract();
    const runner = defaultRunner;
    const result = runner(["--version"]);
    expect(result.exitCode).toBe(0);
    const versionLine = result.stdout.trim().split("\n")[0] ?? "";
    expect(versionLine.length).toBeGreaterThan(0);
    expect(versionLine).toContain(String(doc.ompVersion).replace(/^omp\//, ""));
  });

  test("pinned settings exist on live omp config list --json", () => {
    const doc = loadContract();
    const runner = defaultRunner;
    const result = runner(["config", "list", "--json"]);
    expect(result.exitCode).toBe(0);
    const live = JSON.parse(result.stdout) as Record<string, unknown>;
    const settings = assertStringArray(doc.settings, "settings");
    for (const key of settings) {
      expect(key in live).toBe(true);
    }
  });

  test("session route declarations pin ExtensionAPI.pi.createAgentSession + inMemory", () => {
    const doc = loadContract();
    const apis = assertStringArray(doc.extensionApis, "extensionApis");
    expect(apis).toContain("pi.createAgentSession");
    expect(apis).toContain("pi.SessionManager.inMemory");
    // Pinned sdk options are the exact keys accepted by those session constructors.
    const sdkOptions = assertStringArray(doc.sdkOptions, "sdkOptions");
    for (const k of requiredSdkOptions) {
      expect(sdkOptions).toContain(k);
    }
  });

  test("fixture runner can inject failure without calling real omp", () => {
    const failing: CommandRunner = () => ({
      exitCode: 1,
      stdout: "",
      stderr: "injected",
    });
    const result = failing(["--version"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("injected");
  });
});
