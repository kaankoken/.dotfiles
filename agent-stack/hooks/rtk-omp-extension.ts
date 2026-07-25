// RTK OMP extension — rewrites bash commands to use rtk for token savings.
// Requires: rtk >= 0.23.0 in PATH.
//
// Thin delegating extension: rewrite logic lives in `rtk rewrite`
// (src/discover/registry.rs). Edit the Rust registry — not this file.
//
// Types: OMP runtime package only (`@oh-my-pi/pi-coding-agent`), type-only import.
// Exit codes for `rtk rewrite`:
//   0 + stdout  Rewrite found → mutate command
//   1           No RTK equivalent → pass through unchanged
//   3 + stdout  Rewrite (advisory) → mutate command

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent"
import { isToolCallEventType } from "@oh-my-pi/pi-coding-agent"

const REWRITE_TIMEOUT_MS = 2_000
const MIN_SUPPORTED_RTK_MINOR = 23

function parseSemver(raw: string): [number, number, number] | null {
  const m = raw.trim().match(/(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)]
}

async function rewriteCommand(
  api: ExtensionAPI,
  cmd: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const result = await api.exec("rtk", ["rewrite", cmd], {
    timeout: REWRITE_TIMEOUT_MS,
    signal,
  })
  if (result.killed) return null
  if (result.code !== 0 && result.code !== 3) return null
  return result.stdout.trim() || null
}

export default async function (api: ExtensionAPI) {
  const ver = await api.exec("rtk", ["--version"], { timeout: REWRITE_TIMEOUT_MS })
  if (ver.code !== 0) {
    console.warn("[rtk] rtk binary not found in PATH — extension disabled")
    return
  }

  const parsed = parseSemver(ver.stdout.replace(/^rtk\s+/, ""))
  if (parsed) {
    const [major, minor] = parsed
    if (major === 0 && minor < MIN_SUPPORTED_RTK_MINOR) {
      console.warn(
        `[rtk] rtk ${ver.stdout.trim()} is too old (need >= 0.23.0) — extension disabled`,
      )
      return
    }
  }

  api.on("tool_call", async (event, ctx) => {
    try {
      if (!isToolCallEventType("bash", event)) return

      const cmd = event.input.command
      if (typeof cmd !== "string" || cmd.trim() === "") return

      if (cmd.startsWith("rtk ")) return
      if (process.env.RTK_DISABLED === "1") return

      const rewritten = await rewriteCommand(api, cmd, ctx.signal)
      if (rewritten && rewritten !== cmd) {
        event.input.command = rewritten
      }
    } catch (err) {
      console.warn(
        "[rtk] unexpected error in tool_call handler; passing through command",
        err,
      )
      return
    }
  })
}
