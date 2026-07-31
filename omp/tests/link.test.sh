#!/usr/bin/env bash
# Ownership / safety tests for omp/link.sh
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LINKER="$ROOT/link.sh"
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

if [[ ! -f "$LINKER" ]]; then
  echo "FAIL linker missing at $LINKER"
  exit 1
fi

# Fixture tree: copy minimal tracked sources into temp omp + agent-stack
setup_fixture() {
  local base="$1"
  mkdir -p "$base/omp"/{agents,commands,extensions,skills} \
    "$base/agent-stack" \
    "$base/live"
  # tracked sources
  printf 'config\n' >"$base/omp/config.yml"
  printf 'agents-local\n' >"$base/omp/AGENTS.md"
  printf 'mcp\n' >"$base/omp/mcp.json"
  printf 'a\n' >"$base/omp/agents/x.md"
  cp "$ROOT"/agents/pr-{fable-reviewer,sol-reviewer,grok-judge}.md \
    "$base/omp/agents/"
  printf 'c\n' >"$base/omp/commands/x.md"
  printf 'e\n' >"$base/omp/extensions/x.ts"
  printf 's\n' >"$base/omp/skills/x.md"
  printf 'shared\n' >"$base/agent-stack/AGENTS.shared.md"
  printf 'rtk\n' >"$base/agent-stack/RTK.md"
  # reserved runtime files that must survive
  printf 'SECRET-db\n' >"$base/live/agent.db"
  printf 'SECRET-auth\n' >"$base/live/auth.json"
  mkdir -p "$base/live/sessions" "$base/live/cache"
  printf 'sess\n' >"$base/live/sessions/s1"
  printf 'cache\n' >"$base/live/cache/c1"
  printf 'unknown-keep\n' >"$base/live/weird.dat"
  # conflicting regular file for backup test
  printf 'old-config\n' >"$base/live/config.yml"
}

run_link() {
  local base="$1"
  env OMP_AGENT_DIR="$base/live" \
    bash "$base/omp/link.sh"
}

checksum() {
  # portable sha
  shasum -a 256 "$1" | awk '{print $1}'
}

echo "=== link.test.sh ==="

# Case: missing source fails
case_missing_source() {
  local base
  base="$(mktemp -d "${TMPDIR:-/tmp}/omp-link.XXXXXX")"
  setup_fixture "$base"
  # Point linker at fixture by copying link.sh that uses fixture OMP_ROOT —
  # invoke real linker from ROOT but we need OMP_ROOT = fixture omp.
  # Implement: run with a wrapper that replaces OMP_ROOT via copying link into fixture
  cp "$LINKER" "$base/omp/link.sh"
  chmod +x "$base/omp/link.sh"
  rm -f "$base/omp/config.yml"
  set +e
  out="$(env OMP_AGENT_DIR="$base/live" bash "$base/omp/link.sh" 2>&1)"
  rc=$?
  set -e
  assert "missing_source_nonzero" test "$rc" -ne 0
  assert "missing_source_no_dangle" test ! -e "$base/live/config.yml" -o ! -L "$base/live/config.yml"
  # restore for isolation
  rm -rf "$base"
}

case_backup_and_allowlist() {
  local base
  base="$(mktemp -d "${TMPDIR:-/tmp}/omp-link.XXXXXX")"
  setup_fixture "$base"
  cp "$LINKER" "$base/omp/link.sh"
  chmod +x "$base/omp/link.sh"
  # preserve reserved hashes
  local h_db h_auth h_sess h_cache h_weird
  h_db="$(checksum "$base/live/agent.db")"
  h_auth="$(checksum "$base/live/auth.json")"
  h_sess="$(checksum "$base/live/sessions/s1")"
  h_cache="$(checksum "$base/live/cache/c1")"
  h_weird="$(checksum "$base/live/weird.dat")"

  set +e
  env OMP_AGENT_DIR="$base/live" bash "$base/omp/link.sh"
  rc=$?
  set -e
  assert "link_exit0" test "$rc" -eq 0

  # backup of conflicting regular file
  assert "backup_created" test -f "$base/live/config.yml.bak-omp-dotfiles"
  assert "backup_content" test "$(cat "$base/live/config.yml.bak-omp-dotfiles")" = "old-config"

  # allowlisted links
  realp() { python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"; }
  omp_abs="$(realp "$base/omp")"
  stack_abs="$(realp "$base/agent-stack")"
  for name in config.yml AGENTS.md mcp.json agents commands extensions skills; do
    assert "link_${name}" test -L "$base/live/$name"
    resolved="$(realp "$base/live/$name")"
    case "$resolved" in
      "$omp_abs"/*|"$omp_abs") assert "target_in_omp_${name}" true ;;
      *) echo "FAIL target_in_omp_${name} ($resolved not under $omp_abs)"; FAIL=$((FAIL+1)) ;;
    esac
  done
  for role in pr-fable-reviewer pr-sol-reviewer pr-grok-judge; do
    assert "global_${role}_exists" test -f "$base/live/agents/$role.md"
    resolved="$(realp "$base/live/agents/$role.md")"
    assert "global_${role}_target" test "$resolved" = "$omp_abs/agents/$role.md"
  done
  for name in AGENTS.shared.md RTK.md; do
    assert "link_${name}" test -L "$base/live/$name"
    resolved="$(realp "$base/live/$name")"
    case "$resolved" in
      "$stack_abs"/*|"$stack_abs") assert "target_in_stack_${name}" true ;;
      *) echo "FAIL target_in_stack_${name} ($resolved not under $stack_abs)"; FAIL=$((FAIL+1)) ;;
    esac
  done

  # reserved survive
  assert "agent_db" test "$(checksum "$base/live/agent.db")" = "$h_db"
  assert "auth_json" test "$(checksum "$base/live/auth.json")" = "$h_auth"
  assert "sessions" test "$(checksum "$base/live/sessions/s1")" = "$h_sess"
  assert "cache" test "$(checksum "$base/live/cache/c1")" = "$h_cache"
  assert "weird" test "$(checksum "$base/live/weird.dat")" = "$h_weird"

  # never replace .omp or agent dir itself — agent dir is live; parent is not deleted
  assert "agent_dir_is_dir" test -d "$base/live"

  # idempotent second run
  set +e
  env OMP_AGENT_DIR="$base/live" bash "$base/omp/link.sh"
  rc2=$?
  set -e
  assert "idempotent_exit0" test "$rc2" -eq 0
  assert "backup_once" test -f "$base/live/config.yml.bak-omp-dotfiles"
  # no second backup with different name
  assert "no_double_bak" test ! -f "$base/live/config.yml.bak-omp-dotfiles.bak-omp-dotfiles"
  assert "agent_db_after" test "$(checksum "$base/live/agent.db")" = "$h_db"

  rm -rf "$base"
}

case_refuse_second_overwrite() {
  local base
  base="$(mktemp -d "${TMPDIR:-/tmp}/omp-link.XXXXXX")"
  setup_fixture "$base"
  cp "$LINKER" "$base/omp/link.sh"
  chmod +x "$base/omp/link.sh"
  # pre-existing backup and a NEW regular conflict that would need overwrite
  printf 'old-config\n' >"$base/live/config.yml"
  printf 'already-backed\n' >"$base/live/config.yml.bak-omp-dotfiles"
  # After first link, config is a symlink. For refuse: second different regular
  # file that already has backup — simulate by unlinking and writing regular again
  env OMP_AGENT_DIR="$base/live" bash "$base/omp/link.sh" >/dev/null 2>&1 || true
  # Now force a regular file again with backup present
  rm -f "$base/live/config.yml"
  printf 'newer-regular\n' >"$base/live/config.yml"
  set +e
  out="$(env OMP_AGENT_DIR="$base/live" bash "$base/omp/link.sh" 2>&1)"
  rc=$?
  set -e
  assert "refuse_nonzero" test "$rc" -ne 0
  assert "refuse_keeps_regular" test -f "$base/live/config.yml" -a ! -L "$base/live/config.yml"
  assert "refuse_content" test "$(cat "$base/live/config.yml")" = "newer-regular"
  rm -rf "$base"
}

case_missing_source
case_backup_and_allowlist
case_refuse_second_overwrite

echo "=== summary pass=$PASS fail=$FAIL ==="
if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
exit 0
