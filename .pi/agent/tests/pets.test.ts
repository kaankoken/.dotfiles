import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ANIMATIONS, PetActivity, frameIndex, importPet, loadPet, lookIndex,
  normalizeManifest, readSettings, rgbaToAnsi, saveSettings,
} from "../extensions/pets/core.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("manifest uses exact V1/V2 geometry and rejects unsupported versions", () => {
  expect(normalizeManifest({ displayName: "Cat", spritesheetPath: "sheet.png" }, "cat").rows).toBe(9);
  expect(normalizeManifest({ displayName: "Cat", spriteVersionNumber: 2, spritesheetPath: "sheet.webp" }, "cat").rows).toBe(11);
  for (const version of [0, 3, "2", null]) {
    expect(() => normalizeManifest({ displayName: "Cat", spriteVersionNumber: version }, "cat")).toThrow("version");
  }
});

test("manifest rejects traversal, absolute paths, unsafe IDs, and non-image assets", () => {
  for (const path of ["../sheet.png", "/tmp/sheet.png", "nested/../../sheet.png", "C:\\sheet.png", "sheet.svg"]) {
    expect(() => normalizeManifest({ displayName: "Cat", spritesheetPath: path }, "cat")).toThrow();
  }
  expect(() => normalizeManifest({ id: "../cat", displayName: "Cat" }, "cat")).toThrow("id");
  expect(() => normalizeManifest([], "cat")).toThrow();
});

test("standard states respect used columns and Codex timings", () => {
  expect(Object.values(ANIMATIONS).map((animation) => animation.durations.length)).toEqual([6, 8, 8, 4, 5, 8, 6, 6, 6]);
  expect(frameIndex("waving", 0)).toBe(24);
  expect(frameIndex("waving", 139)).toBe(24);
  expect(frameIndex("waving", 140)).toBe(25);
  expect(frameIndex("waving", 700)).toBe(24);
  expect(frameIndex("waiting", 10_000) % 8).toBeLessThan(6);
  expect(frameIndex("idle", 1679)).toBe(0);
  expect(frameIndex("idle", 1680)).toBe(1);
});

test("all 16 V2 looks are clockwise from up, with wraparound", () => {
  for (let direction = 0; direction < 16; direction++) {
    expect(lookIndex(direction * 22.5)).toBe(72 + direction);
  }
  expect(lookIndex(90)).toBe(76);
  expect(lookIndex(180)).toBe(80);
  expect(lookIndex(270)).toBe(84);
  expect(lookIndex(360)).toBe(72);
  expect(lookIndex(-90)).toBe(84);
});

test("activity handles parallel and nested tools without returning idle early", () => {
  const activity = new PetActivity();
  activity.start();
  expect(activity.state(0)).toBe("review");
  activity.toolStart("outer");
  activity.toolStart("outer/1");
  activity.toolEnd("outer/1", false, 0);
  expect(activity.state(0)).toBe("running");
  activity.toolEnd("outer", false, 0);
  expect(activity.state(0)).toBe("review");
  activity.finish(0);
  expect(activity.state(0)).toBe("jumping");
  expect(activity.state(3000)).toBe("idle");
});

test("waiting and failures win; failed or aborted run never celebrates", () => {
  const activity = new PetActivity();
  activity.start();
  activity.toolStart("one");
  activity.promptStart("approval");
  expect(activity.state(0)).toBe("waiting");
  activity.promptEnd("approval");
  activity.toolEnd("one", true, 0);
  expect(activity.state(0)).toBe("failed");
  activity.finish(0);
  expect(activity.state(0)).toBe("failed");
  activity.start();
  activity.finish(0, true);
  expect(activity.state(0)).toBe("idle");
});

test("ANSI preserves transparent pixels without black backgrounds", () => {
  const data = Buffer.from([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0]);
  const lines = rgbaToAnsi(data, 2, 2);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("\x1b[38;2;255;0;0;48;2;0;0;255m▀");
  expect(lines[0]).toEndWith(" \x1b[0m");
});

async function fixture(version: 1 | 2 = 2, width = 1536, blankFrame = -1) {
  const root = await mkdtemp(join(tmpdir(), "pi-pets-test-"));
  dirs.push(root);
  const folder = join(root, "cat");
  await mkdir(folder);
  const height = version === 2 ? 2288 : 1872;
  const data = Buffer.alloc(width * height * 4);
  const indices = [
    ...Object.values(ANIMATIONS).flatMap(({ row, durations }) => durations.map((_, column) => row * 8 + column)),
    ...(version === 2 ? Array.from({ length: 16 }, (_, index) => 72 + index) : []),
  ];
  for (const index of indices) {
    if (index === blankFrame) continue;
    const color = Buffer.from([index, 100, 200, 255]);
    for (let y = 0; y < 208; y++) {
      const start = ((Math.floor(index / 8) * 208 + y) * width + (index % 8) * 192) * 4;
      data.fill(color, start, Math.min(start + 192 * 4, data.length));
    }
  }
  const sharp = createRequire(join(import.meta.dir, "../extensions/pets/package.json"))("sharp");
  await sharp(data, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toFile(join(folder, "spritesheet.webp"));
  await writeFile(join(folder, "pet.json"), JSON.stringify({
    id: "cat", displayName: "Cat", spriteVersionNumber: version, spritesheetPath: "spritesheet.webp",
  }));
  return folder;
}

test("V2 decoder extracts 73 required frames, including every look pose", async () => {
  const pet = await loadPet(await fixture());
  expect(pet.manifest.rows).toBe(11);
  expect(pet.frames.size).toBe(73);
  expect(pet.frames.has(6)).toBe(false);
  for (let index = 72; index < 88; index++) {
    const frame = pet.frames.get(index)!;
    expect(Buffer.from(frame.png, "base64").subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(frame.ansi).toHaveLength(4);
    expect(frame.ansi.join("")).toContain(`38;2;${index};100;200`);
  }
});

test("V1 decoder accepts legacy atlas with no look cells", async () => {
  const pet = await loadPet(await fixture(1));
  expect(pet.frames.size).toBe(57);
  expect(pet.frames.has(72)).toBe(false);
});

test("decoder rejects mismatched geometry, blank required cells, and escaping symlinks", async () => {
  await expect(loadPet(await fixture(2, 1535))).rejects.toThrow("1536x2288");
  await expect(loadPet(await fixture(2, 1536, 72))).rejects.toThrow("transparent");
  const folder = await fixture();
  const outside = join(folder, "..", "outside");
  await mkdir(outside);
  await writeFile(join(outside, "pet.json"), "{}");
  await rm(join(folder, "pet.json"));
  await symlink(join(outside, "pet.json"), join(folder, "pet.json"));
  await expect(loadPet(folder)).rejects.toThrow("inside");
});

test("import copies validated data without overwriting installed pets; settings stay private", async () => {
  const source = await fixture();
  const root = join(source, "..", "installed");
  const defaults = await readSettings(root);
  expect(defaults).toEqual({ selected: undefined, visible: true, renderer: "auto", animate: true });
  const pet = await importPet(source, root);
  expect(await readFile(join(root, "cat/spritesheet.webp"))).toEqual(await readFile(join(source, "spritesheet.webp")));
  await expect(importPet(source, root)).rejects.toThrow("already installed");
  const settings = { selected: pet.manifest.id, visible: false, renderer: "ansi" as const, animate: false };
  await saveSettings(root, settings);
  expect(await readSettings(root)).toEqual(settings);
  expect((await stat(join(root, "config.json"))).mode & 0o777).toBe(0o600);
  await writeFile(join(root, "config.json"), '{"selected":"../../escape"}');
  expect((await readSettings(root)).selected).toBeUndefined();
});

test("nested prompts of same kind remain waiting until both close", () => {
  const activity = new PetActivity();
  activity.start();
  activity.promptStart("custom");
  activity.promptStart("custom");
  activity.promptEnd("custom");
  expect(activity.state(0)).toBe("waiting");
  activity.promptEnd("custom");
  expect(activity.state(0)).toBe("review");
});

test("untrusted names and asset paths cannot inject terminal controls", () => {
  const escape = String.fromCharCode(27);
  expect(() => normalizeManifest({ displayName: `Cat${escape}[2J` }, "cat")).toThrow("printable");
  expect(() => normalizeManifest({ displayName: "Cat", spritesheetPath: `sheet${escape}.png` }, "cat")).toThrow("inside");
});
