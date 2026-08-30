#!/usr/bin/env bash
# Static + runtime gate: no Superpowers path-loads; Bigpowers cold skills/prompts off.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"
export PI_AGENT_ROOT="$ROOT"
export PI_AGENT_DIR="$AGENT_DIR"

python3 - <<'PY'
from pathlib import Path
import os
import re
import sys

root = Path(os.environ["PI_AGENT_ROOT"])
patterns = [
    re.compile(r"using-superpowers"),
    re.compile(r"requiredSuperpowers"),
    re.compile(r"~/.agents/skills/superpowers/[a-zA-Z]"),
    re.compile(r"skills/superpowers/[a-zA-Z]"),
    re.compile(r"const SUPERPOWERS\s*="),
]
# Allow explicit forbid strings and the gate script itself.
allow_line = re.compile(
    r"(Never path-load|forbidden|assert-no-superpowers|!skills/superpowers|"
    r"Superpowers removed|no Superpowers|Not dual-installed|Superpowers \()"
)
skip_dirs = {"vendor", "node_modules", "npm", ".git", "tests", "sessions", "bin"}
bad = []
for p in root.rglob("*"):
    if not p.is_file() or any(s in p.parts for s in skip_dirs):
        continue
    if p.suffix not in {".md", ".ts", ".yml", ".yaml", ".json", ".tmpl", ".sh"}:
        continue
    # scripts/assert-no-superpowers.sh contains patterns by design
    if p.name in {"assert-no-superpowers.sh", "assert-no-superpowers-runtime.mjs"}:
        continue
    try:
        text = p.read_text(encoding="utf-8")
    except Exception:
        continue
    for i, line in enumerate(text.splitlines(), 1):
        if allow_line.search(line):
            continue
        if any(pat.search(line) for pat in patterns):
            bad.append(f"{p.relative_to(root)}:{i}:{line.strip()[:120]}")
if bad:
    print("STATIC FAIL: Superpowers runtime path-loads in the agent tree", file=sys.stderr)
    print("\n".join(bad), file=sys.stderr)
    raise SystemExit(1)
print("OK: static — no Superpowers runtime path-loads in the agent tree")
PY

# Runtime resolve via Pi SDK (DefaultPackageManager) against current agent settings.
exec bun "$ROOT/scripts/assert-no-superpowers-runtime.mjs"
