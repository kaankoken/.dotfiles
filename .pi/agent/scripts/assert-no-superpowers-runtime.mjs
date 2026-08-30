#!/usr/bin/env bun
/**
 * Runtime gate: Pi DefaultPackageManager resolve against current agent settings.
 * Fails if enabled resources include /superpowers/ or cold Bigpowers skills/prompts.
 * Bigpowers must remain installed on disk for absolute path-loads.
 */
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";

const agentDir = process.env.PI_AGENT_DIR || join(homedir(), ".pi", "agent");
const cwd = process.env.PI_AGENT_ROOT || process.cwd();

const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
const resolved = await packageManager.resolve(async () => "skip");

const failures = [];
const enabledSkills = resolved.skills.filter((r) => r.enabled);
const enabledPrompts = resolved.prompts.filter((r) => r.enabled);

for (const r of enabledSkills) {
  if (r.path.includes("/superpowers/") || r.path.includes("skills/superpowers")) {
    failures.push(`enabled Superpowers skill: ${r.path} (source=${r.metadata?.source ?? "?"})`);
  }
}
for (const r of enabledPrompts) {
  if (r.path.includes("/superpowers/")) {
    failures.push(`enabled Superpowers prompt: ${r.path}`);
  }
}

const isBigpowers = (r) => {
  const src = String(r.metadata?.source ?? "");
  return src.includes("bigpowers") || r.path.includes("/bigpowers/");
};

const coldBpSkills = enabledSkills.filter(isBigpowers);
const coldBpPrompts = enabledPrompts.filter(isBigpowers);
if (coldBpSkills.length > 0) {
  failures.push(
    `cold Bigpowers skills enabled (${coldBpSkills.length}); want path-load-only skills:[] — e.g. ${coldBpSkills[0].path}`,
  );
}
if (coldBpPrompts.length > 0) {
  failures.push(
    `cold Bigpowers prompts enabled (${coldBpPrompts.length}); want prompts:[] — e.g. ${coldBpPrompts[0].path}`,
  );
}

const global = settingsManager.getGlobalSettings();
const packages = global.packages ?? [];
const bpEntry = packages.find((p) => {
  const src = typeof p === "string" ? p : p?.source;
  return typeof src === "string" && src.includes("bigpowers");
});
if (!bpEntry) {
  failures.push("settings.packages missing npm:bigpowers entry");
} else if (typeof bpEntry === "string") {
  failures.push(
    `bigpowers package is bare string ${JSON.stringify(bpEntry)}; need object filter skills:[] prompts:[]`,
  );
} else {
  const skills = bpEntry.skills;
  const prompts = bpEntry.prompts;
  if (!Array.isArray(skills) || skills.length !== 0) {
    failures.push(`bigpowers.skills must be [] (got ${JSON.stringify(skills)})`);
  }
  if (!Array.isArray(prompts) || prompts.length !== 0) {
    failures.push(`bigpowers.prompts must be [] (got ${JSON.stringify(prompts)})`);
  }
}

const skillGlobs = global.skills ?? [];
const hasSpExclude = skillGlobs.some(
  (g) => typeof g === "string" && g.includes("superpowers") && g.startsWith("!"),
);
if (!hasSpExclude) {
  failures.push('settings.skills must include "!skills/superpowers/**" (or equivalent ! exclude)');
}

if (failures.length) {
  console.error("RUNTIME FAIL: Superpowers/cold Bigpowers resolve gate");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}

console.log(
  `OK: runtime — enabled skills=${enabledSkills.length}, Superpowers=0, cold Bigpowers skills/prompts=0`,
);
