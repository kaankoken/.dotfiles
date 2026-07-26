/**
 * Eight-lane harness semaphore.
 * Acquire before model resolution / branch / worktree.
 * Release only after durable terminal state (integrated | blocked | failed).
 */

export const MAX_LANES = 8;

export type LaneTerminal = "integrated" | "blocked" | "failed";

export type SlotRecord = {
  issueId: string;
  acquiredAt: string;
  /** Set only after durable terminal write. */
  releasedAt?: string;
  terminal?: LaneTerminal;
};

export type QueuedIssue = {
  issueId: string;
  /** True only after acquire succeeds — gates model/branch/worktree. */
  mayResolveModel: boolean;
  mayCreateBranch: boolean;
  mayCreateWorktree: boolean;
  mayCallAgent: boolean;
};

export class SemaphoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SemaphoreError";
  }
}

/**
 * Deferred-friendly eight-slot semaphore.
 * Task nine stays purely queued until a durable release frees a slot.
 */
export class LaneSemaphore {
  private readonly active = new Map<string, SlotRecord>();
  private readonly queue: string[] = [];
  private readonly history: Array<{
    event: "acquire" | "release" | "enqueue";
    issueId: string;
    at: string;
  }> = [];

  get activeCount(): number {
    return this.active.size;
  }

  get maxLanes(): number {
    return MAX_LANES;
  }

  get queued(): readonly string[] {
    return [...this.queue];
  }

  get activeIssueIds(): string[] {
    return [...this.active.keys()];
  }

  /**
   * Try to acquire a running slot. If full, enqueue with no model/agent/branch/worktree rights.
   */
  tryAcquire(issueId: string): QueuedIssue {
    if (this.active.has(issueId)) {
      return this.granted(issueId);
    }
    if (this.active.size < MAX_LANES) {
      this.active.set(issueId, {
        issueId,
        acquiredAt: new Date().toISOString(),
      });
      this.history.push({
        event: "acquire",
        issueId,
        at: new Date().toISOString(),
      });
      // drop from queue if present
      const qi = this.queue.indexOf(issueId);
      if (qi >= 0) this.queue.splice(qi, 1);
      return this.granted(issueId);
    }
    if (!this.queue.includes(issueId)) {
      this.queue.push(issueId);
      this.history.push({
        event: "enqueue",
        issueId,
        at: new Date().toISOString(),
      });
    }
    return this.denied(issueId);
  }

  /**
   * Release only after terminal state has been durably written.
   * Starts exactly the next queued issue (FIFO) when capacity exists.
   */
  release(
    issueId: string,
    terminal: LaneTerminal,
    opts: { durableWritten: boolean },
  ): QueuedIssue | null {
    if (!opts.durableWritten) {
      throw new SemaphoreError(
        "release requires durable terminal state written first",
      );
    }
    const slot = this.active.get(issueId);
    if (!slot) {
      throw new SemaphoreError(`issue ${issueId} is not an active lane`);
    }
    slot.releasedAt = new Date().toISOString();
    slot.terminal = terminal;
    this.active.delete(issueId);
    this.history.push({
      event: "release",
      issueId,
      at: slot.releasedAt,
    });

    const nextId = this.queue.shift();
    if (!nextId) return null;
    return this.tryAcquire(nextId);
  }

  /** Whether issue may perform model/branch/worktree/agent work. */
  mayStartWork(issueId: string): boolean {
    return this.active.has(issueId);
  }

  getHistory() {
    return [...this.history];
  }

  private granted(issueId: string): QueuedIssue {
    return {
      issueId,
      mayResolveModel: true,
      mayCreateBranch: true,
      mayCreateWorktree: true,
      mayCallAgent: true,
    };
  }

  private denied(issueId: string): QueuedIssue {
    return {
      issueId,
      mayResolveModel: false,
      mayCreateBranch: false,
      mayCreateWorktree: false,
      mayCallAgent: false,
    };
  }
}
