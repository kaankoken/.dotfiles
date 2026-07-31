import { describe, expect, test, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildPhaseCapabilities,
  validatePhaseCapabilities,
  CapabilityError,
  PHASE_CAPABILITIES_SCHEMA,
  type PhaseCapabilityManifest,
} from "../extensions/goal-harness/capabilities";
import {
  classifyCommand,
  classifyPathAccess,
  resolveCanonicalPath,
  resolveWritableCachePath,
  SandboxError,
} from "../extensions/goal-harness/sandbox";
import {
  cachePathForLane,
  clearRunApprovals,
  createInterceptor,
  grantRunApproval,
  interceptToolCall,
  preflightOmpApprovalConfig,
} from "../extensions/goal-harness/audit";
import {
  preflightHarnessSandbox,
  registerSandboxToolHandler,
} from "../extensions/goal-harness/index";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) {
    try {
      rmSync(temps.pop()!, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "omp-sandbox-"));
  temps.push(d);
  return d;
}

function baseRoots(repo: string): {
  repo: string;
  worktree: string;
  runTemp: string;
  integration?: string;
  migrationTargets?: string[];
} {
  const worktree = join(repo, "lane");
  const runTemp = join(repo, "tmp");
  mkdirSync(worktree, { recursive: true });
  mkdirSync(runTemp, { recursive: true });
  return { repo, worktree, runTemp };
}

function implManifest(repo: string): PhaseCapabilityManifest {
  const roots = baseRoots(repo);
  return buildPhaseCapabilities({
    phase: "Implement",
    agent: "implementer",
    runId: "run-1",
    issueId: "iss-1",
    canonicalRoots: roots,
    controller: false,
  });
}

function publisherManifest(repo: string): PhaseCapabilityManifest {
  return buildPhaseCapabilities({
    phase: "PrReviewPublish",
    agent: "pr-review-publisher",
    runId: "run-1",
    issueId: "iss-1",
    canonicalRoots: baseRoots(repo),
  });
}

describe("phase capabilities", () => {
  test("manifest requires phase agent runId issueId roots network operations", () => {
    expect(PHASE_CAPABILITIES_SCHEMA).toBeTruthy();
    const repo = tmp();
    const m = buildPhaseCapabilities({
      phase: "Research",
      agent: "web-scout",
      runId: "r1",
      issueId: "",
      canonicalRoots: baseRoots(repo),
    });
    expect(m.phase).toBe("Research");
    expect(m.agent).toBe("web-scout");
    expect(m.runId).toBe("r1");
    expect(m.canonicalRoots.repo).toBeTruthy();
    expect(m.network.mode).toBeTruthy();
    expect(m.operations.length).toBeGreaterThan(0);
    validatePhaseCapabilities(m);
  });

  test("non-writing phases are read-only for fs writes", () => {
    const repo = tmp();
    const m = buildPhaseCapabilities({
      phase: "Spec",
      agent: "spec-writer",
      runId: "r1",
      canonicalRoots: baseRoots(repo),
      controller: true,
    });
    expect(m.operations.some((o) => o.startsWith("fs.write."))).toBe(false);
    expect(m.operations).toContain("fs.read.repo");
    expect(m.operations).toContain("bd.write.controller");
  });

  test("Implement allows lane and runTemp writes only", () => {
    const repo = tmp();
    const m = implManifest(repo);
    expect(m.operations).toContain("fs.write.lane");
    expect(m.operations).toContain("fs.write.runTemp");
    expect(m.operations).not.toContain("git.push");
    expect(m.operations).not.toContain("gh.pr");
  });

  test("Integration allows integration git/fs ops", () => {
    const repo = tmp();
    const roots = baseRoots(repo);
    roots.integration = join(repo, "integration");
    mkdirSync(roots.integration, { recursive: true });
    const m = buildPhaseCapabilities({
      phase: "Integration",
      agent: "controller",
      runId: "r1",
      canonicalRoots: roots,
      controller: true,
    });
    expect(m.operations).toContain("fs.write.integration");
    expect(m.operations).toContain("git.write.integration");
  });

  test("push/PR only during PR phase", () => {
    const repo = tmp();
    const m = buildPhaseCapabilities({
      phase: "PR",
      agent: "pr-opener",
      runId: "r1",
      canonicalRoots: baseRoots(repo),
      controller: true,
    });
    expect(m.operations).toContain("git.push");
    expect(m.operations).toContain("gh.pr");
    const early = buildPhaseCapabilities({
      phase: "Milestone",
      agent: "milestone-organizer",
      runId: "r1",
      canonicalRoots: baseRoots(tmp()),
      controller: true,
    });
    expect(early.operations).not.toContain("git.push");
  });

  test("inline review capability belongs only to its publisher context", () => {
    const repo = tmp();
    const publisher = publisherManifest(repo);
    expect(publisher.operations).toContain("gh.pr.inline-review");
    expect(PHASE_CAPABILITIES_SCHEMA.properties.phase.enum).toContain(
      "PrReviewPublish",
    );
    expect(PHASE_CAPABILITIES_SCHEMA.properties.operations.items.enum).toContain(
      "gh.pr.inline-review",
    );

    for (const phase of [
      "Init",
      "Research",
      "Spec",
      "Plan",
      "BiteSize",
      "Implement",
      "Integration",
      "Milestone",
      "PR",
    ] as const) {
      const manifest = buildPhaseCapabilities({
        phase,
        agent: "ordinary-agent",
        runId: "r1",
        canonicalRoots: baseRoots(tmp()),
      });
      expect(manifest.operations).not.toContain("gh.pr.inline-review");
    }
  });

  test("migration-target writes require explicit targets", () => {
    const repo = tmp();
    const roots = baseRoots(repo);
    roots.migrationTargets = [join(repo, "dotfiles-target")];
    mkdirSync(roots.migrationTargets[0]!, { recursive: true });
    const m = buildPhaseCapabilities({
      phase: "Implement",
      agent: "controller",
      runId: "r1",
      canonicalRoots: roots,
      migrationWrite: true,
      controller: true,
    });
    expect(m.operations).toContain("fs.write.migrationTarget");
    expect(() =>
      buildPhaseCapabilities({
        phase: "Implement",
        agent: "c",
        runId: "r1",
        canonicalRoots: baseRoots(tmp()),
        migrationWrite: true,
      }),
    ).toThrow(/migrationTargets/);
  });

  test("unknown fields and out-of-matrix ops fail validation", () => {
    const repo = tmp();
    const m = implManifest(repo);
    expect(() =>
      validatePhaseCapabilities({ ...m, extra: true }),
    ).toThrow(/unknown field/);
    expect(() =>
      validatePhaseCapabilities({
        ...m,
        operations: [...m.operations, "git.push"],
      }),
    ).toThrow(/outside phase matrix|git.push/);
  });

  test("builder is pure (no fs inspect beyond caller-provided roots)", () => {
    // no throw with nonexistent path strings — pure construction
    const m = buildPhaseCapabilities({
      phase: "Init",
      agent: "project-init",
      runId: "r",
      canonicalRoots: {
        repo: "/nonexistent/repo",
        worktree: "/nonexistent/wt",
        runTemp: "/nonexistent/tmp",
      },
      controller: true,
    });
    expect(m.phase).toBe("Init");
  });
});

describe("path and command policy", () => {
  test("denies unrelated home/system paths", () => {
    const repo = tmp();
    const m = implManifest(repo);
    const d = classifyPathAccess(m, "/etc/passwd", "read");
    expect(d.allow).toBe(false);
    expect(d.reason).toMatch(/unrelated|denied/);
  });

  test("denies SSH/GPG/cloud/browser/OMP credential paths", () => {
    const repo = tmp();
    const m = implManifest(repo);
    for (const p of [
      join(repo, ".ssh/id_rsa"),
      "/Users/x/.aws/credentials",
      "/tmp/.omp/agent/auth.json",
    ]) {
      // put .ssh under repo still denied by marker
      if (p.includes(".ssh")) {
        mkdirSync(dirnameSafe(p), { recursive: true });
        writeFileSync(p, "secret");
      }
      const d = classifyPathAccess(m, p, "read");
      expect(d.allow).toBe(false);
    }
  });

  test("denies path traversal and unresolved env/glob", () => {
    const repo = tmp();
    const m = implManifest(repo);
    expect(() => resolveCanonicalPath(`${m.canonicalRoots.worktree}/../..`)).toThrow(
      /traversal|unrelated/,
    );
    // normalize may collapse .. — classify should still deny outside roots
    const d = classifyPathAccess(
      m,
      join(m.canonicalRoots.worktree, "..", "..", "etc"),
      "read",
    );
    expect(d.allow).toBe(false);
    expect(() => resolveCanonicalPath("$HOME/.ssh")).toThrow(/env\/glob/);
    expect(() => resolveCanonicalPath("/tmp/*.txt")).toThrow(/env\/glob/);
  });

  test("nearest-existing-parent resolution for non-existing descendants", () => {
    const repo = tmp();
    const m = implManifest(repo);
    const child = join(m.canonicalRoots.worktree, "a", "b", "c.ts");
    const r = resolveCanonicalPath(child);
    expect(r.exists).toBe(false);
    expect(existsSync(r.nearestParent)).toBe(true);
    const w = classifyPathAccess(m, child, "write");
    expect(w.allow).toBe(true);
    expect(w.operation).toBe("fs.write.lane");
  });

  test("symlink chains resolve and stay within policy", () => {
    const repo = tmp();
    const m = implManifest(repo);
    const real = join(m.canonicalRoots.worktree, "real.txt");
    writeFileSync(real, "x");
    const link = join(m.canonicalRoots.worktree, "link.txt");
    symlinkSync(real, link);
    const r = resolveCanonicalPath(link);
    expect(r.exists).toBe(true);
    expect(classifyPathAccess(m, link, "read").allow).toBe(true);
  });

  test("denies broad recursive deletion and forbidden git forms", () => {
    const repo = tmp();
    const m = implManifest(repo);
    expect(classifyCommand(m, ["rm", "-rf", "/"]).allow).toBe(false);
    expect(classifyCommand(m, ["git", "clean", "-xfd"]).allow).toBe(false);
    expect(classifyCommand(m, ["git", "reset", "--hard"]).allow).toBe(false);
    expect(classifyCommand(m, ["git", "push", "--force"]).allow).toBe(false);
    expect(classifyCommand(m, ["git", "rebase", "main"]).allow).toBe(false);
  });

  test("denies remote/PR ops before PR phase", () => {
    const repo = tmp();
    const m = implManifest(repo);
    expect(classifyCommand(m, ["git", "push", "origin", "HEAD"]).allow).toBe(
      false,
    );
    expect(classifyCommand(m, ["gh", "pr", "create"]).allow).toBe(false);
  });

  test("allows explicit gh views and denies aliases, extensions, mutations, and unknown commands", () => {
    const ordinary = implManifest(tmp());
    const publisher = publisherManifest(tmp());
    for (const command of [
      ["gh", "-R", "acme/widgets", "issue", "view", "7"],
      ["gh", "issue", "--repo", "acme/widgets", "view", "7"],
      ["/opt/homebrew/bin/gh", "pr", "--repo=acme/widgets", "view", "11"],
      ["gh", "repo", "view", "acme/widgets"],
    ]) {
      expect(classifyCommand(ordinary, command)).toMatchObject({
        allow: true,
        operation: "cli.execute",
      });
      expect(classifyCommand(publisher, command)).toMatchObject({
        allow: true,
        operation: "gh.pr.inline-review",
      });
    }

    for (const command of [
      ["gh", "-R", "acme/widgets", "issue", "comment", "7", "--body", "pwn"],
      ["gh", "alias", "set", "pwn", "api --method POST repos/acme/widgets/issues/7/comments"],
      ["gh", "alias", "pwn"],
      ["gh", "extension", "exec", "pwn"],
      ["gh", "auth", "status", "--show-token"],
      ["gh", "auth", "status", "--show-token=true"],
      ["gh", "unknown-command", "pwn"],
    ]) {
      for (const manifest of [ordinary, publisher]) {
        expect(classifyCommand(manifest, command)).toMatchObject({
          allow: false,
          reason: expect.stringMatching(/allowlist|denied/i),
        });
      }
    }
  });

  test("gates every inline review mutation outside its publisher context", () => {
    const ordinary = implManifest(tmp());
    const endpoints = [
      "repos/acme/widgets/issues/7/comments",
      "/repos/acme/widgets/issues/comments/8?notification_id=1",
      "/repos/acme/widgets/pulls/9/comments?side=RIGHT",
      "repos/acme/widgets/pulls/comments/10",
      "/repos/acme/widgets/pulls/11/reviews?per_page=100",
      "repos/acme/widgets/pulls/11/reviews/12",
    ];

    const commands = [
      ["gh", "pr", "comment", "11", "--body", "no"],
      ["gh", "pr", "review", "11", "--approve"],
      ["gh", "-R", "acme/widgets", "pr", "comment", "11", "--body", "no"],
      ["gh", "-Racme/widgets", "pr", "review", "11", "--approve"],
      ["gh", "--repo", "acme/widgets", "pr", "comment", "11", "--body", "no"],
      ["gh", "--repo=acme/widgets", "pr", "review", "11", "--approve"],
      ["gh", "pr", "-R", "acme/widgets", "comment", "11", "--body", "no"],
      ["gh", "pr", "--repo", "acme/widgets", "review", "11", "--approve"],
      ["gh", "pr", "--repo=acme/widgets", "comment", "11", "--body", "no"],
      ["gh", "api", "-f", "body=x", "/repos/acme/widgets/pulls/11/reviews"],
      ["gh", "api", "-fbody=x", "/repos/acme/widgets/pulls/11/reviews"],
      ["gh", "api", "--raw-field", "body=x", "/repos/acme/widgets/pulls/11/reviews"],
      ["gh", "api", "--raw-field=body=x", "/repos/acme/widgets/pulls/11/reviews"],
      ["gh", "api", "-F", "body=x", "/repos/acme/widgets/pulls/11/reviews"],
      ["gh", "api", "-Fbody=x", "/repos/acme/widgets/pulls/11/reviews"],
      ["gh", "api", "--field", "body=x", "/repos/acme/widgets/pulls/11/reviews"],
      ["gh", "api", "--field=body=x", "/repos/acme/widgets/pulls/11/reviews"],
      ["gh", "api", "--input", "payload.json", "/repos/acme/widgets/pulls/11/reviews"],
      ["gh", "api", "--input=payload.json", "/repos/acme/widgets/pulls/11/reviews"],
      ["gh", "api", "--input", "--method=GET", "/repos/acme/widgets/pulls/11/reviews"],
      ["gh", "api", "-iXPOST", "/repos/acme/widgets/pulls/11/reviews"],
      ["gh", "api", "-iFbody=x", "/repos/acme/widgets/pulls/11/reviews"],
      ["gh", "api", "-ifbody=x", "/repos/acme/widgets/pulls/11/reviews"],
      ["gh", "api", "-X=POST", "/repos/acme/widgets/pulls/11/reviews"],
      ["gh", "api", "-iX=POST", "/repos/acme/widgets/pulls/11/reviews"],
      [
        "gh",
        "api",
        "--method=POST",
        "https://api.github.com/repos/acme/widgets/pulls/11/reviews?draft=true",
      ],
      [
        "gh",
        "api",
        "-XPOST",
        "https://github.example.com/api/v3/repos/acme/widgets/pulls/11/reviews",
      ],
      [
        "gh",
        "api",
        "--hostname",
        "github.com",
        "-XPOST",
        "/repos/acme/widgets/pulls/11/reviews",
      ],
      ...["POST", "PATCH", "PUT", "DELETE"].flatMap((method) =>
        endpoints.map((endpoint) => [
          "gh",
          "api",
          "--method",
          method,
          endpoint,
        ]),
      ),
    ];

    for (const command of commands) {
      const denied = classifyCommand(ordinary, command);
      expect(denied.allow, command.join(" ")).toBe(false);
      expect(denied.reason).toMatch(/inline review/i);
    }

  });

  test("normalizes gh paths and rejects GraphQL or encoded review mutations", () => {
    const cwd = process.cwd();
    const ordinary = buildPhaseCapabilities({
      phase: "Implement",
      agent: "implementer",
      runId: "run-path-qualified-gh",
      issueId: "iss-1",
      canonicalRoots: { repo: cwd, worktree: cwd, runTemp: tmp() },
    });
    const publisher = publisherManifest(tmp());
    const mutations = [
      [
        "/opt/homebrew/bin/gh",
        "api",
        "--method",
        "POST",
        "repos/acme/widgets/issues/7/comments",
        "-f",
        "body=pwn",
      ],
      [
        "gh",
        "api",
        "graphql",
        "-f",
        "query=mutation { addPullRequestReview(input: {}) { pullRequestReview { id } } }",
      ],
      [
        "gh",
        "api",
        "graphql",
        "-f",
        "query=query Review { addPullRequestReview(input: {}) { pullRequestReview { id } } }",
      ],
      [
        "gh",
        "api",
        "graphql",
        "-f",
        "query=subscription ReviewEvents { reviewAdded { id } }",
      ],
      [
        "gh",
        "api",
        "--method=POST",
        "repos/acme/widgets/%69ssues/7/%63omments",
        "-f",
        "body=pwn",
      ],
    ];

    for (const command of mutations) {
      for (const manifest of [ordinary, publisher]) {
        const decision = classifyCommand(manifest, command);
        expect(decision.allow, command.join(" ")).toBe(false);
        expect(decision.reason).toMatch(/review|comment|GraphQL/i);
      }
    }
  });

  test("publisher allows exact grouped review POST and GitHub GET reads only", () => {
    const ordinary = implManifest(tmp());
    const publisher = publisherManifest(tmp());
    const groupedPosts = [
      [
        "gh",
        "api",
        "--method",
        "POST",
        "repos/acme/widgets/pulls/11/reviews",
        "--input",
        "payload.json",
      ],
      [
        "/opt/homebrew/bin/gh",
        "api",
        "-XPOST",
        "/repos/acme/widgets/pulls/11/%72eviews",
        "-f",
        "body=summary",
      ],
    ];

    for (const command of groupedPosts) {
      expect(classifyCommand(ordinary, command).allow, command.join(" ")).toBe(false);
      expect(classifyCommand(publisher, command)).toMatchObject({
        allow: true,
        operation: "gh.pr.inline-review",
      });
    }

    for (const endpoint of [
      "repos/acme/widgets/pulls/11",
      "repos/acme/widgets/pulls/11/reviews",
      "repos/acme/widgets/pulls/11/comments",
    ]) {
      expect(classifyCommand(publisher, [
        "/usr/local/bin/gh",
        "api",
        "--method=GET",
        endpoint,
      ])).toMatchObject({
        allow: true,
        operation: "gh.pr.inline-review",
      });
    }
    for (const method of ["TRACE", "CONNECT", "PROPFIND"]) {
      const command = [
        "gh",
        "api",
        "--method",
        method,
        "repos/acme/widgets/pulls/11/reviews",
      ];
      for (const manifest of [ordinary, publisher]) {
        expect(classifyCommand(manifest, command)).toMatchObject({
          allow: false,
          reason: expect.stringMatching(/method/i),
        });
      }
    }

    for (const command of [
      ["gh", "pr", "review", "11", "--approve"],
      ["gh", "api", "-XPOST", "repos/acme/widgets/issues/7/comments", "-f", "body=pwn"],
      ["gh", "api", "-XPOST", "repos/acme/widgets/pulls/11/comments", "--input", "payload.json"],
      ["gh", "api", "-XPATCH", "repos/acme/widgets/pulls/11/reviews/12", "-f", "body=pwn"],
    ]) {
      expect(classifyCommand(publisher, command).allow, command.join(" ")).toBe(false);
    }

    const queryOnlyDocuments = [
      "query Viewer { viewer { login } }",
      "{ viewer { login } }",
      "fragment ReviewFields on PullRequestReview { id } query Review { node(id: \"R\") { ...ReviewFields } }",
      `query Read($mutation: String!) {
        # mutation { addPullRequestReview(input: {}) { pullRequestReview { id } } }
        node(id: $mutation) { id }
        repository(owner: "mutation", name: "addPullRequestReview") {
          object(expression: """mutation { addPullRequestReview }""") { id }
        }
      }`,
    ];
    for (const document of queryOnlyDocuments) {
      for (const method of ["GET", "POST"]) {
        const command = [
          "gh",
          "api",
          "graphql",
          "--method",
          method,
          "-f",
          `query=${document}`,
        ];
        expect(classifyCommand(ordinary, command)).toMatchObject({
          allow: true,
          operation: "cli.execute",
        });
        expect(classifyCommand(publisher, command)).toMatchObject({
          allow: true,
          operation: "gh.pr.inline-review",
        });
      }
    }

    for (const method of ["DELETE", "PATCH", "PUT", "TRACE", "CONNECT", "PROPFIND"]) {
      const command = [
        "gh",
        "api",
        "graphql",
        "--method",
        method,
        "-f",
        "query=query Viewer { viewer { login } }",
      ];
      for (const manifest of [ordinary, publisher]) {
        expect(classifyCommand(manifest, command)).toMatchObject({
          allow: false,
          reason: expect.stringMatching(/method|transport/i),
        });
      }
    }
  });

  test("fails closed on malformed mutating absolute API URLs", () => {
    for (const manifest of [implManifest(tmp()), publisherManifest(tmp())]) {
      const decision = classifyCommand(manifest, [
        "gh",
        "api",
        "--method=POST",
        "https://[invalid/repos/acme/widgets/pulls/11/reviews",
      ]);
      expect(decision.allow).toBe(false);
      expect(decision.reason).toMatch(/malformed.*URL/i);
    }
  });

  test("keeps GitHub GET and existing PR classification unchanged", () => {
    const ordinary = implManifest(tmp());
    for (const endpoint of [
      "/repos/acme/widgets/issues/7/comments?per_page=100",
      "repos/acme/widgets/pulls/9/comments",
      "/repos/acme/widgets/pulls/11/reviews",
    ]) {
      const decision = classifyCommand(ordinary, [
        "gh",
        "api",
        "--method=GET",
        endpoint,
      ]);
      expect(decision.allow).toBe(true);
      expect(decision.operation).toBe("cli.execute");
    }

    for (const command of [
      [
        "gh",
        "api",
        "--method",
        "GET",
        "-f",
        "body=x",
        "/repos/acme/widgets/pulls/11/reviews",
      ],
      [
        "gh",
        "api",
        "-XGET",
        "--input",
        "payload.json",
        "/repos/acme/widgets/pulls/11/reviews",
      ],
    ]) {
      const decision = classifyCommand(ordinary, command);
      expect(decision.allow, command.join(" ")).toBe(true);
      expect(decision.operation).toBe("cli.execute");
    }

    expect(
      classifyCommand(ordinary, [
        "gh",
        "api",
        "--input",
        "/repos/acme/widgets/pulls/11/reviews",
        "/repos/acme/widgets/issues/7/labels",
      ]).operation,
    ).toBe("cli.execute");

    expect(
      classifyCommand(ordinary, [
        "gh",
        "api",
        "-X",
        "POST",
        "/repos/acme/widgets/issues/7/labels",
      ]).operation,
    ).toBe("cli.execute");

    const pr = buildPhaseCapabilities({
      phase: "PR",
      agent: "pr-opener",
      runId: "r1",
      canonicalRoots: baseRoots(tmp()),
    });
    expect(classifyCommand(pr, ["gh", "pr", "create"]).operation).toBe("gh.pr");
    expect(classifyCommand(pr, ["gh", "pr", "merge"]).operation).toBe("gh.pr");
  });

  test("denies child Beads mutation without controller op", () => {
    const repo = tmp();
    const m = implManifest(repo);
    expect(m.operations).not.toContain("bd.write.controller");
    expect(classifyCommand(m, ["bd", "create", "x"]).allow).toBe(false);
  });

  test("unclassifiable command without policy fails closed", () => {
    const repo = tmp();
    const m = buildPhaseCapabilities({
      phase: "Research",
      agent: "scout",
      runId: "r",
      canonicalRoots: baseRoots(repo),
      networkMode: "none",
    });
    // remove cli by building research — has cli.execute; use empty
    expect(classifyCommand(m, []).allow).toBe(false);
  });
});

describe("preflight audit approval cache", () => {
  test("incompatible/missing approvalMode blocks entry", () => {
    const compat = { settings: ["tools.approvalMode"] };
    expect(
      preflightOmpApprovalConfig({ approvalMode: "always-ask" }, compat).ok,
    ).toBe(true);
    expect(
      preflightOmpApprovalConfig({ approvalMode: "yolo" }, compat).ok,
    ).toBe(true);
    expect(
      preflightOmpApprovalConfig({ approvalMode: "write" }, compat).ok,
    ).toBe(true);
    expect(
      preflightOmpApprovalConfig({ approvalMode: "never" }, compat).ok,
    ).toBe(false);
    expect(
      preflightOmpApprovalConfig({ approvalMode: "auto-approve-all" }, compat)
        .ok,
    ).toBe(false);
    expect(preflightOmpApprovalConfig({}, compat).ok).toBe(false);
    expect(
      preflightOmpApprovalConfig(
        { approvalMode: "always-ask", extensionGuard: false },
        compat,
      ).ok,
    ).toBe(false);
  });

  test("every tool call checked; denials written through Beads sink", () => {
    const repo = tmp();
    const m = implManifest(repo);
    const notes: string[] = [];
    const state = createInterceptor(m, {
      appendNotes: (_id, n) => {
        notes.push(n);
      },
    });
    const d = interceptToolCall(state, {
      tool: "bash",
      argv: ["git", "push", "--force"],
    });
    expect(d.allow).toBe(false);
    expect(notes.some((n) => n.includes("deny"))).toBe(true);
    expect(state.events.some((e) => e.kind === "deny")).toBe(true);
  });

  test("one-run approval never global and does not survive run", () => {
    const repo = tmp();
    const m = implManifest(repo);
    const notes: string[] = [];
    const state = createInterceptor(m, {
      appendNotes: (_i, n) => {
        notes.push(n);
      },
    });
    const req = {
      tool: "bash",
      argv: ["bd", "create", "x"],
    };
    expect(interceptToolCall(state, req).allow).toBe(false);
    const ap = grantRunApproval(state, req, "appr-1");
    expect(ap.expiresWithRun).toBe(true);
    expect(ap.runId).toBe("run-1");
    expect(interceptToolCall(state, req).allow).toBe(true);
    clearRunApprovals(state);
    expect(interceptToolCall(state, req).allow).toBe(false);
    expect(notes.some((n) => n.includes("approval"))).toBe(true);
  });

  test("writable caches resolve only below lane/run temp root", () => {
    const repo = tmp();
    const m = implManifest(repo);
    const ok = resolveWritableCachePath(m, "cargo");
    expect(ok.allow).toBe(true);
    expect(ok.resolvedPath).toContain(m.canonicalRoots.runTemp);
    const state = createInterceptor(m);
    const c = cachePathForLane(state, "bun");
    expect(c.allow).toBe(true);
    expect(c.resolvedPath?.startsWith(m.canonicalRoots.runTemp)).toBe(true);
  });

  test("preflightHarnessSandbox and tool handler wire from index", () => {
    const repo = tmp();
    const m = implManifest(repo);
    const pf = preflightHarnessSandbox({
      approvalMode: "always-ask",
      extensionGuard: true,
    });
    expect(pf.ok).toBe(true);
    const bad = preflightHarnessSandbox({ approvalMode: "never" });
    expect(bad.ok).toBe(false);

    const notes: string[] = [];
    const handler = registerSandboxToolHandler(m, {
      appendNotes: (_i, n) => {
        notes.push(n);
      },
    });
    const d = handler({ tool: "bash", argv: ["git", "reset", "--hard"] });
    expect(d.allow).toBe(false);
  });
});

function dirnameSafe(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? p : p.slice(0, i);
}
