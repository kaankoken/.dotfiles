import type {
  ReviewAnchor,
  SnapshotChangedFile,
  SnapshotNonreviewableEntry,
  SnapshotReviewableLine,
} from "./contracts";

export interface ParsedUnifiedDiff {
  lines: readonly SnapshotReviewableLine[];
  nonreviewableEntries: readonly SnapshotNonreviewableEntry[];
}

interface DiffBlock {
  header: string;
  lines: string[];
  oldPath?: string;
  newPath?: string;
  renameTo?: string;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const ANCHOR_KEYS: Record<keyof ReviewAnchor, true> = {
  path: true,
  line: true,
  side: true,
  start_line: true,
  start_side: true,
};
const GIT_ESCAPE_BYTES: Record<string, number> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  "\"": 34,
  "\\": 92,
};

function decodeGitPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  if (!trimmed.endsWith('"')) throw new Error("malformed quoted diff path");

  const bytes: number[] = [];
  const body = trimmed.slice(1, -1);
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]!;
    if (character !== "\\") {
      const codePoint = String.fromCodePoint(body.codePointAt(index)!);
      bytes.push(...new TextEncoder().encode(codePoint));
      index += codePoint.length - 1;
      continue;
    }

    const escaped = body[++index];
    if (escaped === undefined) throw new Error("malformed quoted diff path");
    if (/[0-7]/.test(escaped)) {
      let octal = escaped;
      while (octal.length < 3 && /[0-7]/.test(body[index + 1] ?? "")) {
        octal += body[++index]!;
      }
      bytes.push(Number.parseInt(octal, 8));
      continue;
    }
    const escapedByte = GIT_ESCAPE_BYTES[escaped];
    if (escapedByte === undefined) throw new Error("malformed quoted diff path");
    bytes.push(escapedByte);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    throw new Error("malformed quoted diff path");
  }
}

function quotedDiffNewPath(header: string): string | undefined {
  const operands = header.slice("diff --git ".length);
  if (!operands.startsWith('"')) return undefined;
  let cursor = 0;
  const readOperand = (): string => {
    const start = cursor;
    if (operands[cursor] !== '"') throw new Error("malformed quoted diff path");
    cursor += 1;
    while (cursor < operands.length) {
      if (operands[cursor] === "\\") {
        cursor += 2;
      } else if (operands[cursor] === '"') {
        cursor += 1;
        return decodeGitPath(operands.slice(start, cursor));
      } else {
        cursor += 1;
      }
    }
    throw new Error("malformed quoted diff path");
  };

  readOperand();
  while (operands[cursor] === " ") cursor += 1;
  const newPath = readOperand();
  while (operands[cursor] === " ") cursor += 1;
  if (cursor !== operands.length) throw new Error("malformed quoted diff path");
  return newPath.startsWith("b/") ? newPath.slice(2) : newPath;
}

function headerPath(line: string, prefix: "--- " | "+++ "): string | undefined {
  if (!line.startsWith(prefix)) return undefined;
  const value = decodeGitPath(line.slice(prefix.length));
  if (value === "/dev/null") return undefined;
  return value.startsWith("a/") || value.startsWith("b/") ? value.slice(2) : value;
}

function parseBlocks(diff: string): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let current: DiffBlock | undefined;

  for (const line of diff.replaceAll("\r\n", "\n").split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = { header: line, lines: [] };
      blocks.push(current);
    }
    if (!current) {
      if (line.length > 0) throw new Error("malformed unified diff");
      continue;
    }
    current.lines.push(line);
    current.oldPath ??= headerPath(line, "--- ");
    current.newPath ??= headerPath(line, "+++ ");
    if (line.startsWith("rename to ")) current.renameTo = decodeGitPath(line.slice(10));
  }

  return blocks;
}

function canonicalBlockPath(
  block: DiffBlock,
  changedFiles: readonly SnapshotChangedFile[],
): string {
  const path = block.newPath ?? block.renameTo ?? block.oldPath;
  if (path) return path;
  const quotedPath = quotedDiffNewPath(block.header);
  if (quotedPath) return quotedPath;

  const candidates = changedFiles.filter((file) =>
    block.header.endsWith(` b/${file.path}`)
      || block.header.endsWith(` ${JSON.stringify(`b/${file.path}`)}`)
      || block.lines.some((line) => line.endsWith(` b/${file.path} differ`))
  );
  if (candidates.length !== 1) throw new Error("diff block has no canonical path");
  return candidates[0]!.path;
}

export function mapCanonicalDiffBlocks(
  diff: string | Uint8Array,
  changedFiles: readonly SnapshotChangedFile[],
): ReadonlyMap<string, readonly string[]> {
  const text = typeof diff === "string"
    ? diff
    : new TextDecoder("utf-8", { fatal: true }).decode(diff);
  const mapped = new Map<string, readonly string[]>();
  for (const block of parseBlocks(text)) {
    const path = canonicalBlockPath(block, changedFiles);
    if (mapped.has(path)) throw new Error(`duplicate diff block for ${path}`);
    mapped.set(path, Object.freeze([...block.lines]));
  }
  return mapped;
}

function parseReviewableBlock(
  block: DiffBlock,
  path: string,
): SnapshotReviewableLine[] {
  const reviewable: SnapshotReviewableLine[] = [];
  let hunk = -1;

  for (let index = 0; index < block.lines.length; index += 1) {
    const header = HUNK_HEADER.exec(block.lines[index]!);
    if (!header) continue;

    hunk += 1;
    let oldLine = Number(header[1]);
    let newLine = Number(header[3]);
    const expectedOld = Number(header[2] ?? 1);
    const expectedNew = Number(header[4] ?? 1);
    let seenOld = 0;
    let seenNew = 0;

    for (index += 1; index < block.lines.length; index += 1) {
      const line = block.lines[index]!;
      if (HUNK_HEADER.test(line)) {
        index -= 1;
        break;
      }
      if (line.startsWith("diff --git ")) {
        index -= 1;
        break;
      }
      if (line.startsWith("\\ No newline at end of file")) continue;
      if (line.startsWith(" ")) {
        reviewable.push(Object.freeze({ path, line: newLine, side: "RIGHT", hunk }));
        oldLine += 1;
        newLine += 1;
        seenOld += 1;
        seenNew += 1;
      } else if (line.startsWith("-")) {
        reviewable.push(Object.freeze({ path, line: oldLine, side: "LEFT", hunk }));
        oldLine += 1;
        seenOld += 1;
      } else if (line.startsWith("+")) {
        reviewable.push(Object.freeze({ path, line: newLine, side: "RIGHT", hunk }));
        newLine += 1;
        seenNew += 1;
      } else if (line.length === 0) {
        break;
      } else {
        throw new Error(`malformed hunk for ${path}`);
      }

      if (seenOld > expectedOld || seenNew > expectedNew) {
        throw new Error(`hunk exceeds declared range for ${path}`);
      }
    }

    if (seenOld !== expectedOld || seenNew !== expectedNew) {
      throw new Error(`truncated hunk for ${path}`);
    }
  }

  if (hunk < 0 && block.lines.some((line) => line.startsWith("@@"))) {
    throw new Error(`malformed hunk for ${path}`);
  }
  return reviewable;
}

export function parseUnifiedDiff(
  diff: string | Uint8Array,
  changedFiles: readonly SnapshotChangedFile[],
): ParsedUnifiedDiff {
  const text = typeof diff === "string" ? diff : new TextDecoder("utf-8", { fatal: true }).decode(diff);
  const blocks = parseBlocks(text);
  const changedByPath = new Map<string, SnapshotChangedFile>();

  for (const file of changedFiles) {
    if (changedByPath.has(file.path)) throw new Error(`duplicate changed file ${file.path}`);
    if (file.reviewable && !file.patchComplete) throw new Error(`incomplete patch for ${file.path}`);
    changedByPath.set(file.path, file);
  }

  const blockByPath = new Map<string, DiffBlock>();
  for (const block of blocks) {
    const path = canonicalBlockPath(block, changedFiles);
    const changed = changedByPath.get(path);
    if (!changed) {
      if (block.renameTo || changedFiles.some((file) => file.status.toLowerCase().includes("rename"))) {
        throw new Error(`rename mismatch for ${path}`);
      }
      throw new Error(`diff path ${path} not present in changed-file metadata`);
    }
    if (block.renameTo && block.renameTo !== changed.path) {
      throw new Error(`rename mismatch for ${changed.path}`);
    }
    if (blockByPath.has(path)) throw new Error(`duplicate diff block for ${path}`);
    blockByPath.set(path, block);
  }

  const lines: SnapshotReviewableLine[] = [];
  const nonreviewableEntries: SnapshotNonreviewableEntry[] = [];
  for (const file of changedFiles) {
    if (!file.reviewable) {
      const status = file.status.toLowerCase();
      if (!status.includes("binary") && !status.includes("submodule")) {
        throw new Error(`missing textual patch for ${file.path}`);
      }
      nonreviewableEntries.push(Object.freeze({
        path: file.path,
        reason: status.includes("submodule") ? "submodule" : "binary",
      }));
      continue;
    }

    const block = blockByPath.get(file.path);
    if (!block) throw new Error(`missing textual patch for ${file.path}`);
    lines.push(...parseReviewableBlock(block, file.path));
  }

  return Object.freeze({
    lines: Object.freeze(lines),
    nonreviewableEntries: Object.freeze(nonreviewableEntries),
  });
}

export function validateAnchor(
  anchor: ReviewAnchor,
  lineMap: readonly SnapshotReviewableLine[],
): boolean {
  if (!anchor || typeof anchor !== "object") return false;
  if (Object.keys(anchor).some((key) => !(key in ANCHOR_KEYS))) return false;
  if (!anchor.path || !Number.isInteger(anchor.line) || anchor.line < 1) return false;
  if (anchor.side !== "LEFT" && anchor.side !== "RIGHT") return false;

  const end = lineMap.find((entry) =>
    entry.path === anchor.path && entry.line === anchor.line && entry.side === anchor.side
  );
  if (!end) return false;

  const hasStartLine = anchor.start_line !== undefined;
  const hasStartSide = anchor.start_side !== undefined;
  if (!hasStartLine && !hasStartSide) return true;
  if (!hasStartLine || !hasStartSide) return false;
  if (!Number.isInteger(anchor.start_line) || anchor.start_line! < 1) return false;
  if (anchor.start_side !== anchor.side || anchor.start_line! > anchor.line) return false;

  const start = lineMap.find((entry) =>
    entry.path === anchor.path
      && entry.line === anchor.start_line
      && entry.side === anchor.start_side
  );
  return start?.hunk === end.hunk;
}
