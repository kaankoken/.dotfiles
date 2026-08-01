#!/usr/bin/env bash
# Contract: OMP agent allowlist is a stow package under .dotfiles/.omp/agent
# (no omp/link.sh). Runtime state stays untracked on the live ~/.omp/agent.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DOTFILES="$(CDPATH= cd -- "$ROOT/.." && pwd)"
PKG="$DOTFILES/.omp/agent"
PASS=0
FAIL=0

assert() {
  local name="$1"
  shift
  if "$@"; then
    echo "PASS $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL $name"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== stow-package.test.sh ==="

assert "package_dir" test -d "$PKG"
assert "no_omp_link_sh" test ! -e "$ROOT/link.sh"

ALLOWLIST=(
  config.yml
  AGENTS.md
  mcp.json
  agents
  commands
  extensions
  skills
  AGENTS.shared.md
  RTK.md
)

for name in "${ALLOWLIST[@]}"; do
  p="$PKG/$name"
  assert "symlink_$name" test -L "$p"
  if [[ -L "$p" ]]; then
    target="$(readlink "$p")"
    case "$target" in
      /*) echo "FAIL relative_$name (absolute: $target)"; FAIL=$((FAIL + 1)) ;;
      *) echo "PASS relative_$name"; PASS=$((PASS + 1)) ;;
    esac
    # resolve through package dir
    resolved="$(CDPATH= cd -- "$PKG" && python3 -c "import os; print(os.path.realpath('$name'))")"
    assert "resolves_$name" test -e "$resolved"
  fi
done

assert "rtk_in_extensions" test -L "$ROOT/extensions/rtk.ts"
rtk_resolved="$(CDPATH= cd -- "$ROOT/extensions" && python3 -c "import os; print(os.path.realpath('rtk.ts'))")"
assert "rtk_resolves" test -f "$rtk_resolved"

assert "architect_skill" test -f "$ROOT/skills/architect/SKILL.md"
assert "package_skills_architect" test -f "$PKG/skills/architect/SKILL.md"

# Stow into a throwaway HOME — allowlist appears; reserved runtime survives if pre-created
TMP_HOME="$(mktemp -d "${TMPDIR:-/tmp}/omp-stow-home.XXXXXX")"
mkdir -p "$TMP_HOME/.omp/agent"
printf 'db\n' >"$TMP_HOME/.omp/agent/agent.db"
printf 'auth\n' >"$TMP_HOME/.omp/agent/auth.json"
mkdir -p "$TMP_HOME/.omp/agent/sessions"

set +e
stow_out="$(stow -t "$TMP_HOME" -d "$DOTFILES" . 2>&1)"
stow_rc=$?
set -e
assert "stow_exit0" test "$stow_rc" -eq 0
if [[ "$stow_rc" -ne 0 ]]; then
  printf '%s\n' "$stow_out" | tail -20
fi

live="$TMP_HOME/.omp/agent"
assert "stowed_config" test -L "$live/config.yml"
assert "stowed_skills" test -L "$live/skills"
assert "stowed_extensions" test -L "$live/extensions"
assert "stowed_rtk_ext" test -e "$live/extensions/rtk.ts"
assert "db_survives" test -f "$live/agent.db"
assert "auth_survives" test -f "$live/auth.json"
assert "sessions_survive" test -d "$live/sessions"
assert "architect_runtime" test -f "$live/skills/architect/SKILL.md"

# Idempotent restow
set +e
stow -t "$TMP_HOME" -d "$DOTFILES" . >/dev/null 2>&1
stow_rc2=$?
set -e
assert "stow_idempotent" test "$stow_rc2" -eq 0

rm -rf "$TMP_HOME"

echo "=== summary pass=$PASS fail=$FAIL ==="
if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
exit 0
