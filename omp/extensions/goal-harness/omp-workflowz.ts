/**
 * Live Workflowz adapter: each advancing agent call is an ephemeral
 * pi.createAgentSession with explicit model + strict outputSchema.
 * Parent session model is never inherited.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActivePiApi, AgentSession } from "./lane-runner";
import type { Workflowz, AgentOptions } from "./workflow-adapter";

export type OmpWorkflowzOpts = {
  cwd: string;
  pi: ActivePiApi;
  /** Directory containing `{agentName}.md` role prompts. */
  agentsDir?: string;
  /** Optional capture hook for tests / diagnostics. */
  onSessionCreate?: (opts: {
    agentName: string;
    model: string;
    effort?: string;
  }) => void;
};

function defaultAgentsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../agents");
}

/** Load omp/agents/{name}.md — fail closed if missing. */
export function loadAgentRolePrompt(
  agentName: string,
  agentsDir = defaultAgentsDir(),
): string {
  const path = join(agentsDir, `${agentName}.md`);
  if (!existsSync(path)) {
    throw new Error(`omp-workflowz: missing agent role ${path}`);
  }
  return readFileSync(path, "utf8");
}

/**
 * Build Workflowz that routes wz.agent → createAgentSession(model from options).
 */
export function createWorkflowzFromPi(opts: OmpWorkflowzOpts): Workflowz {
  const agentsDir = opts.agentsDir ?? defaultAgentsDir();

  return {
    phase(_title: string) {
      /* phase markers are controller-side only */
    },

    async agent(prompt: string, options: AgentOptions): Promise<unknown> {
      if (!options.agentName || !options.model) {
        throw new Error("omp-workflowz: agentName and model required");
      }
      if (options.schemaMode !== "strict" || options.outputSchema == null) {
        throw new Error("omp-workflowz: strict outputSchema required");
      }

      opts.onSessionCreate?.({
        agentName: options.agentName,
        model: options.model,
        effort: options.effort,
      });

      const systemPrompt = loadAgentRolePrompt(options.agentName, agentsDir);
      const sessionManager = opts.pi.SessionManager.inMemory();
      const session: AgentSession = await opts.pi.createAgentSession({
        cwd: opts.cwd,
        model: options.model,
        thinkingLevel: options.effort ?? "high",
        sessionManager,
        outputSchema: options.outputSchema,
        outputSchemaMode: "strict",
        requireYieldTool: true,
        enableLsp: false,
        systemPrompt,
        settings: {
          memory: false,
          todo: false,
          autolearn: false,
        },
      });

      await session.prompt(prompt);
      const raw = session.getOutput
        ? await session.getOutput()
        : await session.prompt("__yield_structured__");

      if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(
          `omp-workflowz: agent ${options.agentName} returned non-object (prose fallback forbidden)`,
        );
      }
      return raw;
    },

    async parallel<T>(jobs: Array<() => Promise<T>>): Promise<T[]> {
      return Promise.all(jobs.map((j) => j()));
    },

    async pipeline<T>(
      items: T[],
      ...stages: Array<(item: T) => Promise<T>>
    ): Promise<T[]> {
      let cur = items;
      for (const stage of stages) {
        cur = await Promise.all(cur.map((item) => stage(item)));
      }
      return cur;
    },
  };
}
