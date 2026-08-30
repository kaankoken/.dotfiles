// RTK Pi extension — rewrites shell commands to use brew CLIs + rtk.
// Requires: rtk >= 0.23.0 in PATH.
//
// Pipeline:
//   1. GNU → brew when binary exists (grep→rg, ls→eza, cat→bat -P, du→dust, ps→procs)
//   2. `rtk rewrite`
//   3. Post: rtk grep→rtk rg, rtk ls→eza, rtk du→dust, rtk ps→procs
//
// Exit code contract for `rtk rewrite`:
//   0 + stdout  Rewrite found → mutate command
//   1           No RTK equivalent → pass through (after step 1)
//   3 + stdout  Rewrite (advisory) → mutate command
//
// Hooks bash, ctx_execute (language=shell), and ctx_batch_execute.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { isToolCallEventType } from "@earendil-works/pi-coding-agent"

const REWRITE_TIMEOUT_MS = 2_000
const MIN_SUPPORTED_RTK_MINOR = 23
const WHICH_TIMEOUT_MS = 1_000

function parseSemver(raw: string): [number, number, number] | null {
  const m = raw.trim().match(/(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)]
}

async function whichBins(
  pi: ExtensionAPI,
  names: string[],
): Promise<Set<string>> {
  const found = new Set<string>()
  await Promise.all(
    names.map(async (name) => {
      const r = await pi.exec("which", [name], { timeout: WHICH_TIMEOUT_MS })
      if (r.code === 0 && r.stdout.trim()) found.add(name)
    }),
  )
  return found
}

/** GNU → brew at command / pipeline starts. find/sed/fzf not swapped (flags or TUI). */
function applyBrewBins(cmd: string, bins: Set<string>): string {
  let out = cmd
  const atStart = (from: string, to: string) => {
    const re = new RegExp(`(^|[|&;]\\s*)${from}\\b`, "g")
    out = out.replace(re, `$1${to}`)
  }
  if (bins.has("rg")) {
    atStart("fgrep", "rg -F")
    atStart("egrep", "rg")
    atStart("grep", "rg")
  }
  if (bins.has("eza")) atStart("ls", "eza")
  if (bins.has("bat")) {
    atStart("cat", "bat -P")
    atStart("less", "bat -P")
    atStart("more", "bat -P")
  }
  if (bins.has("dust")) {
    out = out.replace(
      /(^|[|&;]\s*)du(?:\s+-(?:sh|hs|s|h))?(?=\s+[^-]|$)/g,
      "$1dust",
    )
  }
  if (bins.has("procs")) {
    out = out.replace(
      /(^|[|&;]\s*)ps(?:\s+(?:aux(?:ww)?|ax|-ef|-e|-f|-A))?(?=\s*[|&;]|$)/g,
      "$1procs",
    )
  }
  return out
}

function postProcessRtk(cmd: string, bins: Set<string>): string {
  let out = cmd
  if (bins.has("rg")) out = out.replace(/^rtk grep\b/, "rtk rg")
  if (bins.has("eza")) out = out.replace(/^rtk ls\b/, "eza")
  if (bins.has("dust")) {
    out = out.replace(/^rtk du(?:\s+-(?:sh|hs|s|h))?\b/, "dust")
  }
  if (bins.has("procs")) {
    out = out.replace(/^rtk ps(?:\s+(?:aux(?:ww)?|ax|-ef|-e|-f|-A))?\b/, "procs")
  }
  return out
}

async function rtkRewrite(
  pi: ExtensionAPI,
  cmd: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (cmd.trim() === "" || cmd.startsWith("rtk ")) return null
  const result = await pi.exec("rtk", ["rewrite", cmd], {
    timeout: REWRITE_TIMEOUT_MS,
    signal,
  })
  if (result.killed) return null
  if (result.code !== 0 && result.code !== 3) return null
  const out = result.stdout.trim()
  return out && out !== cmd ? out : null
}

async function rewriteCommand(
  pi: ExtensionAPI,
  cmd: string,
  bins: Set<string>,
  signal?: AbortSignal,
): Promise<string | null> {
  if (cmd.trim() === "") return null
  if (cmd.startsWith("rtk ")) {
    const out = postProcessRtk(cmd, bins)
    return out !== cmd ? out : null
  }
  const brewed = applyBrewBins(cmd, bins)
  const rewritten = await rtkRewrite(pi, brewed, signal)
  const out = postProcessRtk(rewritten ?? brewed, bins)
  return out !== cmd ? out : null
}

export default async function (pi: ExtensionAPI) {
  const ver = await pi.exec("rtk", ["--version"], { timeout: REWRITE_TIMEOUT_MS })
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

  const bins = await whichBins(pi, [
    "rg",
    "eza",
    "fd",
    "bat",
    "dust",
    "procs",
    "sd",
    "delta",
  ])

  pi.on("tool_call", async (event, ctx) => {
    try {
      if (process.env.RTK_DISABLED === "1") return

      if (isToolCallEventType("bash", event)) {
        const cmd = event.input.command
        if (typeof cmd !== "string") return
        const rewritten = await rewriteCommand(pi, cmd, bins, ctx.signal)
        if (rewritten) event.input.command = rewritten
        return
      }

      if (isToolCallEventType("ctx_execute", event)) {
        const lang = event.input.language
        const code = event.input.code
        if (lang !== "shell" || typeof code !== "string") return
        const rewritten = await rewriteCommand(pi, code, bins, ctx.signal)
        if (rewritten) event.input.code = rewritten
        return
      }

      if (isToolCallEventType("ctx_batch_execute", event)) {
        const commands = event.input.commands
        if (!Array.isArray(commands)) return
        for (const item of commands) {
          if (!item || typeof item !== "object") continue
          const rec = item as { command?: unknown }
          if (typeof rec.command !== "string") continue
          const rewritten = await rewriteCommand(
            pi,
            rec.command,
            bins,
            ctx.signal,
          )
          if (rewritten) rec.command = rewritten
        }
      }
    } catch (err) {
      console.warn(
        "[rtk] unexpected error in tool_call handler; passing through command",
        err,
      )
    }
  })
}
