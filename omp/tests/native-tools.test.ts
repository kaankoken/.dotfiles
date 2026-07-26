import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FORBIDDEN_DUPLICATE_MCP,
  LspFixture,
  OMP_NATIVE_TOOLS,
  SHARED_MCP_ALLOWLIST,
  applyHashlineEdit,
  assertNoDuplicateNativeMcp,
  buildNativeToolManifest,
  codeGraphRequestOrder,
  ecosystemFactsOrder,
  grokLaneConfig,
  nativeAstSearch,
  NativeToolsError,
} from "../extensions/goal-harness/native-tools";
import {
  buildLaneNativeSessionConfig,
  type LaneAssignment,
} from "../extensions/goal-harness/lane-runner";

const FIXTURE = join(import.meta.dir, "fixtures/typed-project");
const SAMPLE = join(FIXTURE, "src/sample.ts");

describe("native tools fixture", () => {
  test("Hashline edit changes the expected line", () => {
    const src = readFileSync(SAMPLE, "utf8");
    const lines = src.split("\n");
    const lineNo = lines.findIndex((l) => l.includes("INTENTIONAL_BUG")) + 1;
    const oldText = lines[lineNo - 1]!;
    const next = applyHashlineEdit(src, {
      path: SAMPLE,
      line: lineNo,
      oldText,
      newText: "export const INTENTIONAL_BUG = 1;",
    });
    expect(next.split("\n")[lineNo - 1]).toBe(
      "export const INTENTIONAL_BUG = 1;",
    );
    expect(next).not.toContain('1 + ""');
  });

  test("LSP returns and clears a deliberate diagnostic", () => {
    const lsp = new LspFixture();
    lsp.set(SAMPLE, [
      {
        path: SAMPLE,
        line: 5,
        message: "Type 'string' is not assignable",
        severity: "error",
      },
    ]);
    expect(lsp.get(SAMPLE)).toHaveLength(1);
    expect(lsp.get(SAMPLE)[0]!.message).toMatch(/Type/);
    lsp.clear(SAMPLE);
    expect(lsp.get(SAMPLE)).toHaveLength(0);
  });

  test("native AST/search finds a syntax-shaped target", () => {
    const src = readFileSync(SAMPLE, "utf8");
    const hits = nativeAstSearch(src, "function\\s+greet");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.line).toBe(1);
    expect(hits[0]!.match).toMatch(/function\s+greet/);
  });

  test("TokenSave remains the first code-graph request", () => {
    expect(codeGraphRequestOrder(["tokensave", "ast_search"]).ok).toBe(true);
    expect(codeGraphRequestOrder(["ast_search", "tokensave"]).ok).toBe(false);
    expect(codeGraphRequestOrder(["rg", "tokensave"]).reason).toMatch(
      /tokensave/,
    );
  });

  test("native web_search is first for current ecosystem facts", () => {
    expect(ecosystemFactsOrder(["web_search", "context7"]).ok).toBe(true);
    expect(ecosystemFactsOrder(["context7", "web_search"]).ok).toBe(false);
  });

  test("Grok lane configuration uses Hashline and high effort", () => {
    expect(grokLaneConfig("high", ["hashline", "lsp"]).ok).toBe(true);
    expect(grokLaneConfig("medium", ["hashline"]).ok).toBe(false);
    expect(grokLaneConfig("high", ["lsp"]).ok).toBe(false);
  });

  test("no duplicate MCP implements Hashline/LSP/AST/search/web", () => {
    expect(() =>
      assertNoDuplicateNativeMcp([...SHARED_MCP_ALLOWLIST]),
    ).not.toThrow();
    expect(() =>
      assertNoDuplicateNativeMcp(["tokensave", "hashline-mcp"]),
    ).toThrow(NativeToolsError);
    expect(FORBIDDEN_DUPLICATE_MCP.length).toBeGreaterThan(0);
  });

  test("manifest pins native tools + shared MCP allowlist only", () => {
    const m = buildNativeToolManifest();
    expect(m.native).toEqual([...OMP_NATIVE_TOOLS]);
    expect(m.mcpAllowlist).toEqual([...SHARED_MCP_ALLOWLIST]);
    expect(m.codeGraphFirst).toBe("tokensave");
    expect(m.ecosystemFactsFirst).toBe("web_search");
    expect(m.hashline).toBe(true);
    expect(m.lsp).toBe(true);
    expect(m.grok.effort).toBe("high");
  });
});

describe("lane-runner native tool wiring", () => {
  test("buildLaneNativeSessionConfig attaches native manifest", () => {
    const assignment: LaneAssignment = {
      issueId: "t1",
      worktreePath: FIXTURE,
      branch: "harness/run1/t1",
      baseSha: "a".repeat(40),
      issueText: "fix type error",
      specContext: "s",
      planContext: "p",
      model: "xai/grok",
      effort: "high",
    };
    const cfg = buildLaneNativeSessionConfig(assignment);
    expect(cfg.nativeTools.native).toContain("hashline");
    expect(cfg.nativeTools.mcpAllowlist).toContain("tokensave");
    expect(cfg.nativeTools.mcpAllowlist).not.toContain("hashline-mcp");
    expect(cfg.codeGraphFirst).toBe("tokensave");
    if (assignment.model.includes("grok")) {
      expect(cfg.grok?.effort).toBe("high");
      expect(cfg.grok?.useHashline).toBe(true);
    }
  });
});
