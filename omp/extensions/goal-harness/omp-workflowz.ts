/**
 * Live Workflowz adapter: each advancing agent call is an ephemeral
 * pi.createAgentSession with explicit model + strict outputSchema.
 * Parent session model is never inherited.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  unwrapAgentSession,
  type ActivePiApi,
  type AgentSession,
} from "./lane-runner";
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
      const created = await opts.pi.createAgentSession({
        cwd: opts.cwd,
        model: options.model,
        thinkingLevel: options.effort ?? "high",
        sessionManager,
        outputSchema: options.outputSchema,
        outputSchemaMode: "strict",
        requireYieldTool: true,
        enableLsp: false,
        systemPrompt,
        // Do NOT pass a plain object as `settings`. OMP's createAgentSession
        // calls initializeWithSettings(settings) which requires Settings.get().
        // A bare `{ memory, todo, autolearn }` crashes:
        //   "_K6.get is not a function ... disabledProviders"
        // Child sessions inherit Settings.init({ cwd }) → agent config.yml
        // (memory.backend off, todo/autolearn disabled in our profile).
      });
      // Official SDK: createAgentSession → { session, ... } (not bare session).
      const session: AgentSession = unwrapAgentSession(created);

      try {
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
      } finally {
        try {
          await session.dispose?.();
        } catch {
          /* best-effort cleanup */
        }
      }
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
