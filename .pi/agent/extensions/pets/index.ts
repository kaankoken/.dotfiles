import { CustomEditor, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  ANIMATIONS, PetActivity, frameIndex, importPet, loadPet, lookIndex,
  readSettings, saveSettings, validId, type LoadedPet, type PetSettings, type PetState,
} from "./core.ts";
import { decorateEditor } from "./editor.ts";

type EditorFactory = NonNullable<Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]>;

const HELP = "/pet import <folder> | list | choose <id> | show | hide | status | preview <state> | look <degrees> | renderer auto|ansi | animate on|off";

export default function pets(pi: ExtensionAPI): void {
  const root = join(getAgentDir(), "pets");
  let settings: PetSettings = { visible: true, renderer: "auto", animate: true };
  let pet: LoadedPet | undefined;
  let activity = new PetActivity();
  let tui: TUI | undefined;
  let factory: EditorFactory | undefined;
  let baseFactory: EditorFactory | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let generation = 0;
  let aborted = false;
  let animationState: PetState | undefined;
  let animationStarted = 0;
  let lastFrame = "";
  let preview: { state?: PetState; index?: number; until: number } | undefined;
  let pointer: { index: number; until: number } | undefined;

  function currentIndex(now = Date.now()): number {
    const state = preview && now < preview.until && preview.state ? preview.state : activity.state(now);
    if (state !== animationState) { animationState = state; animationStarted = now; }
    if (preview && now < preview.until && preview.index !== undefined) return preview.index;
    if (state === "idle" && pointer && now < pointer.until) return pointer.index;
    return frameIndex(state, settings.animate ? now - animationStarted : 0);
  }

  function refresh(force = false): void {
    const next = `${pet?.manifest.id}:${currentIndex()}:${settings.visible}:${settings.renderer}:${tui?.hasOverlay()}`;
    if (force || next !== lastFrame) {
      lastFrame = next;
      tui?.requestRender();
    }
  }

  function restartTimer(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (tui && pet && settings.visible) {
      timer = setInterval(() => refresh(), 90);
      timer.unref();
    }
    refresh(true);
  }

  function replaceEditor(ctx: ExtensionContext, next: EditorFactory | undefined): void {
    // Pi's setter transfers raw paste markers; transfer expanded text when necessary.
    const text = ctx.ui.getEditorText();
    ctx.ui.setEditorComponent(next);
    if (ctx.ui.getEditorText() !== text) ctx.ui.setEditorText(text);
  }

  function installEditor(ctx: ExtensionContext): void {
    const current = ctx.ui.getEditorComponent();
    baseFactory = current === factory ? baseFactory : current;
    const base = baseFactory;
    factory = (renderer, theme, keybindings) => {
      tui = renderer;
      const editor = base?.(renderer, theme, keybindings) ??
        new CustomEditor(renderer, theme, keybindings, { embedWorkingStatus: true });
      const decorated = decorateEditor(editor, () => ({
        pet, index: currentIndex(),
        visible: settings.visible && !renderer.hasOverlay(),
        renderer: settings.renderer,
        onLook: (degrees) => {
          if (activity.state() !== "idle") return;
          pointer = degrees === undefined ? undefined : { index: lookIndex(degrees), until: Date.now() + 700 };
          refresh();
        },
        onClick: () => { preview = { state: "jumping", until: Date.now() + 1800 }; animationState = undefined; refresh(true); },
      }));
      restartTimer();
      return decorated;
    };
    replaceEditor(ctx, factory);
  }

  async function installedIds(): Promise<string[]> {
    try {
      return (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && validId(entry.name))
        .map((entry) => entry.name).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async function selectPet(id: string, ready?: LoadedPet): Promise<void> {
    if (!validId(id)) throw new Error("invalid pet id");
    const run = ++generation;
    const loaded = ready ?? await loadPet(join(root, id));
    if (loaded.manifest.id !== id) throw new Error("pet id must match installed folder name");
    if (run !== generation) return;
    const next = { ...settings, selected: id, visible: true };
    await saveSettings(root, next);
    if (run !== generation) return;
    settings = next;
    pet = loaded;
    preview = undefined;
    pointer = undefined;
    animationState = undefined;
    restartTimer();
  }

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const run = ++generation;
    if (timer) clearInterval(timer);
    timer = undefined;
    pet = undefined;
    activity = new PetActivity();
    preview = pointer = undefined;
    aborted = false;
    animationState = undefined;
    let nextSettings = settings;
    let nextPet: LoadedPet | undefined;
    let warning: string | undefined;
    try {
      nextSettings = await readSettings(root);
      if (nextSettings.selected) {
        nextPet = await loadPet(join(root, nextSettings.selected));
        if (nextPet.manifest.id !== nextSettings.selected) throw new Error("pet id must match installed folder name");
      }
    } catch (error) {
      nextPet = undefined;
      warning = String(error);
    }
    if (run !== generation) return;
    settings = nextSettings;
    pet = nextPet;
    if (warning) ctx.ui.notify(`Pet: ${warning}`, "warning");
    installEditor(ctx);
    if (pet) { activity.react("waving"); refresh(true); }
  });

  pi.on("agent_start", () => { activity.start(); aborted = false; pointer = undefined; preview = undefined; refresh(); });
  pi.on("message_update", (event) => {
    const type = event.assistantMessageEvent.type;
    if (type.startsWith("thinking")) activity.text(true);
    else if (type.startsWith("text")) activity.text();
    refresh();
  });
  pi.on("tool_execution_start", (event) => { activity.toolStart(event.toolCallId); refresh(); });
  pi.on("tool_execution_end", (event) => { activity.toolEnd(event.toolCallId, event.isError); refresh(); });
  pi.on("ui_prompt_start", (event) => { activity.promptStart(event.kind); refresh(); });
  pi.on("ui_prompt_end", (event) => { activity.promptEnd(event.kind); refresh(); });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    if (event.message.stopReason === "error") activity.fail();
    if (event.message.stopReason === "aborted") aborted = true;
    refresh();
  });
  pi.on("agent_settled", () => { activity.finish(Date.now(), aborted); refresh(); });
  pi.on("session_shutdown", (_event, ctx) => {
    generation++;
    if (timer) clearInterval(timer);
    timer = undefined;
    pet = undefined;
    if (ctx.mode === "tui" && factory && ctx.ui.getEditorComponent() === factory) replaceEditor(ctx, baseFactory);
    tui = undefined;
    factory = baseFactory = undefined;
  });

  pi.registerCommand("pet", {
    description: "Codex V1/V2 pet at the input editor's right edge",
    getArgumentCompletions: (prefix) => {
      const commands = ["import ", "list", "choose ", "show", "hide", "status", "preview ", "look ", "renderer auto", "renderer ansi", "animate on", "animate off"];
      const matches = commands.filter((value) => value.startsWith(prefix));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") { if (ctx.hasUI) ctx.ui.notify("Pets require interactive Pi.", "warning"); return; }
      const match = args.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
      const action = match?.[1] ?? "";
      const value = match?.[2]?.trim() ?? "";
      try {
        if (!action) {
          const ids = await installedIds();
          if (!ids.length) { ctx.ui.notify("No pets installed. /pet import /path/to/pet-folder", "info"); return; }
          const id = await ctx.ui.select("Choose pet", ids);
          if (id) await selectPet(id);
        } else if (action === "list") {
          const ids = await installedIds();
          ctx.ui.notify(ids.length ? ids.map((id) => `${id === settings.selected ? "* " : "  "}${id}`).join("\n") : "No pets installed.", "info");
        } else if (action === "import") {
          if (!value) throw new Error("usage: /pet import /path/to/pet-folder");
          const unquoted = /^(["']).*\1$/s.test(value) ? value.slice(1, -1) : value;
          const path = unquoted.startsWith("~/") ? join(homedir(), unquoted.slice(2)) : resolve(ctx.cwd, unquoted);
          const imported = await importPet(path, root);
          await selectPet(imported.manifest.id, imported);
          ctx.ui.notify(`Imported ${imported.manifest.displayName} (V${imported.manifest.spriteVersionNumber}).`, "info");
        } else if (action === "choose") {
          await selectPet(value);
        } else if (action === "status") {
          ctx.ui.notify(pet ? `${pet.manifest.displayName} · ${pet.manifest.id} · V${pet.manifest.spriteVersionNumber} · ${settings.visible ? "visible" : "hidden"} · ${settings.renderer} · ${activity.state()} · animation ${settings.animate ? "on" : "off"}` : "No pet selected. /pet import <folder>", "info");
        } else if (action === "preview" || action === "look") {
          if (!pet) throw new Error("choose or import a pet first");
          if (action === "preview") {
            if (!Object.hasOwn(ANIMATIONS, value)) throw new Error(`states: ${Object.keys(ANIMATIONS).join(", ")}`);
            preview = { state: value as PetState, until: Date.now() + 4000 };
          } else {
            if (pet.manifest.spriteVersionNumber !== 2) throw new Error("look poses require a V2 pet");
            if (!value || !Number.isFinite(Number(value))) throw new Error("usage: /pet look <degrees>");
            preview = { index: lookIndex(Number(value)), until: Date.now() + 4000 };
          }
          animationState = undefined;
          refresh(true);
        } else if (["show", "hide", "renderer", "animate"].includes(action)) {
          const next = { ...settings };
          if (action === "show" || action === "hide") {
            if (action === "show" && !pet) throw new Error("choose or import a pet first");
            next.visible = action === "show";
          } else if (action === "renderer") {
            if (value !== "auto" && value !== "ansi") throw new Error("usage: /pet renderer auto|ansi");
            next.renderer = value;
          } else {
            if (value !== "on" && value !== "off") throw new Error("usage: /pet animate on|off");
            next.animate = value === "on";
          }
          await saveSettings(root, next);
          settings = next;
          restartTimer();
        } else {
          ctx.ui.notify(HELP, "info");
        }
      } catch (error) {
        ctx.ui.notify(`Pet: ${String(error)}`, "error");
      }
    },
  });
}
