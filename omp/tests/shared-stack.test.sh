#!/usr/bin/env bash
# Assert agent-stack is OMP-only (no ~/.pi linking, no rtk init --agent pi).
set -euo pipefail

DOTFILES_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
STACK="$DOTFILES_ROOT/agent-stack"
OMP_DIR="$DOTFILES_ROOT/omp"
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

assert_not_match() {
  local name="$1" file="$2" pat="$3"
  if [[ ! -f "$file" ]]; then
    echo "FAIL $name (missing $file)"
    FAIL=$((FAIL + 1))
    return
  fi
  if rg -q "$pat" "$file"; then
    echo "FAIL $name (matched /$pat/ in $file)"
    FAIL=$((FAIL + 1))
  else
    echo "PASS $name"
    PASS=$((PASS + 1))
  fi
}

assert_match() {
  local name="$1" file="$2" pat="$3"
  if [[ ! -f "$file" ]]; then
    echo "FAIL $name (missing $file)"
    FAIL=$((FAIL + 1))
    return
  fi
  if rg -q "$pat" "$file"; then
    echo "PASS $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL $name (no /$pat/ in $file)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== shared-stack.test.sh ==="

# --- static source checks ---
assert "link_sh_exists" test -f "$STACK/link.sh"
assert_not_match "no_pi_agent_path" "$STACK/link.sh" '\.pi/agent'
assert_not_match "no_rtk_agent_pi" "$STACK/link.sh" 'rtk init.*--agent pi|--agent pi'
assert_not_match "no_install_pi_like" "$STACK/link.sh" 'install_pi_like'
assert_match "has_omp_link_helper" "$STACK/link.sh" 'install_omp_shared|~/\.omp/agent'
assert_match "links_omp_agents_shared" "$STACK/link.sh" 'AGENTS\.shared\.md'
assert_match "links_omp_rtk_md" "$STACK/link.sh" 'RTK\.md'
assert_match "links_rtk_extension" "$STACK/link.sh" 'rtk-omp-extension\.ts|extensions/rtk\.ts'

# renamed extension
assert "omp_extension_exists" test -f "$STACK/hooks/rtk-omp-extension.ts"
assert "pi_extension_gone" test ! -f "$STACK/hooks/rtk-pi-extension.ts"
assert_not_match "no_earendil_import" "$STACK/hooks/rtk-omp-extension.ts" '@earendil-works/pi-coding-agent'
assert_match "uses_omp_runtime_types" "$STACK/hooks/rtk-omp-extension.ts" '@oh-my-pi/pi-coding-agent'
assert_match "rtk_rewrite_only" "$STACK/hooks/rtk-omp-extension.ts" 'rtk.*rewrite|rewriteCommand'
assert_not_match "no_pi_fallback_copy" "$STACK/link.sh" 'from pi|\.pi/agent/extensions'

# docs: OMP yes, Pi host labels no (word boundary-ish)
for f in "$STACK/AGENTS.md" "$STACK/home.AGENTS.md" "$STACK/README.md" "$STACK/RTK.md" "$STACK/AGENTS.shared.md"; do
  if [[ -f "$f" ]]; then
    assert_match "docs_name_omp_$(basename "$f")" "$f" 'omp|Oh My Pi|OMP'
    # Fail if Pi is listed as an active host (not as historical word in "Oh My Pi")
    if rg -q '(^|[^y])\bPi\b|/pi/agent|--agent pi' "$f" && ! rg -q 'Oh My Pi' "$f"; then
      :
    fi
    # Active host docs must not promote Pi as a first-class host
    if rg -n 'Claude.*Pi|Pi ·|Pi,|Hosts:.*Pi|/pi/agent|agent pi' "$f" | rg -v 'Oh My Pi' >/dev/null 2>&1; then
      echo "FAIL docs_no_pi_host_$(basename "$f") (still names Pi as host)"
      FAIL=$((FAIL + 1))
    else
      echo "PASS docs_no_pi_host_$(basename "$f")"
      PASS=$((PASS + 1))
    fi
  fi
done

# no package installer invocation in link.sh
assert_not_match "no_omp_package_install" "$STACK/link.sh" 'omp install|bun add.*omp|brew install.*omp'

# --- dynamic: temp HOME — stow omp package first, then agent-stack host links ---
TMP_HOME="$(mktemp -d "${TMPDIR:-/tmp}/shared-stack-home.XXXXXX")"
export HOME="$TMP_HOME"
mkdir -p "$HOME/.omp/agent" "$HOME/.agents" "$HOME/.claude" "$HOME/.codex" "$HOME/.grok" "$HOME/.cursor/rules"
# reserved runtime
printf 'db\n' >"$HOME/.omp/agent/agent.db"

set +e
# Stow first so .omp/agent allowlist is package-owned (no conflict with stack injects)
stow_out="$(stow -t "$HOME" -d "$DOTFILES_ROOT" . 2>&1)"
rc3=$?
stow_out2="$(stow -t "$HOME" -d "$DOTFILES_ROOT" . 2>&1)"
rc4=$?
out1="$(bash "$STACK/link.sh" --no-rtk-init 2>&1)"
rc1=$?
out2="$(bash "$STACK/link.sh" --no-rtk-init 2>&1)"
rc2=$?
set -e

assert "stow_exit0" test "$rc3" -eq 0
assert "stow_idempotent" test "$rc4" -eq 0
if [[ "$rc3" -ne 0 ]]; then
  printf '%s\n' "$stow_out" | tail -20
fi
assert "stack_link_exit0" test "$rc1" -eq 0
assert "stack_link_idempotent" test "$rc2" -eq 0

# never created ~/.pi
assert "no_pi_dir_created" test ! -e "$HOME/.pi"

# OMP package via stow
assert "omp_config_linked" test -L "$HOME/.omp/agent/config.yml"
assert "omp_skills_linked" test -L "$HOME/.omp/agent/skills"
assert "omp_agents_shared_linked" test -L "$HOME/.omp/agent/AGENTS.shared.md"
assert "omp_rtk_linked" test -L "$HOME/.omp/agent/RTK.md"
assert "omp_rtk_ext_linked" test -e "$HOME/.omp/agent/extensions/rtk.ts"
assert "agent_db_survives" test -f "$HOME/.omp/agent/agent.db"

# extension target is omp rename
ext_target="$(readlink "$HOME/.omp/agent/extensions/rtk.ts" 2>/dev/null || readlink -f "$HOME/.omp/agent/extensions/rtk.ts" 2>/dev/null || true)"
# may be relative through package; resolve
ext_real="$(python3 -c "import os; print(os.path.realpath('$HOME/.omp/agent/extensions/rtk.ts'))")"
case "$ext_real" in
  *rtk-omp-extension.ts) assert "ext_points_omp" true ;;
  *) echo "FAIL ext_points_omp ($ext_real)"; FAIL=$((FAIL + 1)) ;;
esac

# preserve markers for "user edits" — worktree RTK/codex must still contain key phrases
assert_match "rtk_keeps_modern_toolkit" "$STACK/RTK.md" 'Bare modern tools are allowed|modern CLI'
assert_match "codex_keeps_shared_include" "$STACK/codex.AGENTS.md" '@AGENTS.shared.md'

rm -rf "$TMP_HOME"

echo "=== summary pass=$PASS fail=$FAIL ==="
if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
exit 0
