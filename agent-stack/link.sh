#!/usr/bin/env bash
# Install global agent instruction symlinks + RTK hooks from .dotfiles/agent-stack.
# Idempotent. Backs up non-symlink targets once as *.bak-agent-stack.
#
# Hosts: Claude Code, Codex, Grok, Cursor, Oh My Pi (~/.omp), ~/AGENTS.md
#
# Usage:
#   ~/.dotfiles/agent-stack/link.sh
#   ~/.dotfiles/agent-stack/link.sh --no-rtk-init   # skip rtk init vendor hooks
set -euo pipefail

STACK="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="${HOME:-}"
[ -n "$HOME_DIR" ] || { echo "HOME unset" >&2; exit 1; }

DO_RTK_INIT=1
for arg in "$@"; do
  case "$arg" in
    --no-rtk-init) DO_RTK_INIT=0 ;;
    -h|--help)
      echo "Usage: $0 [--no-rtk-init]"
      exit 0
      ;;
  esac
done

link_one() {
  local target="$1"
  local source="$2"
  local dir cur resolved_cur resolved_src

  if [ ! -e "$source" ] && [ ! -L "$source" ]; then
    echo "skip (missing source): $source" >&2
    return 1
  fi

  dir="$(dirname "$target")"
  mkdir -p "$dir"

  if [ -L "$target" ]; then
    cur="$(readlink "$target")"
    resolved_src="$(realpath "$source")"
    if [[ "$cur" = /* ]]; then
      resolved_cur="$(realpath "$cur" 2>/dev/null || true)"
    else
      resolved_cur="$(realpath "$dir/$cur" 2>/dev/null || true)"
    fi
    if [ "$resolved_cur" = "$resolved_src" ] || [ "$cur" = "$source" ]; then
      echo "ok  $target"
      return 0
    fi
    rm -f "$target"
  elif [ -e "$target" ]; then
    if [ ! -e "${target}.bak-agent-stack" ]; then
      mv "$target" "${target}.bak-agent-stack"
      echo "bak $target -> ${target}.bak-agent-stack"
    else
      rm -f "$target"
      echo "rm  $target (backup already exists)"
    fi
  fi

  ln -s "$source" "$target"
  echo "ln  $target -> $source"
}

# Host wrappers @include AGENTS.shared.md + RTK.md from the same directory.
install_host() {
  local host_dir="$1"
  local wrapper_src="$2"
  local wrapper_name="$3"

  mkdir -p "$host_dir"
  link_one "$host_dir/$wrapper_name" "$wrapper_src"
  link_one "$host_dir/AGENTS.shared.md" "$STACK/AGENTS.md"
  link_one "$host_dir/RTK.md" "$STACK/RTK.md"
}

# Oh My Pi shared instructions + RTK extension (never create or touch other hosts here).
install_omp_shared() {
  local agent_dir="$HOME_DIR/.omp/agent"

  if [ ! -d "$agent_dir" ]; then
    mkdir -p "$agent_dir"
    echo "mkdir $agent_dir (Oh My Pi)"
  fi

  link_one "$agent_dir/RTK.md" "$STACK/RTK.md"
  link_one "$agent_dir/AGENTS.shared.md" "$STACK/AGENTS.md"

  # Prefer shared stack when AGENTS.md is missing or a regular file we own; never replace nix-store HM links.
  if [ -L "$agent_dir/AGENTS.md" ]; then
    local dest
    dest="$(readlink "$agent_dir/AGENTS.md" || true)"
    case "$dest" in
      /nix/store/*)
        echo "ok  $agent_dir/AGENTS.md (home-manager; see AGENTS.shared.md + RTK.md)"
        ;;
      *)
        # Leave stow-managed AGENTS.md (dotfiles .omp/agent → omp tree) alone if already correct.
        echo "ok  $agent_dir/AGENTS.md (existing link)"
        ;;
    esac
  elif [ ! -e "$agent_dir/AGENTS.md" ]; then
    link_one "$agent_dir/AGENTS.md" "$STACK/AGENTS.md"
  else
    echo "keep $agent_dir/AGENTS.md (existing file)"
  fi

  # RTK extension lives in omp/extensions/rtk.ts (stow package). Only inject when
  # extensions is a real directory (legacy) and the file is missing.
  if [ -f "$STACK/hooks/rtk-omp-extension.ts" ]; then
    if [ -L "$agent_dir/extensions" ]; then
      echo "ok  $agent_dir/extensions (stow package; rtk.ts from omp/extensions)"
    else
      mkdir -p "$agent_dir/extensions"
      link_one "$agent_dir/extensions/rtk.ts" "$STACK/hooks/rtk-omp-extension.ts"
    fi
  fi
}

install_grok_hooks() {
  local hooks_dir="$HOME_DIR/.grok/hooks"
  mkdir -p "$hooks_dir"
  chmod +x "$STACK/hooks/rtk-shell-rewrite.sh"
  link_one "$hooks_dir/rtk-shell.json" "$STACK/hooks/grok-rtk.json"
}

run_rtk_init() {
  if [ "$DO_RTK_INIT" -ne 1 ]; then
    echo "skip rtk init (--no-rtk-init)"
    return 0
  fi
  if ! command -v rtk >/dev/null 2>&1; then
    echo "warn: rtk not on PATH — skip rtk init" >&2
    return 0
  fi

  # --hook-only: never write RTK.md (rtk init follows symlinks and would clobber agent-stack/RTK.md).
  echo "rtk init --hook-only (claude / cursor)…"
  rtk init -g --auto-patch --hook-only || true
  rtk init -g --agent cursor --auto-patch --hook-only || true
  # Codex: do not run rtk init --codex — fights our AGENTS.md symlink; RTK.md via link_one.
}

echo "agent-stack: $STACK"

# Canonical copies for tools that look at ~/.agents
link_one "$HOME_DIR/.agents/AGENTS.md" "$STACK/AGENTS.md"
link_one "$HOME_DIR/.agents/RTK.md" "$STACK/RTK.md"

# Claude Code
install_host "$HOME_DIR/.claude" "$STACK/claude.CLAUDE.md" "CLAUDE.md"

# Codex
install_host "$HOME_DIR/.codex" "$STACK/codex.AGENTS.md" "AGENTS.md"

# Grok (both casings)
install_host "$HOME_DIR/.grok" "$STACK/grok.Agents.md" "Agents.md"
link_one "$HOME_DIR/.grok/AGENTS.md" "$STACK/grok.Agents.md"
install_grok_hooks

# Cursor alwaysApply rule
mkdir -p "$HOME_DIR/.cursor/rules"
link_one "$HOME_DIR/.cursor/rules/shared-agent-stack.mdc" "$STACK/cursor.shared-stack.mdc"

# $HOME AGENTS for home-walking hosts
install_host "$HOME_DIR" "$STACK/home.AGENTS.md" "AGENTS.md"

# Oh My Pi only (no other agent-host creation)
install_omp_shared

run_rtk_init

# Re-assert RTK.md symlinks after rtk init (vendor may write a plain file).
link_one "$HOME_DIR/.claude/RTK.md" "$STACK/RTK.md"
link_one "$HOME_DIR/.codex/RTK.md" "$STACK/RTK.md"
link_one "$HOME_DIR/.grok/RTK.md" "$STACK/RTK.md"
link_one "$HOME_DIR/.agents/RTK.md" "$STACK/RTK.md"
[ -d "$HOME_DIR/.omp/agent" ] && link_one "$HOME_DIR/.omp/agent/RTK.md" "$STACK/RTK.md"

echo "done. Hosts: claude codex grok cursor omp home."
echo "Re-run after 'bd setup codex' if it rewrites ~/.codex/AGENTS.md."
