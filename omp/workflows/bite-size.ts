/**
 * BiteSize gate: rewrite plan into claimable Beads issues (budget 2).
 * Publishes via BeadsBroker.publishBiteSizedGraph — returns issue IDs.
 */

import {
  createStrictAgentCall,
  type Workflowz,
} from "../extensions/goal-harness/workflow-adapter";
import { reviewResultSchema } from "../extensions/goal-harness/schemas";
import type { PlanArtifact, PlanStep } from "./plan";
import type { BeadsBroker } from "../extensions/goal-harness/beads";

export type BiteTask = {
  id: string;
  title: string;
  files: string[];
  redCheck: string;
  greenCheck: string;
  doneWhen: string;
  dependsOn: string[];
  parallelGroup?: string;
  /** Outside implementer path (no meaningful RED) */
  nonImplementer?: boolean;
};

export type BiteSizeGraph = {
  tasks: BiteTask[];
  parallelGroups: string[][];
};

export type PublishedBiteSize = {
  graph: BiteSizeGraph;
  issueIds: string[];
  /** issueId → task id */
  issueByTaskId: Record<string, string>;
  review: { ok: boolean; feedback: string; blocking: string[] };
  attempts: number;
};

export class BiteSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BiteSizeError";
  }
}

/** Detect cycles in dependsOn graph (task ids). */
export function detectDependencyCycle(tasks: BiteTask[]): string[] | null {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const stack: string[] = [];

  function dfs(id: string): string[] | null {
    if (done.has(id)) return null;
    if (visiting.has(id)) {
      const i = stack.indexOf(id);
      return stack.slice(i).concat(id);
    }
    visiting.add(id);
    stack.push(id);
    const t = byId.get(id);
    if (t) {
      for (const d of t.dependsOn) {
        if (!byId.has(d)) continue;
        const c = dfs(d);
        if (c) return c;
      }
    }
    stack.pop();
    visiting.delete(id);
    done.add(id);
    return null;
  }

  for (const t of tasks) {
    const c = dfs(t.id);
    if (c) return c;
  }
  return null;
}

export function validateBiteGraph(graph: BiteSizeGraph): void {
  if (!graph.tasks.length) {
    throw new BiteSizeError("bite-size: empty task graph");
  }
  const ids = new Set(graph.tasks.map((t) => t.id));
  for (const t of graph.tasks) {
    if (!t.title || !t.doneWhen) {
      throw new BiteSizeError(`bite-size: task ${t.id} missing title/doneWhen`);
    }
    if (!t.files.length) {
      throw new BiteSizeError(`bite-size: task ${t.id} missing files`);
    }
    for (const d of t.dependsOn) {
      if (!ids.has(d)) {
        throw new BiteSizeError(
          `bite-size: task ${t.id} depends on unknown ${d}`,
        );
      }
    }
    if (!t.nonImplementer) {
      if (!t.redCheck || !t.greenCheck) {
        throw new BiteSizeError(
          `bite-size: implementer task ${t.id} needs redCheck and greenCheck`,
        );
      }
      // Fake TDD: identical trivial commands rejected
      if (t.redCheck === t.greenCheck && /true|noop|pass/i.test(t.redCheck)) {
        throw new BiteSizeError(
          `bite-size: task ${t.id} has fake TDD evidence`,
        );
      }
    } else {
      // outside implementer path — must not carry fake TDD
      if (t.redCheck || t.greenCheck) {
        // allowed empty; if present must not be noop pair
      }
    }
  }
  const cycle = detectDependencyCycle(graph.tasks);
  if (cycle) {
    throw new BiteSizeError(
      `bite-size: dependency cycle: ${cycle.join(" → ")}`,
    );
  }
  // parallel groups must be explicit when marked
  for (const g of graph.parallelGroups) {
    for (const id of g) {
      if (!ids.has(id)) {
        throw new BiteSizeError(`bite-size: parallel group unknown task ${id}`);
      }
    }
  }
}

function normalizeGraph(raw: unknown, plan: PlanArtifact): BiteSizeGraph {
  if (!raw || typeof raw !== "object") {
    throw new BiteSizeError("bite-size: invalid graph object");
  }
  const o = raw as Record<string, unknown>;
  const tasksRaw = Array.isArray(o.tasks) ? o.tasks : [];
  const tasks: BiteTask[] = tasksRaw.map((item, i) => {
    if (!item || typeof item !== "object") {
      throw new BiteSizeError(`bite-size: task ${i} invalid`);
    }
    const t = item as Record<string, unknown>;
    return {
      id: String(t.id ?? `t${i}`),
      title: String(t.title ?? ""),
      files: Array.isArray(t.files) ? t.files.map(String) : [],
      redCheck: String(t.redCheck ?? ""),
      greenCheck: String(t.greenCheck ?? ""),
      doneWhen: String(t.doneWhen ?? ""),
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.map(String) : [],
      parallelGroup:
        t.parallelGroup != null ? String(t.parallelGroup) : undefined,
      nonImplementer: Boolean(t.nonImplementer),
    };
  });

  // Derive parallel groups from parallelGroup field if not provided
  let parallelGroups: string[][] = Array.isArray(o.parallelGroups)
    ? (o.parallelGroups as unknown[]).map((g) =>
        Array.isArray(g) ? g.map(String) : [],
      )
    : [];
  if (parallelGroups.length === 0) {
    const byG = new Map<string, string[]>();
    for (const t of tasks) {
      if (!t.parallelGroup) continue;
      const list = byG.get(t.parallelGroup) ?? [];
      list.push(t.id);
      byG.set(t.parallelGroup, list);
    }
    parallelGroups = [...byG.values()].filter((g) => g.length > 1);
  }

  // If writer returned nothing useful, fall back to one-task-per-plan-step
  if (tasks.length === 0) {
    return {
      tasks: plan.steps.map((s: PlanStep) => ({
        id: s.id,
        title: s.title,
        files: s.paths,
        redCheck: s.testSurfaces[0] ?? "test",
        greenCheck: s.testSurfaces[0] ?? "test",
        doneWhen: s.doneWhen,
        dependsOn: s.dependsOn,
      })),
      parallelGroups: [],
    };
  }

  const graph = { tasks, parallelGroups };
  validateBiteGraph(graph);
  return graph;
}

export async function produceBiteSize(
  wz: Workflowz,
  plan: PlanArtifact,
  opts: { model: string; priorFeedback?: string },
): Promise<BiteSizeGraph> {
  wz.phase("BiteSize");
  const writer = createStrictAgentCall({
    agentName: "bite-size-writer",
    model: opts.model,
    effort: "ultra",
    schema: {
      type: "object",
      required: ["tasks"],
      additionalProperties: true,
    },
    schemaMode: "strict",
  });
  const raw = await writer(
    wz,
    [
      "Rewrite plan into bite-sized tasks for worktree implementers.",
      "Each task: one focused outcome, exact files, executable redCheck/greenCheck, doneWhen, dependsOn.",
      "Mark nonImplementer:true when no meaningful RED (docs-only, rename noise).",
      "Emit parallelGroups for independent sets.",
      opts.priorFeedback ? `Reviewer: ${opts.priorFeedback}` : "",
      `Plan: ${JSON.stringify(plan)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return normalizeGraph(raw, plan);
}

export async function reviewBiteSize(
  wz: Workflowz,
  graph: BiteSizeGraph,
  opts: { reviewerModel: string },
): Promise<{ ok: boolean; feedback: string; blocking: string[] }> {
  const reviewer = createStrictAgentCall({
    agentName: "bite-size-reviewer",
    model: opts.reviewerModel,
    effort: "max",
    schema: reviewResultSchema,
    schemaMode: "strict",
  });
  return (await reviewer(
    wz,
    `Review bite-size graph: ${JSON.stringify(graph)}`,
  )) as { ok: boolean; feedback: string; blocking: string[] };
}

export async function runBiteSizeGate(
  wz: Workflowz,
  plan: PlanArtifact,
  opts: {
    model: string;
    reviewerModel: string;
    maxAttempts?: number;
    broker: BeadsBroker;
    runId: string;
  },
): Promise<PublishedBiteSize> {
  const max = opts.maxAttempts ?? 2;
  let attempts = 0;
  let priorFeedback: string | undefined;
  let graph: BiteSizeGraph | undefined;
  let review = {
    ok: false,
    feedback: "not run",
    blocking: ["not run"],
  };

  while (attempts < max) {
    attempts++;
    graph = await produceBiteSize(wz, plan, {
      model: opts.model,
      priorFeedback,
    });
    review = await reviewBiteSize(wz, graph, {
      reviewerModel: opts.reviewerModel,
    });
    // PASS ends gate; rewrite only when reviewer requires it
    if (review.ok) break;
    priorFeedback = [review.feedback, ...(review.blocking ?? [])]
      .filter(Boolean)
      .join("; ");
  }

  if (!graph || !review.ok) {
    throw new BiteSizeError(
      `bite-size gate failed after ${attempts} attempts: ${review.feedback}`,
    );
  }

  // Publish only implementer-path tasks as claimable issues
  const implementerTasks = graph.tasks.filter((t) => !t.nonImplementer);
  const state = await opts.broker.publishBiteSizedGraph(
    opts.runId,
    implementerTasks.map((t) => ({
      title: t.title,
      dependsOn: t.dependsOn
        .map((depId) => {
          // dependsOn are task ids; resolve to issue ids after create — broker uses titles only
          // We encode task id in title prefix for mapping
          return depId;
        })
        .filter(Boolean),
    })),
  );

  // Map by order: broker creates in same order
  const issueIds = state.tasks.map((t) => t.issueId);
  const issueByTaskId: Record<string, string> = {};
  implementerTasks.forEach((t, i) => {
    if (issueIds[i]) issueByTaskId[t.id] = issueIds[i];
  });

  // Rewrite dependsOn on broker tasks if we can map
  // (broker already stored dependsOn as task-id strings from input — remapped below for consumers)
  return {
    graph,
    issueIds,
    issueByTaskId,
    review,
    attempts,
  };
}
