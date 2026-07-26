/**
 * Strict Workflowz adapter boundary for OMP goal harness.
 * Every advancing producer/reviewer call must carry agent, model, schema, schemaMode:strict.
 * No free-text recovery from malformed model output.
 */

export type SchemaMode = "strict";

export type AgentOptions = {
  agentName: string;
  model: string;
  effort?: string;
  outputSchema: unknown;
  schemaMode: SchemaMode;
};

export type Workflowz = {
  phase(title: string): void;
  agent(prompt: string, options: AgentOptions): Promise<unknown>;
  parallel<T>(jobs: Array<() => Promise<T>>): Promise<T[]>;
  pipeline<T>(
    items: T[],
    ...stages: Array<(item: T) => Promise<T>>
  ): Promise<T[]>;
};

export type StrictCallSpec = {
  agentName: string;
  model: string;
  effort?: string;
  schema: unknown;
  schemaMode: SchemaMode;
};

function assertStrictMode(mode: string): asserts mode is SchemaMode {
  if (mode !== "strict") {
    throw new Error(
      `workflow-adapter: schemaMode must be "strict" (got ${JSON.stringify(mode)})`,
    );
  }
}

/**
 * Build a gate-advancing agent call that always supplies strict options.
 * Rejects non-object results (no prose fallback).
 */
export function createStrictAgentCall(spec: StrictCallSpec) {
  assertStrictMode(spec.schemaMode);
  if (!spec.agentName || !spec.model) {
    throw new Error("workflow-adapter: agentName and model are required");
  }
  if (spec.schema == null) {
    throw new Error("workflow-adapter: output schema is required");
  }

  return async function strictCall(
    wz: Workflowz,
    prompt: string,
  ): Promise<unknown> {
    const options: AgentOptions = {
      agentName: spec.agentName,
      model: spec.model,
      effort: spec.effort,
      outputSchema: spec.schema,
      schemaMode: "strict",
    };
    const raw = await wz.agent(prompt, options);
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(
        "workflow-adapter: malformed output — expected structured object, prose fallback forbidden",
      );
    }
    return raw;
  };
}

export async function runWithAdapter(
  wz: Workflowz,
  body: (wz: Workflowz) => Promise<void>,
): Promise<void> {
  await body(wz);
}
