/**
 * Load full agent:// artifacts past OMP's default ~50 KiB read head-cap.
 *
 * OMP `read` truncates large files at DEFAULT_MAX_BYTES (50 * 1024) unless
 * ignoreResultLimits is set. Full yields still land on disk as `<id>.md`.
 * Prefer the session file when known; otherwise reassemble via line ranges.
 */

import { readFileSync } from "node:fs";

/** OMP coding-agent DEFAULT_MAX_BYTES — stay under this per range chunk. */
export const OMP_READ_DEFAULT_MAX_BYTES = 50 * 1024;

/** Default lines per range request (keeps typical plan JSON chunks well under cap). */
export const DEFAULT_AGENT_CHUNK_LINES = 200;

/** Safety valve against infinite "more lines" loops. */
export const DEFAULT_AGENT_MAX_CHUNKS = 64;

export type AgentReadFn = (path: string) => string;
export type AgentReadFileFn = (absPath: string) => string;

export type ReadAgentTextOptions = {
  /** Absolute path to session `<id>.md` when known — bypasses agent:// entirely. */
  filePath?: string;
  /** Injected fs read (tests / non-Node). Defaults to readFileSync utf8. */
  readFile?: AgentReadFileFn;
  /** Lines per agent:// range when splitting. */
  chunkLines?: number;
  /** Max range requests when splitting. */
  maxChunks?: number;
  /**
   * Force range reassembly even if the first full read has no footer.
   * Useful when the host strips truncation notices from text.
   */
  forceSplit?: boolean;
};

export type TruncationInfo = {
  truncated: boolean;
  /** Next 1-based line to continue from, if known. */
  nextStartLine?: number;
  /** Total lines when "Showing lines A-B of T" form is present. */
  totalLines?: number;
};

/** Trailing OMP read truncation footers (head or mid-range). */
const TRUNCATION_FOOTER_RE =
  /(?:\r?\n){1,2}\[(?:Showing lines (\d+)-(\d+) of (\d+)|\d+ more lines? in [^\]]+|More lines in file[^\]]*)\b[^\]]*?\bUse :L?(\d+)[^\]]*\]\s*$/i;

const TRUNCATION_ANY_RE =
  /\[(?:Showing lines \d+-\d+ of \d+|\d+ more lines? in |More lines in file)/i;

/**
 * Normalize `RedesignPlanRevision1` or `agent://RedesignPlanRevision1` to id.
 * Line ranges and field paths are stripped — use dedicated opts for those.
 */
export function normalizeAgentOutputId(ref: string): string {
  let s = ref.trim();
  if (s.startsWith("agent://")) s = s.slice("agent://".length);
  // Drop query string
  const q = s.indexOf("?");
  if (q >= 0) s = s.slice(0, q);
  // Drop field path: id/design
  const slash = s.indexOf("/");
  if (slash >= 0) s = s.slice(0, slash);
  // Drop line range: id:10-20
  const range = s.match(/^([^:]+):\d+(?:-\d+)?$/);
  if (range) s = range[1];
  if (!s) {
    throw new Error(`agent-output: empty agent id from ref ${JSON.stringify(ref)}`);
  }
  return s;
}

export function agentUri(id: string, start?: number, end?: number): string {
  const clean = normalizeAgentOutputId(id);
  if (start != null && end != null) return `agent://${clean}:${start}-${end}`;
  if (start != null) return `agent://${clean}:${start}`;
  return `agent://${clean}`;
}

/** Detect + strip a trailing OMP truncation notice; return body + next line. */
export function stripTruncationFooter(text: string): {
  body: string;
  info: TruncationInfo;
} {
  const m = TRUNCATION_FOOTER_RE.exec(text);
  if (!m) {
    // Footer may appear without leading blank lines if host formats oddly
    if (TRUNCATION_ANY_RE.test(text) && /Use :L?\d+/i.test(text)) {
      const loose = text.match(
        /\[Showing lines (\d+)-(\d+) of (\d+)[^\]]*Use :L?(\d+)[^\]]*\]\s*$/i,
      );
      if (loose) {
        const body = text.slice(0, loose.index).replace(/\s+$/, "");
        return {
          body,
          info: {
            truncated: true,
            nextStartLine: Number(loose[4]),
            totalLines: Number(loose[3]),
          },
        };
      }
      const more = text.match(
        /\[\d+ more lines?[^\]]*Use :L?(\d+)[^\]]*\]\s*$/i,
      );
      if (more && more.index != null) {
        const body = text.slice(0, more.index).replace(/\s+$/, "");
        return {
          body,
          info: { truncated: true, nextStartLine: Number(more[1]) },
        };
      }
    }
    return { body: text, info: { truncated: false } };
  }
  const body = text.slice(0, m.index).replace(/\s+$/, "");
  const nextStartLine = m[4] ? Number(m[4]) : undefined;
  const totalLines = m[3] ? Number(m[3]) : undefined;
  return {
    body,
    info: {
      truncated: true,
      nextStartLine,
      totalLines,
    },
  };
}

/** Heuristic: looks like JSON object/array but does not parse. */
export function looksLikeIncompleteJson(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return false;
  try {
    JSON.parse(t);
    return false;
  } catch {
    return true;
  }
}

function defaultReadFile(absPath: string): string {
  return readFileSync(absPath, "utf8");
}

/**
 * Load the full text of an agent yield, reassembly via line ranges if needed.
 *
 * Order:
 * 1. `filePath` on disk (no 50 KiB cap)
 * 2. single `agent://id` read when complete
 * 3. range reassembly `agent://id:start-end` under the OMP read cap
 */
export function readAgentTextFull(
  idOrUri: string,
  read: AgentReadFn,
  opts: ReadAgentTextOptions = {},
): string {
  const id = normalizeAgentOutputId(idOrUri);
  const chunkLines = opts.chunkLines ?? DEFAULT_AGENT_CHUNK_LINES;
  const maxChunks = opts.maxChunks ?? DEFAULT_AGENT_MAX_CHUNKS;

  if (opts.filePath) {
    const rf = opts.readFile ?? defaultReadFile;
    return rf(opts.filePath);
  }

  if (!opts.forceSplit) {
    const first = read(agentUri(id));
    const { body, info } = stripTruncationFooter(first);
    if (!info.truncated && !looksLikeIncompleteJson(body)) {
      return body;
    }
  }

  return readAgentTextByRanges(id, read, { chunkLines, maxChunks });
}

/**
 * Always reassemble via line ranges (no full-file first attempt).
 */
export function readAgentTextByRanges(
  idOrUri: string,
  read: AgentReadFn,
  opts: {
    chunkLines?: number;
    maxChunks?: number;
    startLine?: number;
  } = {},
): string {
  const id = normalizeAgentOutputId(idOrUri);
  const chunkLines = opts.chunkLines ?? DEFAULT_AGENT_CHUNK_LINES;
  const maxChunks = opts.maxChunks ?? DEFAULT_AGENT_MAX_CHUNKS;
  let start = opts.startLine ?? 1;
  const parts: string[] = [];

  for (let i = 0; i < maxChunks; i++) {
    const end = start + chunkLines - 1;
    const raw = read(agentUri(id, start, end));
    const { body, info } = stripTruncationFooter(raw);

    // OMP may return "beyond end" messages when start is past EOF
    if (/is beyond end of /i.test(body) && parts.length > 0) {
      break;
    }
    if (body.length > 0) {
      parts.push(body);
    } else if (!info.truncated) {
      break;
    }

    if (!info.truncated) {
      // Range fully satisfied — check if host still has more via empty next
      // peek only when body filled the window (ambiguous). Prefer footer.
      break;
    }
    const next = info.nextStartLine ?? end + 1;
    if (next <= start) {
      throw new Error(
        `agent-output: truncation next line ${next} did not advance past ${start} for ${id}`,
      );
    }
    start = next;
  }

  if (parts.length === 0) {
    throw new Error(`agent-output: empty content for agent://${id}`);
  }
  return parts.join("\n");
}

/**
 * Load and JSON.parse a full agent yield (plan/spec envelopes, etc.).
 */
export function readAgentJsonFull<T = unknown>(
  idOrUri: string,
  read: AgentReadFn,
  opts: ReadAgentTextOptions = {},
): T {
  const text = readAgentTextFull(idOrUri, read, opts);
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    // First pass may have missed silent truncation — force range reassembly once
    if (!opts.forceSplit && !opts.filePath) {
      const retry = readAgentTextFull(idOrUri, read, {
        ...opts,
        forceSplit: true,
      });
      try {
        return JSON.parse(retry) as T;
      } catch (e2) {
        const msg = e2 instanceof Error ? e2.message : String(e2);
        throw new Error(
          `agent-output: JSON.parse failed for ${normalizeAgentOutputId(idOrUri)} after split load: ${msg}`,
        );
      }
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `agent-output: JSON.parse failed for ${normalizeAgentOutputId(idOrUri)}: ${msg}`,
    );
  }
}
