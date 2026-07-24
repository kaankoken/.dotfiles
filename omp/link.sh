#!/usr/bin/env sh
# Safe linker: wire ~/.omp/agent allowlist to ~/.dotfiles/omp (+ agent-stack).
# Never touches credentials content; never replaces .omp or .omp/agent itself.
set -eu

OMP_AGENT_DIR="${OMP_AGENT_DIR:-${HOME}/.omp/agent}"
OMP_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
STACK_ROOT="$(CDPATH= cd -- "$OMP_ROOT/../agent-stack" && pwd)"

log() { printf '%s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

# name:source_root pairs — OMP-local vs shared stack
# shellcheck disable=SC2039
link_one() {
  _name="$1"
  _src_root="$2"
  _src="$_src_root/$_name"
  _dst="$OMP_AGENT_DIR/$_name"

  if [ ! -e "$_src" ]; then
    die "missing tracked source: $_src"
  fi

  # Already correct symlink → idempotent
  if [ -L "$_dst" ]; then
    _cur="$(readlink "$_dst")"
    # Compare canonical targets
    _src_abs="$(CDPATH= cd -- "$(dirname -- "$_src")" && pwd)/$(basename -- "$_src")"
    case "$_cur" in
      /*) _cur_abs="$_cur" ;;
      *) _cur_abs="$(CDPATH= cd -- "$(dirname -- "$_dst")" && CDPATH= cd -- "$(dirname -- "$_cur")" 2>/dev/null && pwd)/$(basename -- "$_cur")" || _cur_abs="$_cur" ;;
    esac
    if [ "$_cur_abs" = "$_src_abs" ] || [ "$_cur" = "$_src" ] || [ "$_cur" = "$_src_abs" ]; then
      return 0
    fi
    # Wrong symlink — remove and relink (not a regular-file backup case)
    rm -f "$_dst"
  fi

  if [ -e "$_dst" ] || [ -L "$_dst" ]; then
    if [ -d "$_dst" ] && [ ! -L "$_dst" ]; then
      die "refusing to replace directory: $_dst"
    fi
    if [ -f "$_dst" ] && [ ! -L "$_dst" ]; then
      _bak="${_dst}.bak-omp-dotfiles"
      if [ -e "$_bak" ]; then
        die "backup exists, refusing overwrite: $_dst and $_bak"
      fi
      mv "$_dst" "$_bak"
      log "backed up $_dst -> $_bak"
    fi
  fi

  ln -s "$_src" "$_dst"
  log "linked $_dst -> $_src"
}

# Refuse to operate if OMP_AGENT_DIR is the .omp root or missing parent
case "$OMP_AGENT_DIR" in
  */.omp|*/.omp/) die "refusing to use .omp root as agent dir: $OMP_AGENT_DIR" ;;
esac

mkdir -p "$OMP_AGENT_DIR"

# OMP-specific allowlist from OMP_ROOT
for _entry in config.yml AGENTS.md mcp.json agents commands extensions skills; do
  link_one "$_entry" "$OMP_ROOT"
done

# Shared stack
link_one "AGENTS.shared.md" "$STACK_ROOT"
link_one "RTK.md" "$STACK_ROOT"

log "omp link complete → $OMP_AGENT_DIR"
exit 0
