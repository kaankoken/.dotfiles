import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

let host = dirname(realpathSync("/opt/homebrew/bin/pi"));
while (host !== dirname(host) && !existsSync(join(host, "core/extensions/loader.js"))) host = dirname(host);
const { loadExtensions } = await import(join(host, "core/extensions/loader.js"));
const { CustomEditor } = await import(join(host, "index.js"));
const { CURSOR_MARKER, setCapabilities, getCapabilities, visibleWidth } = await import(
  join(host, "../node_modules/@earendil-works/pi-tui/dist/index.js")
);
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("real Pi loader and editor preserve input, shortcuts, V2 previews, and cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-pets-ui-"));
  dirs.push(root);
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  const oldCaps = getCapabilities();
  let extension;
  try {
    process.env.PI_CODING_AGENT_DIR = root;
    const loaded = await loadExtensions([join(import.meta.dir, "../extensions/pets/index.ts")], root);
    expect(loaded.errors).toEqual([]);
    extension = loaded.extensions[0];
  } finally {
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  }

  const notices: Array<{ text: string; kind: string }> = [];
  let overlay = false;
  let renders = 0;
  let escapes = 0;
  const tui = { requestRender: () => renders++, hasOverlay: () => overlay, terminal: { columns: 90, rows: 30 } };
  const theme = { borderColor: (text: string) => text, selectList: {} };
  const bindings = { matches: (data: string, action: string) => data === "\x1b" && action === "app.interrupt" };
  const baseFactory = () => {
    const editor = new CustomEditor(tui, theme, bindings);
    editor.onEscape = () => escapes++;
    return editor;
  };
  let editor = baseFactory();
  editor.setText("你好 prompt");
  let factory = baseFactory;
  const ctx = {
    mode: "tui", hasUI: true, cwd: root,
    ui: {
      getEditorComponent: () => factory,
      setEditorComponent: (next: typeof factory) => {
        const text = editor.getText();
        factory = next;
        editor = (next ?? baseFactory)(tui, theme, bindings);
        editor.setText(text);
        editor.focused = true;
      },
      getEditorText: () => editor.getExpandedText(),
      setEditorText: (text: string) => editor.setText(text),
      notify: (text: string, kind: string) => notices.push({ text, kind }),
      select: async () => undefined,
    },
  } as unknown as ExtensionContext;

  async function emit(name: string, event = {}) {
    for (const handler of extension.handlers.get(name) ?? []) await handler(event, ctx);
  }
  const command = extension.commands.get("pet")!;
  try {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    await emit("session_start");
    expect(editor.getText()).toBe("你好 prompt");
    const noPet = editor.render(90);
    expect(noPet.some((line: string) => line.includes("\x1b_G"))).toBe(false);

    const sharp = createRequire(join(import.meta.dir, "../extensions/pets/package.json"))("sharp");
    await sharp({ create: { width: 1536, height: 2288, channels: 4, background: { r: 80, g: 160, b: 220, alpha: 1 } } })
      .png().toFile(join(root, "sheet.png"));
    await writeFile(join(root, "pet.json"), JSON.stringify({
      id: "ui-cat", displayName: "UI Cat", spriteVersionNumber: 2, spritesheetPath: "sheet.png",
    }));
    await command.handler(`import "${root}"`, ctx);
    expect(notices.filter((notice) => notice.kind === "error")).toEqual([]);
    const config = JSON.parse(await readFile(join(root, "pets/config.json"), "utf8"));
    expect(config.selected).toBe("ui-cat");

    const native = editor.render(90);
    expect(native.some((line: string) => line.includes("\x1b_G"))).toBe(true);
    expect(native.join("")).toContain(CURSOR_MARKER);
    expect(native.every((line: string) => visibleWidth(line) <= 90)).toBe(true);
    editor.handleInput("x");
    expect(editor.getText()).toBe("你好 promptx");
    editor.handleInput("\x1b");
    expect(escapes).toBe(1);

    for (const degrees of [0, 90, 180, 270]) await command.handler(`look ${degrees}`, ctx);
    await command.handler("renderer ansi", ctx);
    const ansi = editor.render(90);
    expect(ansi.join("")).not.toContain("\x1b_G");
    expect(ansi.join("")).toContain("▀");
    expect(ansi.every((line: string) => visibleWidth(line) <= 90)).toBe(true);

    const narrow = editor.render(40);
    expect(narrow.join("")).not.toContain("▀");
    expect(narrow.every((line: string) => visibleWidth(line) <= 40)).toBe(true);
    overlay = true;
    expect(editor.render(90).join("")).not.toContain("▀");
    overlay = false;

    await command.handler("hide", ctx);
    expect(editor.render(90).join("")).not.toContain("▀");
    await command.handler("show", ctx);
    await command.handler("animate off", ctx);
    await command.handler("preview running-left", ctx);
    expect(editor.render(90).join("")).toContain("▀");
    expect(editor.getText()).toBe("你好 promptx");
    expect(renders).toBeGreaterThan(0);
    await emit("session_shutdown");
    expect(factory).toBe(baseFactory);
    const before = renders;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(renders).toBe(before);
  } finally {
    await emit("session_shutdown");
    setCapabilities(oldCaps);
  }
});

test("print mode does not replace editor or start UI resources", async () => {
  const loaded = await loadExtensions([join(import.meta.dir, "../extensions/pets/index.ts")], process.cwd());
  let replaced = false;
  const ctx = { mode: "print", hasUI: false, ui: { setEditorComponent: () => { replaced = true; } } };
  for (const handler of loaded.extensions[0].handlers.get("session_start") ?? []) await handler({}, ctx);
  expect(replaced).toBe(false);
});
