import { describe, expect, test } from "bun:test";
import {
  type ModelCatalogEntry,
  type ModelRouterAdapter,
  type PhaseKind,
  reportProviderPreflight,
  resolveModelRoute,
  resolveReviewerModel,
} from "../extensions/goal-harness/model-router";

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
    // Prefer exact id / alias, then id/alias contains query (not the reverse —
    // reverse would make "claude-opus" steal "claude-opus-5").
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

const fullCatalog = catalog(
  entry("openai-codex/gpt-5.6-sol", ["sol", "sol 5.6", "gpt-5.6-sol"], "openai-codex"),
  entry("openai-codex/gpt-5.6-terra", ["terra", "gpt-5.6-terra", "5.6-terra"], "openai-codex"),
  entry("anthropic/claude-fable-5", ["fable", "fable 5", "claude-fable-5"], "anthropic"),
  entry("anthropic/claude-opus-4", ["opus", "claude-opus"], "anthropic"),
  entry("xai/grok-4.5", ["grok", "grok 4.5", "grok-4.5"], "xai"),
  entry("cursor/composer-2.5", ["composer", "composer 2.5"], "cursor"),
  entry("anthropic/claude-sonnet-4", ["sonnet", "claude-sonnet"], "anthropic"),
);

describe("deterministic model routing", () => {
  test("Spec/Plan/BiteSize (OpenAI demoted until 2026-08-08): Fable max → Opus → Sol", () => {
    const during = Date.parse("2026-07-31T00:00:00.000Z");
    for (const phase of ["spec", "plan", "bitesize"] as PhaseKind[]) {
      const r = resolveModelRoute(fullCatalog, phase, { nowMs: during });
      expect(r.providerModelId).toBe("anthropic/claude-fable-5");
      expect(r.effort).toBe("max");
      expect(r.degradedIndependence).toBe(false);
      expect(r.fallbackChain.map((x) => x.family)).toEqual([
        "fable",
        "opus",
        "sol",
      ]);
    }
  });

  test("Spec/Plan/BiteSize after 2026-08-08: Sol ultra primary again", () => {
    const after = Date.parse("2026-08-08T00:00:01.000Z");
    for (const phase of ["spec", "plan", "bitesize"] as PhaseKind[]) {
      const r = resolveModelRoute(fullCatalog, phase, { nowMs: after });
      expect(r.providerModelId).toBe("openai-codex/gpt-5.6-sol");
      expect(r.effort).toBe("ultra");
    }
  });

  test("Milestone (OpenAI demoted): Fable max → Opus max → Terra xhigh → Sol ultra", () => {
    const during = Date.parse("2026-07-31T00:00:00.000Z");
    const r = resolveModelRoute(fullCatalog, "milestone", { nowMs: during });
    expect(r.providerModelId).toBe("anthropic/claude-fable-5");
    expect(r.effort).toBe("max");
    expect(r.fallbackChain.map((x) => `${x.family}@${x.effort}`)).toEqual([
      "fable@max",
      "opus@max",
      "terra@xhigh",
      "sol@ultra",
    ]);
  });

  test("Milestone: no Terra → Fable max", () => {
    const noTerra = catalog(
      entry("openai-codex/gpt-5.6-terra", ["terra"], "openai-codex", false),
      entry("anthropic/claude-fable-5", ["fable", "fable 5"], "anthropic"),
      entry("openai-codex/gpt-5.6-sol", ["sol"], "openai-codex"),
      entry("anthropic/claude-opus-4", ["opus"], "anthropic"),
    );
    const r = resolveModelRoute(noTerra, "milestone");
    expect(r.providerModelId).toBe("anthropic/claude-fable-5");
    expect(r.effort).toBe("max");
  });

  test("Milestone: no Terra/Fable → Opus max (OpenAI demoted) else Sol", () => {
    const c = catalog(
      entry("openai-codex/gpt-5.6-terra", ["terra"], "openai-codex", false),
      entry("anthropic/claude-fable-5", ["fable"], "anthropic", false),
      entry("openai-codex/gpt-5.6-sol", ["sol"], "openai-codex"),
      entry("anthropic/claude-opus-4", ["opus"], "anthropic"),
    );
    const during = Date.parse("2026-07-31T00:00:00.000Z");
    const r = resolveModelRoute(c, "milestone", { nowMs: during });
    expect(r.providerModelId).toBe("anthropic/claude-opus-4");
    expect(r.effort).toBe("max");
  });

  test("big-gate first available wins: no Sol → Fable max", () => {
    const noSol = catalog(
      entry("openai-codex/gpt-5.6-sol", ["sol"], "openai-codex", false),
      entry("anthropic/claude-fable-5", ["fable", "fable 5"], "anthropic"),
      entry("anthropic/claude-opus-4", ["opus"], "anthropic"),
    );
    const r = resolveModelRoute(noSol, "spec");
    expect(r.providerModelId).toBe("anthropic/claude-fable-5");
    expect(r.effort).toBe("max");
  });

  test("big-gate no Sol/Fable → Opus", () => {
    const onlyOpus = catalog(
      entry("openai-codex/gpt-5.6-sol", ["sol"], "openai-codex", false),
      entry("anthropic/claude-fable-5", ["fable"], "anthropic", false),
      entry("anthropic/claude-opus-4", ["opus"], "anthropic"),
    );
    const r = resolveModelRoute(onlyOpus, "plan");
    expect(r.providerModelId).toBe("anthropic/claude-opus-4");
    expect(r.effort).toBe("max");
  });

  test("Implement: Grok high → Composer only if Grok unavailable → Sol high → Sonnet", () => {
    const r = resolveModelRoute(fullCatalog, "implement");
    expect(r.providerModelId).toBe("xai/grok-4.5");
    expect(r.effort).toBe("high");
  });

  test("Implement: Grok unavailable → Composer 2.5 high path", () => {
    const noGrok = catalog(
      entry("xai/grok-4.5", ["grok"], "xai", false),
      entry("cursor/composer-2.5", ["composer", "composer 2.5"], "cursor"),
      entry("openai-codex/gpt-5.6-sol", ["sol"], "openai-codex"),
      entry("anthropic/claude-sonnet-4", ["sonnet"], "anthropic"),
    );
    const r = resolveModelRoute(noGrok, "implement");
    expect(r.providerModelId).toBe("cursor/composer-2.5");
    expect(r.effort).toBe("high");
  });

  test("Implement: Grok+Composer unavailable → Sonnet (OpenAI demoted) else Sol", () => {
    const c = catalog(
      entry("xai/grok-4.5", ["grok"], "xai", false),
      entry("cursor/composer-2.5", ["composer"], "cursor", false),
      entry("openai-codex/gpt-5.6-sol", ["sol"], "openai-codex"),
      entry("anthropic/claude-sonnet-4", ["sonnet"], "anthropic"),
    );
    const during = Date.parse("2026-07-31T00:00:00.000Z");
    const r = resolveModelRoute(c, "implement", { nowMs: during });
    expect(r.providerModelId).toBe("anthropic/claude-sonnet-4");
    expect(r.effort).toBe("high");
    const after = Date.parse("2026-08-08T00:00:01.000Z");
    const r2 = resolveModelRoute(c, "implement", { nowMs: after });
    expect(r2.providerModelId).toBe("openai-codex/gpt-5.6-sol");
  });

  test("Implement: only Sonnet left", () => {
    const c = catalog(
      entry("xai/grok-4.5", ["grok"], "xai", false),
      entry("cursor/composer-2.5", ["composer"], "cursor", false),
      entry("openai-codex/gpt-5.6-sol", ["sol"], "openai-codex", false),
      entry("anthropic/claude-sonnet-4", ["sonnet"], "anthropic"),
    );
    const r = resolveModelRoute(c, "implement");
    expect(r.providerModelId).toBe("anthropic/claude-sonnet-4");
    expect(r.effort).toBe("high");
  });

  test("Composer never chosen after successful Grok", () => {
    const r = resolveModelRoute(fullCatalog, "implement");
    expect(r.providerModelId).not.toContain("composer");
    // Successful prior resolve: retry keeps Grok; no Composer
    const again = resolveModelRoute(fullCatalog, "implement", {
      priorResolved: r,
      retry: true,
    });
    expect(again.providerModelId).toBe("xai/grok-4.5");
    expect(again.providerModelId).not.toContain("composer");
  });

  test("Composer never inserted between Sol and Sonnet", () => {
    // During Sol demote window: Sonnet before Sol
    const during = Date.parse("2026-07-31T00:00:00.000Z");
    const chainDuring = resolveModelRoute(fullCatalog, "implement", {
      nowMs: during,
    });
    expect(chainDuring.fallbackChain.map((x) => x.family)).toEqual([
      "grok",
      "composer",
      "sonnet",
      "sol",
    ]);
    const after = Date.parse("2026-08-08T00:00:01.000Z");
    const chainAfter = resolveModelRoute(fullCatalog, "implement", {
      nowMs: after,
    });
    expect(chainAfter.fallbackChain.map((x) => x.family)).toEqual([
      "grok",
      "composer",
      "sol",
      "sonnet",
    ]);
    // When only Sol+Composer+Sonnet (no Grok), Composer first; Sonnet before Sol while demoted
    const noGrok = catalog(
      entry("cursor/composer-2.5", ["composer"], "cursor"),
      entry("openai-codex/gpt-5.6-sol", ["sol"], "openai-codex"),
      entry("anthropic/claude-sonnet-4", ["sonnet"], "anthropic"),
    );
    const r = resolveModelRoute(noGrok, "implement", { nowMs: during });
    expect(r.providerModelId).toBe("cursor/composer-2.5");
    const families = r.fallbackChain.map((x) => x.family);
    const solI = families.indexOf("sol");
    const sonI = families.indexOf("sonnet");
    const compI = families.indexOf("composer");
    expect(compI).toBeLessThan(sonI);
    expect(sonI).toBeLessThan(solI);
  });

  test("every Grok route resolves to high effort", () => {
    const r = resolveModelRoute(fullCatalog, "implement");
    expect(r.providerModelId).toContain("grok");
    expect(r.effort).toBe("high");
  });

  test("unavailable provider never silently changes effort", () => {
    // Spec wants ultra for Sol; if Sol missing, Fable keeps max not ultra
    const noSol = catalog(
      entry("openai-codex/gpt-5.6-sol", ["sol"], "openai-codex", false),
      entry("anthropic/claude-fable-5", ["fable"], "anthropic"),
    );
    const r = resolveModelRoute(noSol, "spec");
    expect(r.effort).toBe("max");
    expect(r.effort).not.toBe("ultra");
  });

  test("reviewer excludes producer resolved provider/model ID", () => {
    const during = Date.parse("2026-07-31T00:00:00.000Z");
    const producer = resolveModelRoute(fullCatalog, "spec", { nowMs: during });
    expect(producer.providerModelId).toBe("anthropic/claude-fable-5");
    const reviewer = resolveReviewerModel(fullCatalog, producer, during);
    expect(reviewer.providerModelId).not.toBe(producer.providerModelId);
    // Prefer next in big-gate chain (Opus)
    expect(reviewer.providerModelId).toBe("anthropic/claude-opus-4");
  });

  test("single available model uses fresh isolated instance + degradedIndependence", () => {
    const only = catalog(
      entry("openai-codex/gpt-5.6-sol", ["sol"], "openai-codex"),
    );
    const producer = resolveModelRoute(only, "spec");
    expect(producer.providerModelId).toBe("openai-codex/gpt-5.6-sol");
    const reviewer = resolveReviewerModel(only, producer);
    expect(reviewer.providerModelId).toBe(producer.providerModelId);
    expect(reviewer.degradedIndependence).toBe(true);
    expect(reviewer.isolatedInstance).toBe(true);
    expect(reviewer.instanceKey).not.toBe(producer.instanceKey);
  });

  test("retries keep the resolved model", () => {
    const first = resolveModelRoute(fullCatalog, "plan");
    const retry = resolveModelRoute(fullCatalog, "plan", {
      priorResolved: first,
      retry: true,
    });
    expect(retry.providerModelId).toBe(first.providerModelId);
    expect(retry.effort).toBe(first.effort);
    expect(retry.instanceKey).toBe(first.instanceKey);
  });

  test("mid-phase provider failure advances only that invocation when forced", () => {
    const first = resolveModelRoute(fullCatalog, "implement");
    expect(first.providerModelId).toBe("xai/grok-4.5");
    // Simulate Grok becoming unavailable mid-phase for next invocation only
    const afterGrokDown = catalog(
      entry("xai/grok-4.5", ["grok"], "xai", false),
      entry("cursor/composer-2.5", ["composer"], "cursor"),
      entry("openai-codex/gpt-5.6-sol", ["sol"], "openai-codex"),
      entry("anthropic/claude-sonnet-4", ["sonnet"], "anthropic"),
    );
    const next = resolveModelRoute(afterGrokDown, "implement", {
      priorResolved: first,
      invocationFailure: true,
    });
    expect(next.providerModelId).toBe("cursor/composer-2.5");
  });

  test("provider preflight reports routes without reading secrets", () => {
    const report = reportProviderPreflight({
      anthropicViaClaudeCode: true,
      anthropicViaOmp: true,
      codexCli: true,
      codexOauth: false,
      grokBuild: true,
      xaiApi: false,
      xaiOauth: false,
    });
    expect(report.anthropic.available).toBe(true);
    expect(report.codex.available).toBe(true);
    expect(report.grok.available).toBe(true);
    expect(report.grok.notes).toMatch(/not assumed|Grok Build|subscription/i);
    expect(JSON.stringify(report)).not.toMatch(/sk-|api[_-]?key|secret/i);
  });

  test("big-gate vocabulary prefers claude-opus-5 over generic opus", () => {
    const c = catalog(
      entry("openai-codex/gpt-5.6-sol", ["sol"], "openai-codex", false),
      entry("anthropic/claude-fable-5", ["fable"], "anthropic", false),
      entry(
        "anthropic/claude-opus-4",
        ["opus", "claude-opus"],
        "anthropic",
      ),
      entry(
        "anthropic/claude-opus-5",
        ["claude-opus-5", "opus 5", "opus", "claude-opus"],
        "anthropic",
      ),
    );
    const r = resolveModelRoute(c, "spec");
    expect(r.providerModelId).toBe("anthropic/claude-opus-5");
    expect(r.effort).toBe("max");
  });

  test("implement vocabulary prefers claude-sonnet-5 over generic sonnet", () => {
    const c = catalog(
      entry("xai/grok-4.5", ["grok"], "xai", false),
      entry("cursor/composer-2.5", ["composer"], "cursor", false),
      entry("openai-codex/gpt-5.6-sol", ["sol"], "openai-codex", false),
      entry(
        "anthropic/claude-sonnet-4",
        ["sonnet", "claude-sonnet"],
        "anthropic",
      ),
      entry(
        "anthropic/claude-sonnet-5",
        ["claude-sonnet-5", "sonnet 5", "sonnet", "claude-sonnet"],
        "anthropic",
      ),
    );
    const r = resolveModelRoute(c, "implement");
    expect(r.providerModelId).toBe("anthropic/claude-sonnet-5");
    expect(r.effort).toBe("high");
  });

  test("opus/sonnet still resolve when only generic v4 aliases exist", () => {
    const opusOnly = catalog(
      entry("openai-codex/gpt-5.6-sol", ["sol"], "openai-codex", false),
      entry("anthropic/claude-fable-5", ["fable"], "anthropic", false),
      entry("anthropic/claude-opus-4", ["opus", "claude-opus"], "anthropic"),
    );
    expect(resolveModelRoute(opusOnly, "plan").providerModelId).toBe(
      "anthropic/claude-opus-4",
    );

    const sonnetOnly = catalog(
      entry("xai/grok-4.5", ["grok"], "xai", false),
      entry("cursor/composer-2.5", ["composer"], "cursor", false),
      entry("openai-codex/gpt-5.6-sol", ["sol"], "openai-codex", false),
      entry(
        "anthropic/claude-sonnet-4",
        ["sonnet", "claude-sonnet"],
        "anthropic",
      ),
    );
    expect(resolveModelRoute(sonnetOnly, "implement").providerModelId).toBe(
      "anthropic/claude-sonnet-4",
    );
  });

  test("Research: Grok high first; OpenAI demoted → Fable then Sol", () => {
    const during = Date.parse("2026-07-31T00:00:00.000Z");
    const r = resolveModelRoute(fullCatalog, "research", { nowMs: during });
    expect(r.providerModelId).toBe("xai/grok-4.5");
    expect(r.effort).toBe("high");
    expect(r.fallbackChain.map((x) => x.family)).toEqual([
      "grok",
      "fable",
      "sol",
    ]);
    const after = Date.parse("2026-08-08T00:00:01.000Z");
    const rAfter = resolveModelRoute(fullCatalog, "research", { nowMs: after });
    expect(rAfter.fallbackChain.map((x) => x.family)).toEqual(["grok", "sol"]);
  });

  test("Research: no Grok → Fable medium (OpenAI demoted) else Sol", () => {
    const noGrok = catalog(
      entry("xai/grok-4.5", ["grok"], "xai", false),
      entry("anthropic/claude-fable-5", ["fable", "fable 5"], "anthropic"),
      entry("openai-codex/gpt-5.6-sol", ["sol", "gpt-5.6-sol"], "openai-codex"),
    );
    const during = Date.parse("2026-07-31T00:00:00.000Z");
    const r = resolveModelRoute(noGrok, "research", { nowMs: during });
    expect(r.providerModelId).toBe("anthropic/claude-fable-5");
    expect(r.effort).toBe("medium");
  });

  test("PR (OpenAI demoted): Grok high → Sonnet high → Terra xhigh", () => {
    const during = Date.parse("2026-07-31T00:00:00.000Z");
    const r = resolveModelRoute(fullCatalog, "pr", { nowMs: during });
    expect(r.providerModelId).toBe("xai/grok-4.5");
    expect(r.effort).toBe("high");
    expect(r.fallbackChain.map((x) => `${x.family}@${x.effort}`)).toEqual([
      "grok@high",
      "sonnet@high",
      "terra@xhigh",
    ]);
  });

  test("PR after window: Grok → Terra → Sonnet", () => {
    const after = Date.parse("2026-08-08T00:00:01.000Z");
    const r = resolveModelRoute(fullCatalog, "pr", { nowMs: after });
    expect(r.fallbackChain.map((x) => `${x.family}@${x.effort}`)).toEqual([
      "grok@high",
      "terra@xhigh",
      "sonnet@high",
    ]);
  });

  test("PR (OpenAI demoted): no Grok → Sonnet high (Terra last)", () => {
    const noGrok = catalog(
      entry("xai/grok-4.5", ["grok"], "xai", false),
      entry(
        "openai-codex/gpt-5.6-terra",
        ["terra", "gpt-5.6-terra"],
        "openai-codex",
      ),
      entry("anthropic/claude-sonnet-4", ["sonnet"], "anthropic"),
    );
    const during = Date.parse("2026-07-31T00:00:00.000Z");
    const r = resolveModelRoute(noGrok, "pr", { nowMs: during });
    expect(r.providerModelId).toBe("anthropic/claude-sonnet-4");
    expect(r.effort).toBe("high");
  });

  test("PR: no Grok/Terra → Sonnet high", () => {
    const onlySonnet = catalog(
      entry("xai/grok-4.5", ["grok"], "xai", false),
      entry("openai-codex/gpt-5.6-terra", ["terra"], "openai-codex", false),
      entry("anthropic/claude-sonnet-4", ["sonnet"], "anthropic"),
    );
    const r = resolveModelRoute(onlySonnet, "pr");
    expect(r.providerModelId).toBe("anthropic/claude-sonnet-4");
    expect(r.effort).toBe("high");
  });

  test("Terra family does not steal sol or generic gpt ids", () => {
    const c = catalog(
      entry("xai/grok-4.5", ["grok"], "xai", false),
      entry("openai-codex/gpt-5.6-sol", ["sol", "gpt-5.6-sol"], "openai-codex"),
      // no terra — must fall through to sonnet, not match sol as terra
      entry("anthropic/claude-sonnet-4", ["sonnet"], "anthropic"),
    );
    const r = resolveModelRoute(c, "pr");
    expect(r.providerModelId).toBe("anthropic/claude-sonnet-4");
  });

  test("design-pdr/adr (OpenAI demoted): Opus → Grok → Terra/Sol tail", () => {
    const during = Date.parse("2026-07-31T00:00:00.000Z");
    const withOpus5 = catalog(
      entry("anthropic/claude-opus-5", ["opus", "opus 5", "claude-opus-5"], "anthropic"),
      entry("openai-codex/gpt-5.6-terra", ["terra", "gpt-5.6-terra", "5.6-terra"], "openai-codex"),
      entry("openai-codex/gpt-5.6-sol", ["sol", "sol 5.6", "gpt-5.6-sol"], "openai-codex"),
      entry("xai/grok-4.5", ["grok", "grok 4.5", "grok-4.5"], "xai"),
    );
    for (const phase of ["design-pdr", "design-adr"] as PhaseKind[]) {
      const r = resolveModelRoute(withOpus5, phase, { nowMs: during });
      expect(r.providerModelId).toBe("anthropic/claude-opus-5");
      expect(r.effort).toBe("max");
      expect(r.fallbackChain.map((x) => `${x.family}@${x.effort}`)).toEqual([
        "opus@max",
        "opus@xhigh",
        "grok@high",
        "terra@max",
        "terra@xhigh",
        "sol@xhigh",
      ]);
    }
    const noOpus = catalog(
      entry("anthropic/claude-opus-5", ["opus"], "anthropic", false),
      entry("openai-codex/gpt-5.6-terra", ["terra", "gpt-5.6-terra"], "openai-codex"),
      entry("openai-codex/gpt-5.6-sol", ["sol"], "openai-codex"),
      entry("xai/grok-4.5", ["grok"], "xai"),
    );
    expect(
      resolveModelRoute(noOpus, "design-pdr", { nowMs: during }).providerModelId,
    ).toBe("xai/grok-4.5");
    expect(resolveModelRoute(noOpus, "design-pdr", { nowMs: during }).effort).toBe(
      "high",
    );
    const onlyGrok = catalog(
      entry("xai/grok-4.5", ["grok", "grok 4.5"], "xai"),
    );
    const g = resolveModelRoute(onlyGrok, "design-adr", { nowMs: during });
    expect(g.providerModelId).toBe("xai/grok-4.5");
    expect(g.effort).toBe("high");
  });

  test("design-arc42: Grok → Composer 2.5", () => {
    const r = resolveModelRoute(fullCatalog, "design-arc42");
    expect(r.providerModelId).toBe("xai/grok-4.5");
    expect(r.effort).toBe("high");
    expect(r.fallbackChain.map((x) => x.family)).toEqual(["grok", "composer"]);
    const noGrok = catalog(
      entry("xai/grok-4.5", ["grok"], "xai", false),
      entry("cursor/composer-2.5", ["composer", "composer 2.5"], "cursor"),
    );
    const c = resolveModelRoute(noGrok, "design-arc42");
    expect(c.providerModelId).toBe("cursor/composer-2.5");
    expect(c.family).toBe("composer");
  });

  test("design reviewer skips producer id on same chain", () => {
    const during = Date.parse("2026-07-31T00:00:00.000Z");
    const withOpus5 = catalog(
      entry("anthropic/claude-opus-5", ["opus", "opus 5", "claude-opus-5"], "anthropic"),
      entry("openai-codex/gpt-5.6-terra", ["terra", "gpt-5.6-terra", "5.6-terra"], "openai-codex"),
      entry("openai-codex/gpt-5.6-sol", ["sol", "sol 5.6", "gpt-5.6-sol"], "openai-codex"),
      entry("xai/grok-4.5", ["grok", "grok 4.5"], "xai"),
    );
    const producer = resolveModelRoute(withOpus5, "design-pdr", { nowMs: during });
    expect(producer.providerModelId).toBe("anthropic/claude-opus-5");
    const reviewer = resolveReviewerModel(withOpus5, producer, during);
    expect(reviewer.providerModelId).not.toBe(producer.providerModelId);
    // OpenAI window: next after Opus is Grok (not Terra)
    expect(reviewer.providerModelId).toBe("xai/grok-4.5");
    expect(reviewer.degradedIndependence).toBe(false);

    const arcProducer = resolveModelRoute(fullCatalog, "design-arc42");
    const arcReviewer = resolveReviewerModel(fullCatalog, arcProducer);
    expect(arcReviewer.providerModelId).toBe("cursor/composer-2.5");
    expect(arcReviewer.providerModelId).not.toBe(arcProducer.providerModelId);
  });

  test("non-design phases still route (smoke)", () => {
    const during = Date.parse("2026-07-31T00:00:00.000Z");
    expect(resolveModelRoute(fullCatalog, "spec", { nowMs: during }).family).toBe(
      "fable",
    );
    expect(resolveModelRoute(fullCatalog, "plan", { nowMs: during }).family).toBe(
      "fable",
    );
    expect(resolveModelRoute(fullCatalog, "implement", { nowMs: during }).family).toBe(
      "grok",
    );
    expect(resolveModelRoute(fullCatalog, "pr").family).toBe("grok");
  });
});

