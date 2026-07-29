import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentUri,
  looksLikeIncompleteJson,
  normalizeAgentOutputId,
  readAgentJsonFull,
  readAgentTextByRanges,
  readAgentTextFull,
  stripTruncationFooter,
} from "../extensions/goal-harness/agent-output";

function makeLargePlan(minBytes = 55_000): string {
  const tasks = Array.from({ length: 80 }, (_, i) => ({
    id: `T${i + 1}`,
    title: `Task ${i + 1} — padding ${"x".repeat(120)}`,
    depends_on: i > 0 ? [`T${i}`] : [],
    detail: "d".repeat(200),
  }));
  const obj = {
    issue_id: "dotfiles-test.1",
    status: "in_progress",
    design: "# design — " + "paragraph with detail. ".repeat(200),
    notes: "notes " + "y".repeat(400),
    task_dependency_table: tasks,
    acceptance_map: Array.from({ length: 30 }, (_, i) => ({
      criterion: i + 1,
      tasks: [`T${i + 1}`],
      verification: `verify ${i} ` + "z".repeat(180),
    })),
    pad: [] as string[],
  };
  let pretty = JSON.stringify(obj, null, 2);
  let n = 0;
  while (Buffer.byteLength(pretty, "utf8") < minBytes && n < 500) {
    obj.pad.push(`pad-line-${n} ` + "w".repeat(100));
    pretty = JSON.stringify(obj, null, 2);
    n++;
  }
  if (Buffer.byteLength(pretty, "utf8") < minBytes) {
    throw new Error("makeLargePlan: failed to reach minBytes");
  }
  return pretty;
}

/** Fake OMP read: 50 KiB head + footer, or range slices. */
function fakeOmpRead(full: string, maxBytes = 50 * 1024) {
  const lines = full.split("\n");
  return (path: string): string => {
    const m = path.match(/^agent:\/\/([^:]+)(?::(\d+)(?:-(\d+))?)?$/);
    if (!m) throw new Error(`bad path ${path}`);
    const start = m[2] ? Number(m[2]) : undefined;
    const end = m[3] ? Number(m[3]) : start;

    if (start != null && end != null) {
      if (start > lines.length) {
        return `Line ${start} is beyond end of resource (${lines.length} lines total).`;
      }
      const slice = lines.slice(start - 1, end).join("\n");
      if (end < lines.length) {
        return (
          slice +
          `\n\n[${lines.length - end} more lines in resource. Use :${end + 1} to continue]`
        );
      }
      return slice;
    }

    // Full read: line-aware head under maxBytes (simplified)
    let acc = 0;
    let lastLine = 0;
    for (let i = 0; i < lines.length; i++) {
      const add = (i > 0 ? 1 : 0) + Buffer.byteLength(lines[i], "utf8");
      if (acc + add > maxBytes) break;
      acc += add;
      lastLine = i + 1;
    }
    if (lastLine >= lines.length) return full;
    const head = lines.slice(0, lastLine).join("\n");
    return (
      head +
      `\n\n[Showing lines 1-${lastLine} of ${lines.length}. Use :${lastLine + 1} to continue]`
    );
  };
}

describe("agent-output helpers", () => {
  test("normalizeAgentOutputId strips scheme, range, field path", () => {
    expect(normalizeAgentOutputId("RedesignPlanRevision1")).toBe(
      "RedesignPlanRevision1",
    );
    expect(normalizeAgentOutputId("agent://RedesignPlanRevision1")).toBe(
      "RedesignPlanRevision1",
    );
    expect(normalizeAgentOutputId("agent://RedesignPlanRevision1:10-20")).toBe(
      "RedesignPlanRevision1",
    );
    expect(normalizeAgentOutputId("agent://RedesignPlanRevision1/design")).toBe(
      "RedesignPlanRevision1",
    );
  });

  test("agentUri builds range paths", () => {
    expect(agentUri("Foo")).toBe("agent://Foo");
    expect(agentUri("agent://Foo", 1, 200)).toBe("agent://Foo:1-200");
  });

  test("stripTruncationFooter parses Showing lines form", () => {
    const raw =
      '{\n  "a": 1\n}\n\n[Showing lines 1-418 of 545. Use :419 to continue]';
    const { body, info } = stripTruncationFooter(raw);
    expect(body).toBe('{\n  "a": 1\n}');
    expect(info.truncated).toBe(true);
    expect(info.nextStartLine).toBe(419);
    expect(info.totalLines).toBe(545);
  });

  test("stripTruncationFooter parses N more lines form", () => {
    const raw =
      '        "E1"\n\n[102 more lines in resource. Use :444 to continue]';
    const { body, info } = stripTruncationFooter(raw);
    expect(body).toBe('        "E1"');
    expect(info.truncated).toBe(true);
    expect(info.nextStartLine).toBe(444);
  });

  test("looksLikeIncompleteJson", () => {
    expect(looksLikeIncompleteJson('{"a":1}')).toBe(false);
    expect(looksLikeIncompleteJson('{"a":')).toBe(true);
    expect(looksLikeIncompleteJson("not json")).toBe(false);
  });

  test("readAgentTextFull uses filePath when provided", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-out-"));
    const path = join(dir, "Plan.md");
    writeFileSync(path, '{"ok":true}');
    const text = readAgentTextFull(
      "Plan",
      () => {
        throw new Error("agent:// should not be used");
      },
      { filePath: path },
    );
    expect(text).toBe('{"ok":true}');
  });

  test("readAgentTextFull returns small agent:// body unchanged", () => {
    const small = '{\n  "issue_id": "x",\n  "ok": true\n}';
    const text = readAgentTextFull("Small", () => small);
    expect(text).toBe(small);
  });

  test("readAgentJsonFull reassembles past 50 KiB head truncation", () => {
    const full = makeLargePlan();
    expect(Buffer.byteLength(full, "utf8")).toBeGreaterThan(50 * 1024);
    // Sanity: truncated single read is not valid JSON
    const single = fakeOmpRead(full)("agent://BigPlan");
    expect(() => JSON.parse(stripTruncationFooter(single).body)).toThrow();

    const parsed = readAgentJsonFull("BigPlan", fakeOmpRead(full)) as {
      issue_id: string;
      task_dependency_table: unknown[];
    };
    expect(parsed.issue_id).toBe("dotfiles-test.1");
    expect(parsed.task_dependency_table.length).toBe(80);
    // Round-trip equality of structure
    expect(parsed).toEqual(JSON.parse(full));
  });

  test("readAgentTextByRanges joins all ranges", () => {
    const full = makeLargePlan();
    const text = readAgentTextByRanges("P", fakeOmpRead(full), {
      chunkLines: 50,
    });
    expect(JSON.parse(text)).toEqual(JSON.parse(full));
  });

  test("forceSplit ignores incomplete first read without footer", () => {
    const full = makeLargePlan();
    const lines = full.split("\n");
    // Silent truncation: host returns head only, no footer
    const head = lines.slice(0, 100).join("\n");
    const read = (path: string) => {
      if (path === "agent://Silent") return head;
      return fakeOmpRead(full)(path);
    };
    const parsed = readAgentJsonFull("Silent", read, { forceSplit: true }) as {
      issue_id: string;
    };
    expect(parsed.issue_id).toBe("dotfiles-test.1");
  });
});
