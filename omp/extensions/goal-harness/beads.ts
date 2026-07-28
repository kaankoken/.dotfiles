/**
 * Narrow Beads broker for the OMP goal harness.
 * No generic "run arbitrary bd args" — only issue-scoped controller methods.
 */

import {
  PHASE_ORDER,
  type PhaseName,
  type RunState,
  type SkillAttestation,
  type TaskRecord,
  assertPhaseOrder,
  emptyRunState,
} from "./run-state";
import {
  BeadsWorkspaceError,
  assertBeadsWorkspaceMatchesRoot,
  beadsIssuePrefixForRoot,
} from "./beads-workspace";

export type BdExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type BdExec = (
  args: string[],
  opts?: { cwd?: string; json?: boolean },
) => BdExecResult | Promise<BdExecResult>;

export type BrokerMode = "controller" | "child-readonly";

export type CreateRunEpicInput = {
  runId: string;
  boundGoal: string;
  modelRoutes: Record<string, unknown>;
  skillManifest: SkillAttestation[];
  title?: string;
};

export class BeadsBrokerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BeadsBrokerError";
  }
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new BeadsBrokerError(`invalid JSON from bd: ${stdout.slice(0, 200)}`);
  }
}

function requireOk(res: BdExecResult, what: string): void {
  if (res.exitCode !== 0) {
    throw new BeadsBrokerError(
      `${what} failed (exit ${res.exitCode}): ${res.stderr || res.stdout}`,
    );
  }
}

/**
 * Controller broker: mutates durable run graph via bd.
 * Child-readonly: only inspect; write methods throw.
 */
export class BeadsBroker {
  private state: RunState | null = null;
  private seq = 0;

  constructor(
    private readonly exec: BdExec,
    private readonly mode: BrokerMode,
    private readonly repoCwd: string,
  ) {}

  getRunState(): RunState | null {
    return this.state ? structuredClone(this.state) : null;
  }

  /** For tests / restore after process restart (controller only). */
  hydrate(state: RunState): void {
    this.assertController();
    this.state = structuredClone(state);
  }

  private assertController(): void {
    if (this.mode !== "controller") {
      throw new BeadsBrokerError(
        "child has read-only bd access; cannot mutate harness state",
      );
    }
  }

  private assertRun(runId: string): RunState {
    if (!this.state || this.state.runId !== runId) {
      throw new BeadsBrokerError(
        `run/issue scope mismatch: expected run ${runId}, have ${this.state?.runId ?? "none"}`,
      );
    }
    return this.state;
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private async bd(
    args: string[],
    json = false,
  ): Promise<BdExecResult> {
    const full = ["-C", this.repoCwd, ...args];
    if (json && !args.includes("--json")) full.push("--json");
    return await this.exec(full, { cwd: this.repoCwd, json });
  }

  /**
   * Fail-closed beads preflight. Does **not** run `bd init` (bare or otherwise).
   * Harness must never create a workspace mid-run — use /init → project-init
   * (safe prefix init) first.
   */
  async ensureWorkspace(): Promise<{ where: string; prefix: string }> {
    const res = await this.bd(["where"]);
    if (res.exitCode !== 0 || !res.stdout.trim()) {
      const expected = beadsIssuePrefixForRoot(this.repoCwd);
      throw new BeadsBrokerError(
        "bd where missing — stop before durable work. " +
          "Do not bare-init from /harness. Run /init (project-init) or: " +
          `bd init --prefix ${expected} --non-interactive --skip-agents`,
      );
    }
    try {
      const info = assertBeadsWorkspaceMatchesRoot(res.stdout, this.repoCwd);
      return { where: info.raw, prefix: info.prefix };
    } catch (e) {
      if (e instanceof BeadsWorkspaceError) {
        throw new BeadsBrokerError(e.message);
      }
      throw e;
    }
  }

  async createRunEpic(input: CreateRunEpicInput): Promise<RunState> {
    this.assertController();
    await this.ensureWorkspace();

    const title =
      input.title ?? `Harness run ${input.runId}: ${input.boundGoal.slice(0, 60)}`;
    const res = await this.bd(
      [
        "create",
        title,
        "--type=epic",
        "--priority=1",
        `--description=boundGoal=${JSON.stringify(input.boundGoal)}`,
        "--json",
      ],
      true,
    );
    requireOk(res, "createRunEpic");
    let epicId = this.nextId("epic");
    try {
      const parsed = parseJson(res.stdout) as { id?: string };
      if (parsed?.id) epicId = parsed.id;
    } catch {
      // fake bd may return plain id line
      const line = res.stdout.trim().split("\n").pop() ?? "";
      if (line) epicId = line.replace(/^id=/, "");
    }

    this.state = emptyRunState(input.runId, input.boundGoal);
    this.state.epicId = epicId;
    this.state.modelRoutes = input.modelRoutes;
    this.state.skillManifest = input.skillManifest;
    this.state.phase = "Research";
    return structuredClone(this.state);
  }

  async createPhaseIssues(runId: string): Promise<RunState> {
    this.assertController();
    const state = this.assertRun(runId);
    for (const phase of PHASE_ORDER) {
      if (state.phases[phase]?.issueId) continue;
      const res = await this.bd(
        [
          "create",
          `${phase} — ${runId}`,
          "--type=task",
          `--parent=${state.epicId}`,
          "--json",
        ],
        true,
      );
      requireOk(res, `createPhaseIssues ${phase}`);
      let issueId = this.nextId(phase.toLowerCase());
      try {
        const parsed = parseJson(res.stdout) as { id?: string };
        if (parsed?.id) issueId = parsed.id;
      } catch {
        const line = res.stdout.trim();
        if (line) issueId = line;
      }
      state.phases[phase] = { issueId, status: "open" };
    }
    return structuredClone(state);
  }

  async recordSkillAttestation(
    runId: string,
    skills: SkillAttestation[],
  ): Promise<RunState> {
    this.assertController();
    const state = this.assertRun(runId);
    state.skillManifest = skills;
    const res = await this.bd([
      "update",
      state.epicId,
      "--append-notes",
      `skills=${JSON.stringify(skills)}`,
    ]);
    requireOk(res, "recordSkillAttestation");
    return structuredClone(state);
  }

  async recordResearch(
    runId: string,
    artifact: { sources: string[]; synthesis: string },
  ): Promise<RunState> {
    this.assertController();
    const state = this.assertRun(runId);
    const phase = state.phases.Research;
    if (!phase) throw new BeadsBrokerError("Research phase issue missing");
    phase.status = "done";
    phase.artifact = artifact;
    state.phase = "Spec";
    const res = await this.bd([
      "update",
      phase.issueId,
      "--append-notes",
      `research=${JSON.stringify(artifact)}`,
    ]);
    requireOk(res, "recordResearch");
    const close = await this.bd(["close", phase.issueId, "--reason=research done"]);
    requireOk(close, "close Research");
    return structuredClone(state);
  }

  async recordHumanSpecApproval(
    runId: string,
    approval: { approvedAt: string; approver: string },
  ): Promise<RunState> {
    this.assertController();
    const state = this.assertRun(runId);
    assertPhaseOrder(state, "Spec");
    // Spec phase can complete after human approval
    if (!state.phases.Research || state.phases.Research.status !== "done") {
      throw new BeadsBrokerError("Spec approval requires Research done");
    }
    state.humanSpecApproval = approval;
    const phase = state.phases.Spec!;
    phase.status = "done";
    phase.artifact = approval;
    state.phase = "Plan";
    const res = await this.bd([
      "update",
      phase.issueId,
      "--append-notes",
      `humanSpecApproval=${JSON.stringify(approval)}`,
    ]);
    requireOk(res, "recordHumanSpecApproval");
    requireOk(
      await this.bd(["close", phase.issueId, "--reason=spec approved"]),
      "close Spec",
    );
    return structuredClone(state);
  }

  async recordPlan(runId: string, plan: unknown): Promise<RunState> {
    this.assertController();
    const state = this.assertRun(runId);
    if (!state.humanSpecApproval) {
      throw new BeadsBrokerError("Plan requires explicit human Spec approval");
    }
    assertPhaseOrder(state, "Plan");
    const phase = state.phases.Plan!;
    phase.status = "done";
    phase.artifact = plan;
    state.phase = "BiteSize";
    requireOk(
      await this.bd([
        "update",
        phase.issueId,
        "--append-notes",
        `plan=${JSON.stringify(plan)}`,
      ]),
      "recordPlan",
    );
    requireOk(
      await this.bd(["close", phase.issueId, "--reason=plan recorded"]),
      "close Plan",
    );
    return structuredClone(state);
  }

  async publishBiteSizedGraph(
    runId: string,
    tasks: Array<{ title: string; dependsOn?: string[] }>,
  ): Promise<RunState> {
    this.assertController();
    const state = this.assertRun(runId);
    assertPhaseOrder(state, "BiteSize");
    const phase = state.phases.BiteSize!;
    const created: TaskRecord[] = [];
    for (const t of tasks) {
      const res = await this.bd(
        [
          "create",
          t.title,
          "--type=task",
          `--parent=${state.epicId}`,
          "--json",
        ],
        true,
      );
      requireOk(res, "publishBiteSizedGraph create");
      let issueId = this.nextId("task");
      try {
        const parsed = parseJson(res.stdout) as { id?: string };
        if (parsed?.id) issueId = parsed.id;
      } catch {
        if (res.stdout.trim()) issueId = res.stdout.trim();
      }
      created.push({
        issueId,
        title: t.title,
        dependsOn: t.dependsOn ?? [],
        status: "open",
      });
    }
    state.tasks = created;
    phase.status = "done";
    phase.artifact = { tasks: created };
    state.phase = "Implement";
    requireOk(
      await this.bd(["close", phase.issueId, "--reason=bitesize published"]),
      "close BiteSize",
    );
    return structuredClone(state);
  }

  async claimTask(
    runId: string,
    issueId: string,
    claimant: string,
  ): Promise<RunState> {
    this.assertController();
    const state = this.assertRun(runId);
    const task = state.tasks.find((t) => t.issueId === issueId);
    if (!task) throw new BeadsBrokerError(`unknown task ${issueId}`);
    if (task.status === "claimed" && task.claimedBy !== claimant) {
      throw new BeadsBrokerError(`task ${issueId} already claimed`);
    }
    // dependency check
    for (const dep of task.dependsOn) {
      const d = state.tasks.find((t) => t.issueId === dep);
      if (!d || d.status !== "closed" && d.status !== "integrated") {
        throw new BeadsBrokerError(`task ${issueId} blocked by ${dep}`);
      }
    }
    const res = await this.bd(["update", issueId, "--claim"]);
    requireOk(res, "claimTask");
    task.status = "claimed";
    task.claimedBy = claimant;
    return structuredClone(state);
  }

  async recordLane(
    runId: string,
    issueId: string,
    laneId: string,
  ): Promise<RunState> {
    this.assertController();
    const state = this.assertRun(runId);
    const task = state.tasks.find((t) => t.issueId === issueId);
    if (!task || task.status !== "claimed") {
      throw new BeadsBrokerError(`recordLane requires claimed task ${issueId}`);
    }
    task.laneId = laneId;
    requireOk(
      await this.bd([
        "update",
        issueId,
        "--append-notes",
        `laneId=${laneId}`,
      ]),
      "recordLane",
    );
    return structuredClone(state);
  }

  async recordReview(
    runId: string,
    issueId: string,
    review: { ok: boolean; feedback: string; blocking: string[] },
  ): Promise<RunState> {
    this.assertController();
    const state = this.assertRun(runId);
    const task = state.tasks.find((t) => t.issueId === issueId);
    if (!task) throw new BeadsBrokerError(`unknown task ${issueId}`);
    if (!task.red || !task.green) {
      throw new BeadsBrokerError("review requires RED and GREEN evidence first");
    }
    task.review = review;
    if (!review.ok) {
      task.status = "blocked";
      requireOk(
        await this.bd([
          "update",
          issueId,
          "--append-notes",
          `reviewFAIL=${JSON.stringify(review)}`,
        ]),
        "recordReview fail",
      );
    } else {
      requireOk(
        await this.bd([
          "update",
          issueId,
          "--append-notes",
          `reviewPASS=${JSON.stringify(review)}`,
        ]),
        "recordReview pass",
      );
    }
    return structuredClone(state);
  }

  async recordIntegration(
    runId: string,
    issueId: string,
    mapping: { sourceSha: string; integratedSha: string },
  ): Promise<RunState> {
    this.assertController();
    const state = this.assertRun(runId);
    const task = state.tasks.find((t) => t.issueId === issueId);
    if (!task) throw new BeadsBrokerError(`unknown task ${issueId}`);
    if (!task.review || !(task.review as { ok?: boolean }).ok) {
      throw new BeadsBrokerError("integration requires passing review");
    }
    state.integrations.push({
      issueId,
      sourceSha: mapping.sourceSha,
      integratedSha: mapping.integratedSha,
      at: new Date().toISOString(),
    });
    task.status = "integrated";
    requireOk(
      await this.bd([
        "update",
        issueId,
        "--append-notes",
        `integrated=${JSON.stringify(mapping)}`,
      ]),
      "recordIntegration",
    );
    return structuredClone(state);
  }

  async closeIntegratedTask(runId: string, issueId: string): Promise<RunState> {
    this.assertController();
    const state = this.assertRun(runId);
    const task = state.tasks.find((t) => t.issueId === issueId);
    if (!task || task.status !== "integrated") {
      throw new BeadsBrokerError(`close requires integrated task ${issueId}`);
    }
    requireOk(
      await this.bd(["close", issueId, "--reason=integrated"]),
      "closeIntegratedTask",
    );
    task.status = "closed";
    return structuredClone(state);
  }

  async recordMilestone(
    runId: string,
    evidence: { commands: string[]; ok: boolean },
  ): Promise<RunState> {
    this.assertController();
    const state = this.assertRun(runId);
    // all tasks closed/integrated
    for (const t of state.tasks) {
      if (t.status !== "closed" && t.status !== "integrated") {
        throw new BeadsBrokerError(`milestone blocked by task ${t.issueId}`);
      }
    }
    if (!evidence.ok || !evidence.commands.length) {
      throw new BeadsBrokerError("milestone requires fresh verification evidence");
    }
    // All implement tasks closed → advance Implement/Integration phases
    for (const p of ["Implement", "Integration"] as const) {
      if (state.phases[p]) state.phases[p]!.status = "done";
      else state.phases[p] = { issueId: this.nextId(p), status: "done" };
    }
    assertPhaseOrder(state, "Milestone");
    const phase = state.phases.Milestone!;
    phase.status = "done";
    phase.artifact = evidence;
    state.milestone = {
      verifiedAt: new Date().toISOString(),
      evidence,
    };
    state.phase = "PR";
    requireOk(
      await this.bd([
        "update",
        phase.issueId,
        "--append-notes",
        `milestone=${JSON.stringify(evidence)}`,
      ]),
      "recordMilestone",
    );
    requireOk(
      await this.bd(["close", phase.issueId, "--reason=milestone pass"]),
      "close Milestone",
    );
    return structuredClone(state);
  }

  async recordPr(runId: string, prUrl: string): Promise<RunState> {
    this.assertController();
    const state = this.assertRun(runId);
    if (!state.milestone) {
      throw new BeadsBrokerError("PR requires milestone evidence");
    }
    if (!prUrl.startsWith("http")) {
      throw new BeadsBrokerError("invalid PR URL");
    }
    const phase = state.phases.PR!;
    phase.status = "done";
    state.prUrl = prUrl;
    state.phase = "Done";
    requireOk(
      await this.bd([
        "update",
        state.epicId,
        "--append-notes",
        `prUrl=${prUrl}`,
      ]),
      "recordPr",
    );
    requireOk(
      await this.bd(["close", phase.issueId, "--reason=pr opened"]),
      "close PR phase",
    );
    return structuredClone(state);
  }

  async blockIssue(
    runId: string,
    issueId: string,
    reason: string,
  ): Promise<RunState> {
    this.assertController();
    const state = this.assertRun(runId);
    const task = state.tasks.find((t) => t.issueId === issueId);
    if (task) task.status = "blocked";
    requireOk(
      await this.bd(["update", issueId, "--append-notes", `blocked=${reason}`]),
      "blockIssue",
    );
    return structuredClone(state);
  }

  /** Attach RED/GREEN evidence on a claimed task (controller). */
  async recordEvidence(
    runId: string,
    issueId: string,
    kind: "red" | "green",
    evidence: unknown,
  ): Promise<RunState> {
    this.assertController();
    const state = this.assertRun(runId);
    const task = state.tasks.find((t) => t.issueId === issueId);
    if (!task || task.status !== "claimed") {
      throw new BeadsBrokerError(`evidence requires claimed task ${issueId}`);
    }
    if (kind === "red") task.red = evidence;
    else task.green = evidence;
    requireOk(
      await this.bd([
        "update",
        issueId,
        "--append-notes",
        `${kind}=${JSON.stringify(evidence)}`,
      ]),
      `recordEvidence ${kind}`,
    );
    return structuredClone(state);
  }

  /** Child read-only helper: list state, no writes. */
  readPhase(runId: string, phase: PhaseName): PhaseRecordView | null {
    if (!this.state || this.state.runId !== runId) return null;
    if (phase === "Done") return null;
    const rec = this.state.phases[phase as (typeof PHASE_ORDER)[number]];
    return rec ? { ...rec } : null;
  }
}

type PhaseRecordView = {
  issueId: string;
  status: string;
  artifact?: unknown;
};

/** Create a child-readonly broker sharing state snapshot (no exec writes). */
export function childReadonlyBroker(
  state: RunState,
  exec: BdExec,
  repoCwd: string,
): BeadsBroker {
  const b = new BeadsBroker(exec, "child-readonly", repoCwd);
  // hydrate without controller check via cast
  (b as unknown as { state: RunState }).state = structuredClone(state);
  return b;
}
