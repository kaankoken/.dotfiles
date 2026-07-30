/**
 * OMP-native coding tool manifest for implementer lanes.
 * Native: Hashline, LSP, AST/search, shell, web_search.
 * Shared MCP allowlist only: TokenSave (cold), headroom / context-mode /
 * context7 (opt-in via enabled:false → /mcp enable).
 */

export class NativeToolsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeToolsError";
  }
}

/** Tools provided by OMP runtime (not MCP). */
export const OMP_NATIVE_TOOLS = [
  "hashline",
  "lsp",
  "ast_search",
  "shell",
  "web_search",
] as const;

export type OmpNativeTool = (typeof OMP_NATIVE_TOOLS)[number];

/** Shared MCP servers allowed alongside native tools. */
export const SHARED_MCP_ALLOWLIST = [
  "tokensave",
  "headroom",
  "context-mode",
  "context7",
] as const;

export type SharedMcp = (typeof SHARED_MCP_ALLOWLIST)[number];

/** Code-graph order: TokenSave first. */
export const CODE_GRAPH_ORDER = ["tokensave", "ast_search", "shell"] as const;

/** Ecosystem facts: native web_search first. */
export const ECOSYSTEM_FACTS_ORDER = ["web_search"] as const;

export type NativeToolManifest = {
  native: OmpNativeTool[];
  mcpAllowlist: SharedMcp[];
  codeGraphFirst: "tokensave";
  ecosystemFactsFirst: "web_search";
  hashline: true;
  lsp: true;
  /** Grok lanes use Hashline + high effort */
  grok: { useHashline: true; effort: "high" };
  /** Forbidden: duplicate MCP that reimplements native capabilities */
  forbiddenDuplicateMcp: string[];
};

export const FORBIDDEN_DUPLICATE_MCP = [
  "hashline-mcp",
  "lsp-mcp",
  "ast-search-mcp",
  "web-search-mcp",
  "code-search-mcp",
] as const;

export function buildNativeToolManifest(
  opts?: { modelFamily?: string },
): NativeToolManifest {
  return {
    native: [...OMP_NATIVE_TOOLS],
    mcpAllowlist: [...SHARED_MCP_ALLOWLIST],
    codeGraphFirst: "tokensave",
    ecosystemFactsFirst: "web_search",
    hashline: true,
    lsp: true,
    grok: { useHashline: true, effort: "high" },
    forbiddenDuplicateMcp: [...FORBIDDEN_DUPLICATE_MCP],
  };
}

export function assertNoDuplicateNativeMcp(enabledMcp: string[]): void {
  for (const m of enabledMcp) {
    const low = m.toLowerCase();
    if (
      FORBIDDEN_DUPLICATE_MCP.some((f) => low.includes(f.replace("-mcp", ""))) &&
      !SHARED_MCP_ALLOWLIST.includes(m as SharedMcp)
    ) {
      // only forbid known duplicates
    }
    if ((FORBIDDEN_DUPLICATE_MCP as readonly string[]).includes(low)) {
      throw new NativeToolsError(
        `duplicate MCP ${m} implements native Hashline/LSP/AST/search/web — forbidden`,
      );
    }
  }
}

export type HashlineEdit = {
  path: string;
  line: number;
  oldText: string;
  newText: string;
};

/**
 * Apply a Hashline-style line edit in memory (fixture / pure logic).
 * Real OMP Hashline is used at runtime; this validates expected line change.
 */
export function applyHashlineEdit(
  source: string,
  edit: HashlineEdit,
): string {
  const lines = source.split("\n");
  const idx = edit.line - 1;
  if (idx < 0 || idx >= lines.length) {
    throw new NativeToolsError(`hashline: line ${edit.line} out of range`);
  }
  if (lines[idx] !== edit.oldText) {
    throw new NativeToolsError(
      `hashline: line ${edit.line} mismatch (expected ${JSON.stringify(edit.oldText)})`,
    );
  }
  lines[idx] = edit.newText;
  return lines.join("\n");
}

export type LspDiagnostic = {
  path: string;
  line: number;
  message: string;
  severity: "error" | "warning";
};

/** Pure LSP diagnostic bag for fixture tests. */
export class LspFixture {
  private diags = new Map<string, LspDiagnostic[]>();

  set(path: string, list: LspDiagnostic[]): void {
    this.diags.set(path, list);
  }

  get(path: string): LspDiagnostic[] {
    return this.diags.get(path) ?? [];
  }

  clear(path: string): void {
    this.diags.delete(path);
  }
}

/**
 * Minimal AST/search: find syntax-shaped identifier targets in source.
 */
export function nativeAstSearch(
  source: string,
  pattern: string,
): Array<{ line: number; match: string }> {
  const re = new RegExp(pattern, "g");
  const out: Array<{ line: number; match: string }> = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      out.push({ line: i + 1, match: m[0]! });
    }
  }
  return out;
}

export function codeGraphRequestOrder(
  requests: string[],
): { ok: boolean; reason?: string } {
  const firstGraph = requests.find((r) =>
    ["tokensave", "ast_search", "rg", "grep"].includes(r),
  );
  if (firstGraph && firstGraph !== "tokensave") {
    return {
      ok: false,
      reason: `code-graph must start with tokensave, got ${firstGraph}`,
    };
  }
  return { ok: true };
}

export function ecosystemFactsOrder(
  requests: string[],
): { ok: boolean; reason?: string } {
  const first = requests.find((r) =>
    ["web_search", "context7", "browser"].includes(r),
  );
  if (first && first !== "web_search") {
    return {
      ok: false,
      reason: `ecosystem facts must start with web_search, got ${first}`,
    };
  }
  return { ok: true };
}

export function grokLaneConfig(effort: string, tools: string[]): {
  ok: boolean;
  reason?: string;
} {
  if (effort !== "high") {
    return { ok: false, reason: `grok effort must be high, got ${effort}` };
  }
  if (!tools.includes("hashline")) {
    return { ok: false, reason: "grok lane must use hashline" };
  }
  return { ok: true };
}
