import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, sep, win32 } from "node:path";
import sharp from "sharp";

export const PET_COLUMNS = 12;
export const PET_ROWS = 4;
export const ANIMATIONS = {
  idle: { row: 0, durations: [1680, 660, 660, 840, 840, 1920] },
  "running-right": { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  "running-left": { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving: { row: 3, durations: [140, 140, 140, 280] },
  jumping: { row: 4, durations: [140, 140, 140, 140, 280] },
  failed: { row: 5, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, durations: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, durations: [150, 150, 150, 150, 150, 280] },
} as const;
export type PetState = keyof typeof ANIMATIONS;
export type PetSettings = { selected?: string; visible: boolean; renderer: "auto" | "ansi"; animate: boolean };
export type PetManifest = {
  id: string; displayName: string; description: string;
  spriteVersionNumber: 1 | 2; spritesheetPath: string; rows: 9 | 11;
};
export type PetFrame = { png: string; ansi: string[] };
export type LoadedPet = {
  manifest: PetManifest; folder: string; asset: Buffer; format: "png" | "webp"; frames: Map<number, PetFrame>;
};

export function validId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

export function normalizeManifest(raw: unknown, fallbackId: string): PetManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("pet.json must be an object");
  const data = raw as Record<string, unknown>;
  const id = data.id ?? fallbackId;
  if (typeof id !== "string" || !validId(id)) throw new Error("pet id must use lowercase letters, numbers, and hyphens (max 64)");
  const name = data.displayName;
  if (typeof name !== "string" || !name.trim() || name.length > 80 || Array.from(name).some((char) => { const code = char.charCodeAt(0); return code < 32 || (code >= 127 && code <= 159); })) {
    throw new Error("displayName must be printable text (1–80 characters)");
  }
  const version = data.spriteVersionNumber === undefined ? 1 : data.spriteVersionNumber;
  if (version !== 1 && version !== 2) throw new Error("unsupported sprite version; expected 1 or 2");
  const asset = data.spritesheetPath ?? "spritesheet.webp";
  if (typeof asset !== "string" || asset.length > 1024 || Array.from(asset).some((char) => char.charCodeAt(0) < 32) || isAbsolute(asset) || win32.isAbsolute(asset) ||
      asset.split(/[/\\]/).includes("..") || asset.includes("\0") ||
      ![".png", ".webp"].includes(extname(asset).toLowerCase())) {
    throw new Error("spritesheetPath must be a relative PNG/WebP path inside the pet folder");
  }
  return {
    id, displayName: name.trim(),
    description: typeof data.description === "string" ? data.description.slice(0, 1000) : "",
    spriteVersionNumber: version, spritesheetPath: asset, rows: version === 2 ? 11 : 9,
  };
}

async function packageFile(root: string, path: string, maxBytes: number): Promise<Buffer> {
  const full = await realpath(join(root, path));
  const child = relative(root, full);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error("pet files must stay inside the pet folder");
  const info = await stat(full);
  if (!info.isFile() || info.size > maxBytes) throw new Error(`invalid or oversized pet file: ${path}`);
  const bytes = await readFile(full);
  if (bytes.length > maxBytes) throw new Error(`oversized pet file: ${path}`);
  return bytes;
}

export function frameIndex(state: PetState, elapsedMs: number): number {
  const { row, durations } = ANIMATIONS[state];
  let elapsed = Math.max(0, elapsedMs) % durations.reduce<number>((sum, duration) => sum + duration, 0);
  for (let column = 0; column < durations.length; column++) {
    if (elapsed < durations[column]) return row * 8 + column;
    elapsed -= durations[column];
  }
  return row * 8;
}

export function lookIndex(degrees: number): number {
  return 72 + Math.round(((degrees % 360 + 360) % 360) / 22.5) % 16;
}

export function rgbaToAnsi(data: Uint8Array, width: number, height: number): string[] {
  const lines: string[] = [];
  for (let y = 0; y < height; y += 2) {
    let line = "";
    for (let x = 0; x < width; x++) {
      const top = (y * width + x) * 4;
      const bottom = ((y + 1) * width + x) * 4;
      const a = data[top + 3] >= 128;
      const b = y + 1 < height && data[bottom + 3] >= 128;
      const color = (offset: number) => `${data[offset]};${data[offset + 1]};${data[offset + 2]}`;
      if (a && b) line += `\x1b[38;2;${color(top)};48;2;${color(bottom)}m▀`;
      else if (a || b) line += `\x1b[49;38;2;${color(a ? top : bottom)}m${a ? "▀" : "▄"}`;
      else line += "\x1b[0m ";
    }
    lines.push(line + "\x1b[0m");
  }
  return lines;
}

export async function loadPet(folder: string): Promise<LoadedPet> {
  const root = await realpath(folder);
  const raw = await packageFile(root, "pet.json", 64 * 1024);
  const manifest = normalizeManifest(JSON.parse(raw.toString("utf8")), basename(root));
  const asset = await packageFile(root, manifest.spritesheetPath, 32 * 1024 * 1024);
  const image = sharp(asset, { limitInputPixels: 4_000_000, failOn: "error" });
  const metadata = await image.metadata();
  if (metadata.format !== "png" && metadata.format !== "webp") throw new Error("pet asset must decode as PNG or WebP");
  if (metadata.width !== 1536 || metadata.height !== manifest.rows * 208 || (metadata.pages ?? 1) !== 1) {
    throw new Error(`V${manifest.spriteVersionNumber} spritesheet must be 1536x${manifest.rows * 208}; got ${metadata.width}x${metadata.height}`);
  }
  const decoded = await image.ensureAlpha().raw().toBuffer();
  const indices = [
    ...Object.values(ANIMATIONS).flatMap(({ row, durations }) => durations.map((_, column) => row * 8 + column)),
    ...(manifest.rows === 11 ? Array.from({ length: 16 }, (_, index) => 72 + index) : []),
  ];
  const frames = new Map<number, PetFrame>();
  for (const index of indices) {
    // Decode atlas once; process frames sequentially to bound peak native memory.
    const cell = sharp(decoded, { raw: { width: 1536, height: manifest.rows * 208, channels: 4 } })
      .extract({ left: index % 8 * 192, top: Math.floor(index / 8) * 208, width: 192, height: 208 });
    const rgba = await cell.clone().raw().toBuffer();
    let visible = false;
    for (let offset = 3; offset < rgba.length; offset += 4) {
      if (rgba[offset] > 0) { visible = true; break; }
    }
    if (!visible) throw new Error(`required frame ${index} is fully transparent`);
    const png = await cell.clone().png().toBuffer();
    const pixels = await cell.clone()
      .resize(PET_COLUMNS, PET_ROWS * 2, { fit: "contain", kernel: "nearest", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw().toBuffer();
    frames.set(index, { png: png.toString("base64"), ansi: rgbaToAnsi(pixels, PET_COLUMNS, PET_ROWS * 2) });
  }
  return { manifest, folder: root, asset, format: metadata.format, frames };
}

export async function importPet(folder: string, root: string): Promise<LoadedPet> {
  const pet = await loadPet(folder);
  await mkdir(root, { recursive: true });
  const destination = join(root, pet.manifest.id);
  try { await mkdir(destination); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`pet ${pet.manifest.id} already installed; use /pet choose ${pet.manifest.id}`);
    throw error;
  }
  const filename = `spritesheet.${pet.format}`;
  const { rows: _rows, ...manifest } = pet.manifest;
  manifest.spritesheetPath = filename;
  try {
    await writeFile(join(destination, filename), pet.asset, { flag: "wx" });
    await writeFile(join(destination, "pet.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
  return { ...pet, folder: destination, manifest: { ...pet.manifest, spritesheetPath: filename } };
}

export async function readSettings(root: string): Promise<PetSettings> {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse((await packageFile(await realpath(root), "config.json", 8192)).toString("utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") raw = {};
    else throw error;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("pet config must be an object");
  return {
    selected: typeof raw.selected === "string" && validId(raw.selected) ? raw.selected : undefined,
    visible: raw.visible !== false, renderer: raw.renderer === "ansi" ? "ansi" : "auto", animate: raw.animate !== false,
  };
}

export async function saveSettings(root: string, settings: PetSettings): Promise<void> {
  await mkdir(root, { recursive: true });
  const temporary = join(root, `.config-${randomUUID()}.json`);
  try {
    await writeFile(temporary, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, join(root, "config.json"));
  } finally {
    await rm(temporary, { force: true });
  }
}

export class PetActivity {
  busy = false;
  private tools = new Set<string>();
  private prompts = new Map<string, number>();
  private failed = false;
  private speaking = false;
  private reaction: PetState = "idle";
  private reactionUntil = 0;

  start(): void {
    this.busy = true;
    this.failed = false;
    this.speaking = false;
    this.reactionUntil = 0;
    this.tools.clear();
  }
  text(thinking = false): void { this.speaking = !thinking; }
  toolStart(id: string): void { this.tools.add(id); }
  toolEnd(id: string, isError: boolean, now = Date.now()): void {
    this.tools.delete(id);
    if (isError) this.fail(now);
  }
  promptStart(kind: string): void { this.prompts.set(kind, (this.prompts.get(kind) ?? 0) + 1); }
  promptEnd(kind: string): void {
    const count = (this.prompts.get(kind) ?? 0) - 1;
    if (count > 0) this.prompts.set(kind, count);
    else this.prompts.delete(kind);
  }
  fail(now = Date.now()): void {
    this.failed = true;
    this.react("failed", now);
  }
  react(state: PetState, now = Date.now()): void {
    this.reaction = state;
    this.reactionUntil = now + 2500;
  }
  finish(now = Date.now(), aborted = false): void {
    const wasBusy = this.busy;
    this.busy = false;
    this.tools.clear();
    this.prompts.clear();
    this.react(this.failed ? "failed" : aborted || !wasBusy ? "idle" : "jumping", now);
  }
  state(now = Date.now()): PetState {
    if (this.prompts.size) return "waiting";
    if (now < this.reactionUntil) return this.reaction;
    if (this.tools.size) return "running";
    return this.busy ? this.speaking ? "waving" : "review" : "idle";
  }
}
