/**
 * Research phase: parallel scout fan-out + synthesis before Spec.
 */

import {
  createStrictAgentCall,
  type Workflowz,
} from "../extensions/goal-harness/workflow-adapter";

export type ResearchScope = "small" | "large";

export type ResearchInput = {
  boundGoal: string;
  scope: ResearchScope;
  escalateBrowse: boolean;
  escalateBrowserUse: boolean;
  escalateWebwright: boolean;
  /** Goal rule 5: always latest deps — targeted version research. */
  goalRule5VersionCheck: boolean;
};

export type ResearchJob = {
  agentName: string;
  prompt: string;
  targetedVersionResearch?: boolean;
};

export type ScoutReport = {
  scout: string;
  findings: string[];
  sources: string[];
  structured: boolean;
};

export type ResearchSynthesis = {
  text: string;
  sources: string[];
  reports: ScoutReport[];
};

export type ResearchResult = {
  reports: ScoutReport[];
  synthesis: ResearchSynthesis;
};

const CORE_LARGE = [
  "code-graph-scout",
  "code-search-scout",
  "docs-scout",
  "web-scout",
  "stack-scout",
] as const;

export function planResearchJobs(input: ResearchInput): ResearchJob[] {
  const jobs: ResearchJob[] = [];

  if (input.scope === "large") {
    for (const name of CORE_LARGE) {
      jobs.push({
        agentName: name,
        prompt: `Research (large fan-out) for goal: ${input.boundGoal}`,
      });
    }
    if (input.escalateBrowse) {
      jobs.push({
        agentName: "web-browse-scout",
        prompt: `Short CDP browse for: ${input.boundGoal}`,
      });
    }
    if (input.escalateBrowserUse) {
      jobs.push({
        agentName: "browser-use-scout",
        prompt: `Multi-step browser-use for: ${input.boundGoal}`,
      });
    }
    if (input.escalateWebwright) {
      jobs.push({
        agentName: "webwright-scout",
        prompt: `Long-horizon webwright for: ${input.boundGoal}`,
      });
    }
  } else {
    // small: skip broad fan-out
    if (input.goalRule5VersionCheck) {
      jobs.push({
        agentName: "web-scout",
        prompt: `Targeted current-version research (goal rule 5) for: ${input.boundGoal}`,
        targetedVersionResearch: true,
      });
    }
    // optional single stack glance
    jobs.push({
      agentName: "stack-scout",
      prompt: `Targeted stack conventions for: ${input.boundGoal}`,
    });
  }

  return jobs;
}

export function synthesizeReports(reports: ScoutReport[]): ResearchSynthesis {
  const sources = reports.flatMap((r) => r.sources);
  const text = reports
    .map(
      (r) =>
        `## ${r.scout}\n` +
        r.findings.map((f) => `- ${f}`).join("\n") +
        `\nSources: ${r.sources.join(", ")}`,
    )
    .join("\n\n");
  return { text, sources, reports };
}

function normalizeReport(agentName: string, raw: unknown): ScoutReport {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`research: scout ${agentName} returned non-structured output`);
  }
  const o = raw as Record<string, unknown>;
  const sources = Array.isArray(o.sources)
    ? (o.sources as unknown[]).map(String)
    : [];
  const findings = Array.isArray(o.findings)
    ? (o.findings as unknown[]).map(String)
    : [JSON.stringify(o)];
  if (sources.length === 0) {
    throw new Error(`research: scout ${agentName} missing source links`);
  }
  return {
    scout: String(o.scout ?? agentName),
    findings,
    sources,
    structured: true,
  };
}

export async function runResearch(
  wz: Workflowz,
  input: ResearchInput,
  opts: { model: string; effort?: string },
): Promise<ResearchResult> {
  const jobs = planResearchJobs(input);
  wz.phase("Research");

  const reports = await wz.parallel(
    jobs.map((job) => async () => {
      const call = createStrictAgentCall({
        agentName: job.agentName,
        model: opts.model,
        effort: opts.effort ?? "medium",
        schema: {
          type: "object",
          required: ["sources"],
          additionalProperties: true,
        },
        schemaMode: "strict",
      });
      const raw = await call(wz, job.prompt);
      return normalizeReport(job.agentName, raw);
    }),
  );

  // pipeline: reports → synthesis (Spec must not see raw-only)
  const synthesis = synthesizeReports(reports);
  await wz.pipeline([{ step: "synthesize" }], async (item) => item);

  return { reports, synthesis };
}
