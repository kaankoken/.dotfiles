import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDesignFlow } from "../extensions/design-flow/workflow";
import { DESIGN_GATE_BUDGETS } from "../extensions/design-flow/phase-machine";
import type { Workflowz } from "../extensions/goal-harness/workflow-adapter";
import type {
  ModelCatalogEntry,
  ModelRouterAdapter,
} from "../extensions/goal-harness/model-router";

type CapturedCall = {
  agentName: string;
  model: string;
  effort?: string;
};

function entry(
  id: string,
  aliases: string[],
  provider: string,
  available = true,
): ModelCatalogEntry {
  return { id, aliases, provider, available };
}

function catalog(...entries: ModelCatalogEntry[]): ModelRouterAdapter {
  const list = () => entries.filter((e) => e.available);
  const all = () => entries;
  const resolve = (query: string): ModelCatalogEntry | null => {
    const q = query.toLowerCase();
    const available = entries.filter((e) => e.available);
    for (const e of available) {
      if (e.id.toLowerCase() === q) return e;
      if (e.aliases.some((a) => a.toLowerCase() === q)) return e;
    }
    for (const e of available) {
      if (e.id.toLowerCase().includes(q)) return e;
      if (e.aliases.some((a) => a.toLowerCase().includes(q))) return e;
    }
    return null;
  };
  return { list, all, resolve };
}

function mockWz(
  handlers: Record<string, unknown>,
  capture?: CapturedCall[],
): Workflowz {
  return {
    phase() {},
    parallel: async (fns: Array<() => Promise<unknown>>) =>
      Promise.all(fns.map((f) => f())),
    agent: async (
      prompt: string,
      opts?: { agentName?: string; model?: string; effort?: string },
    ) => {
      const name = opts?.agentName ?? "";
      if (capture) {
        capture.push({
          agentName: name,
          model: opts?.model ?? "",
          effort: opts?.effort,
        });
      }
      if (name in handlers) {
        const h = handlers[name];
        return typeof h === "function"
          ? (h as (p: string) => unknown)(prompt)
          : h;
      }
      throw new Error(`unexpected agent ${name}`);
    },
  } as unknown as Workflowz;
}

const samplePdr = {
  title: "T",
  problem: "P",
  goals: ["g"],
  nonGoals: [],
  users: ["u"],
  requirements: [{ id: "R1", text: "must work", priority: "must" }],
  successMetrics: [],
  risks: [],
  openQuestions: [],
};

const sampleArc = {
  title: "A",
  introduction: "i",
  constraints: [],
  context: "c",
  solutionStrategy: "s",
  buildingBlocks: [{ name: "core", responsibility: "x" }],
  runtime: "r",
  deployment: "d",
  crosscutting: [],
  quality: [],
  risks: [],
  diagrams: [{ name: "ctx", kind: "mermaid", source: "graph TD; A-->B;" }],
};

const sampleAdrPayload = {
  adrs: [
    {
      title: "Use mermaid",
      status: "accepted",
      context: "Need diagrams in git-friendly form",
      decision: "Mermaid in ADRs/session",
      consequences: "No binary diagrams",
    },
  ],
};

const passHandlers = {
  "pdr-writer": samplePdr,
  "pdr-reviewer": { ok: true, feedback: "ok", blocking: [] },
  "arc42-writer": sampleArc,
  "arc42-reviewer": { ok: true, feedback: "ok", blocking: [] },
  "adr-writer": sampleAdrPayload,
};

const designCatalog = catalog(
  entry(
    "anthropic/claude-opus-5",
    ["opus", "opus 5", "claude-opus-5"],
    "anthropic",
  ),
  entry(
    "openai-codex/gpt-5.6-terra",
    ["terra", "gpt-5.6-terra", "5.6-terra"],
    "openai-codex",
  ),
  entry("openai-codex/gpt-5.6-sol", ["sol", "sol 5.6", "gpt-5.6-sol"], "openai-codex"),
  entry("xai/grok-4.5", ["grok", "grok 4.5", "grok-4.5"], "xai"),
  entry("cursor/composer-2.5", ["composer", "composer 2.5"], "cursor"),
);

describe("runDesignFlow", () => {
  test("PASS path writes ADRs under docs/adr only", async () => {
    const root = mkdtempSync(join(tmpdir(), "design-flow-"));
    const wz = mockWz({
      "pdr-writer": samplePdr,
      "pdr-reviewer": { ok: true, feedback: "ok", blocking: [] },
      "arc42-writer": sampleArc,
      "arc42-reviewer": { ok: true, feedback: "ok", blocking: [] },
    });
    const result = await runDesignFlow(wz, {
      boundGoal: "design a widget system",
      repoRoot: root,
      runId: "test-1",
      adrPayload: {
        adrs: [
          {
            title: "Use mermaid",
            status: "accepted",
            context: "Need diagrams in git-friendly form",
            decision: "Mermaid in ADRs/session",
            consequences: "No binary diagrams",
          },
        ],
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.snapshot.status).toBe("done");
    expect(result.handoff?.adrPaths.length).toBe(1);
    expect(result.handoff?.nextStep).toContain("/harness");
    expect(result.handoff?.note).toMatch(/Do not auto-start/);
    const adrPath = result.handoff!.adrPaths[0]!;
    expect(adrPath.includes("docs/adr/0001-use-mermaid.md")).toBe(true);
    expect(existsSync(adrPath)).toBe(true);
    expect(readFileSync(adrPath, "utf8")).toContain("## Decision");
    expect(existsSync(join(root, "docs/superpowers"))).toBe(false);
  });

  test("empty goal fails closed", async () => {
    const root = mkdtempSync(join(tmpdir(), "design-flow-"));
    const r = await runDesignFlow(mockWz({}), {
      boundGoal: "   ",
      repoRoot: root,
    });
    expect(r.handoff).toBeNull();
    expect(r.error).toMatch(/boundGoal/);
  });

  test("modelRouter resolves design-pdr/adr/arc42 + independent reviewers", async () => {
    const root = mkdtempSync(join(tmpdir(), "design-flow-"));
    const calls: CapturedCall[] = [];
    const result = await runDesignFlow(mockWz(passHandlers, calls), {
      boundGoal: "route models",
      repoRoot: root,
      runId: "route-1",
      modelRouter: designCatalog,
    });
    expect(result.error).toBeUndefined();
    expect(result.snapshot.status).toBe("done");

    const byAgent = Object.fromEntries(
      calls.map((c) => [c.agentName, c]),
    ) as Record<string, CapturedCall>;

    expect(byAgent["pdr-writer"]?.model).toBe("anthropic/claude-opus-5");
    expect(byAgent["pdr-writer"]?.effort).toBe("max");
    // OpenAI demoted: reviewer next on design-pdr chain is Grok (not Terra)
    expect(byAgent["pdr-reviewer"]?.model).toBe("xai/grok-4.5");
    expect(byAgent["pdr-reviewer"]?.model).not.toBe(
      byAgent["pdr-writer"]?.model,
    );

    expect(byAgent["arc42-writer"]?.model).toBe("xai/grok-4.5");
    expect(byAgent["arc42-reviewer"]?.model).toBe("cursor/composer-2.5");
    expect(byAgent["arc42-reviewer"]?.model).not.toBe(
      byAgent["arc42-writer"]?.model,
    );

    expect(byAgent["adr-writer"]?.model).toBe("anthropic/claude-opus-5");
    expect(byAgent["adr-writer"]?.effort).toBe("max");
  });

  test("ADR producer effort is max without modelRouter", async () => {
    const root = mkdtempSync(join(tmpdir(), "design-flow-"));
    const calls: CapturedCall[] = [];
    const result = await runDesignFlow(mockWz(passHandlers, calls), {
      boundGoal: "fallback adr effort",
      repoRoot: root,
      runId: "fallback-adr",
    });
    expect(result.error).toBeUndefined();
    const adr = calls.find((c) => c.agentName === "adr-writer");
    expect(adr?.model).toBe("anthropic/claude-opus-5");
    expect(adr?.effort).toBe("max");
  });

  test("explicit models overrides still win over modelRouter", async () => {
    const root = mkdtempSync(join(tmpdir(), "design-flow-"));
    const calls: CapturedCall[] = [];
    const result = await runDesignFlow(mockWz(passHandlers, calls), {
      boundGoal: "override models",
      repoRoot: root,
      runId: "override-1",
      modelRouter: designCatalog,
      models: {
        pdr: "custom/pdr-writer",
        pdrReviewer: "custom/pdr-reviewer",
        arc42: "custom/arc-writer",
        arc42Reviewer: "custom/arc-reviewer",
        adr: "custom/adr-writer",
      },
    });
    expect(result.error).toBeUndefined();
    const byAgent = Object.fromEntries(
      calls.map((c) => [c.agentName, c]),
    ) as Record<string, CapturedCall>;
    expect(byAgent["pdr-writer"]?.model).toBe("custom/pdr-writer");
    expect(byAgent["pdr-reviewer"]?.model).toBe("custom/pdr-reviewer");
    expect(byAgent["arc42-writer"]?.model).toBe("custom/arc-writer");
    expect(byAgent["arc42-reviewer"]?.model).toBe("custom/arc-reviewer");
    expect(byAgent["adr-writer"]?.model).toBe("custom/adr-writer");
    expect(byAgent["adr-writer"]?.effort).toBe("max");
  });

  test("controller remains sole ADR disk writer on agent ADR path", async () => {
    const root = mkdtempSync(join(tmpdir(), "design-flow-"));
    const calls: CapturedCall[] = [];
    const result = await runDesignFlow(mockWz(passHandlers, calls), {
      boundGoal: "controller writes adr",
      repoRoot: root,
      runId: "adr-disk",
      modelRouter: designCatalog,
    });
    expect(result.error).toBeUndefined();
    expect(calls.some((c) => c.agentName === "adr-writer")).toBe(true);
    const adrPath = result.handoff!.adrPaths[0]!;
    expect(adrPath.includes(`${join("docs", "adr")}`)).toBe(true);
    expect(existsSync(adrPath)).toBe(true);
    expect(existsSync(join(root, "docs/superpowers"))).toBe(false);
    expect(readFileSync(adrPath, "utf8")).toContain("## Decision");
  });

  test("persists PDR/Arc42 to bd when beadsIssue + runner provided", async () => {
    const updates: string[][] = [];
    const root = mkdtempSync(join(tmpdir(), "design-flow-"));
    const result = await runDesignFlow(mockWz(passHandlers), {
      boundGoal: "persist me",
      repoRoot: root,
      runId: "persist-1",
      beadsIssue: "dotfiles-design-test",
      bdRunner: (args) => {
        updates.push(args);
        return { status: 0, stdout: "", stderr: "" };
      },
      adrPayload: sampleAdrPayload,
    });
    expect(result.error).toBeUndefined();
    expect(result.handoff).toBeTruthy();
    expect(result.snapshot.status).toBe("done");
    expect(
      updates.some(
        (a) => a[0] === "update" && a.includes("dotfiles-design-test"),
      ),
    ).toBe(true);
    const designArg = updates
      .flat()
      .find((a) => typeof a === "string" && a.startsWith("--design="));
    expect(designArg).toBeDefined();
    const payload = JSON.parse(designArg!.slice("--design=".length));
    expect(payload.kind).toBe("design-flow-artifacts");
    expect(payload.boundGoal).toBe("persist me");
    expect(payload.pdr).toEqual(samplePdr);
    expect(payload.arc42).toEqual(sampleArc);
    expect(Array.isArray(payload.adrPaths)).toBe(true);
    expect(payload.adrPaths.length).toBe(1);
  });

  test("bd failure warns but still returns handoff when ADRs written", async () => {
    const root = mkdtempSync(join(tmpdir(), "design-flow-"));
    const result = await runDesignFlow(mockWz(passHandlers), {
      boundGoal: "bd down",
      repoRoot: root,
      runId: "persist-fail",
      beadsIssue: "x",
      bdRunner: () => {
        throw new Error("bd missing");
      },
      adrPayload: sampleAdrPayload,
    });
    expect(result.handoff).toBeTruthy();
    expect(result.snapshot.status).toBe("done");
    expect(result.error).toBeUndefined();
    expect(result.handoff?.note).toMatch(/Do not auto-start/);
    expect(result.warnings?.some((w) => /bd/i.test(w))).toBe(true);
    expect(existsSync(result.handoff!.adrPaths[0]!)).toBe(true);
  });

  test("skips bd when beadsIssue absent", async () => {
    const updates: string[][] = [];
    const root = mkdtempSync(join(tmpdir(), "design-flow-"));
    const result = await runDesignFlow(mockWz(passHandlers), {
      boundGoal: "no issue",
      repoRoot: root,
      runId: "persist-skip",
      bdRunner: (args) => {
        updates.push(args);
        return { status: 0, stdout: "", stderr: "" };
      },
      adrPayload: sampleAdrPayload,
    });
    expect(result.error).toBeUndefined();
    expect(result.handoff).toBeTruthy();
    expect(updates.length).toBe(0);
  });

  test("exhausted Pdr reviewer → snapshot.status failed, gateAttempts=budget", async () => {
    const root = mkdtempSync(join(tmpdir(), "design-flow-"));
    let reviews = 0;
    const result = await runDesignFlow(
      mockWz({
        "pdr-writer": samplePdr,
        "pdr-reviewer": () => {
          reviews++;
          return {
            ok: false,
            feedback: `pdr fail ${reviews}`,
            blocking: [`block ${reviews}`],
          };
        },
      }),
      {
        boundGoal: "exhaust pdr gate",
        repoRoot: root,
        runId: "exhaust-pdr",
      },
    );
    expect(result.handoff).toBeNull();
    expect(result.snapshot.status).toBe("failed");
    expect(result.snapshot.gateAttempts.Pdr).toBe(DESIGN_GATE_BUDGETS.Pdr);
    expect(result.error).toMatch(/Pdr failed after 2/);
    expect(reviews).toBe(DESIGN_GATE_BUDGETS.Pdr);
  });
});
