import { describe, expect, test } from "bun:test";
import {
  BeadsWorkspaceError,
  assertBeadsWorkspaceMatchesRoot,
  beadsIssuePrefixForRoot,
  buildSafeBdInitArgs,
  initOutputLooksLikeRemoteBootstrap,
  normalizeBeadsPrefix,
  parseBdWhere,
} from "../extensions/goal-harness/beads-workspace";

describe("beads-workspace policy", () => {
  test("prefix from directory basename", () => {
    expect(beadsIssuePrefixForRoot("/x/digital-garden")).toBe("digital-garden");
    expect(beadsIssuePrefixForRoot("/x/My_App")).toBe("my-app");
    expect(normalizeBeadsPrefix("dotfiles-")).toBe("dotfiles");
  });

  test("safe init args are never bare and never --remote", () => {
    const args = buildSafeBdInitArgs("/Users/me/digital-garden");
    expect(args[0]).toBe("init");
    expect(args).toContain("--prefix=digital-garden");
    expect(args).toContain("--init-if-missing");
    expect(args).toContain("--non-interactive");
    expect(args).toContain("--skip-agents");
    expect(args).not.toContain("--remote");
    expect(args).not.toEqual(["init"]);
  });

  test("parseBdWhere extracts prefix", () => {
    const info = parseBdWhere(
      "/tmp/proj/.beads\n  prefix: digital-garden\n  database: /tmp/proj/.beads/embeddeddolt\n",
    );
    expect(info.prefix).toBe("digital-garden");
    expect(info.path).toContain(".beads");
  });

  test("assert fails on foreign prefix (dotfiles in garden)", () => {
    expect(() =>
      assertBeadsWorkspaceMatchesRoot(
        "/Users/me/digital-garden/.beads\n  prefix: dotfiles\n",
        "/Users/me/digital-garden",
      ),
    ).toThrow(BeadsWorkspaceError);
    expect(() =>
      assertBeadsWorkspaceMatchesRoot(
        "/Users/me/digital-garden/.beads\n  prefix: dotfiles\n",
        "/Users/me/digital-garden",
      ),
    ).toThrow(/dotfiles|does not match/);
  });

  test("assert passes when prefix matches repo", () => {
    const info = assertBeadsWorkspaceMatchesRoot(
      "/Users/me/digital-garden/.beads\n  prefix: digital-garden\n",
      "/Users/me/digital-garden",
    );
    expect(info.prefix).toBe("digital-garden");
  });

  test("detect remote bootstrap markers", () => {
    expect(
      initOutputLooksLikeRemoteBootstrap(
        "Bootstrapped from remote: git+ssh://x/.dotfiles.git",
      ),
    ).toBe(true);
    expect(
      initOutputLooksLikeRemoteBootstrap("✓ bd initialized successfully!"),
    ).toBe(false);
  });
});
