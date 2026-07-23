#!/usr/bin/env bash
# Install global agent instruction symlinks from .dotfiles/agent-stack.
# Idempotent. Backs up non-symlink targets once as *.bak-agent-stack.
#
# Usage:
#   ~/.dotfiles/agent-stack/link.sh
set -euo pipefail

STACK="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="${HOME:-}"
[ -n "$HOME_DIR" ] || { echo "HOME unset" >&2; exit 1; }

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

echo "agent-stack: $STACK"

# Canonical copies for tools that look at ~/.agents
link_one "$HOME_DIR/.agents/AGENTS.md" "$STACK/AGENTS.md"
link_one "$HOME_DIR/.agents/RTK.md" "$STACK/RTK.md"

# Claude Code (~/.claude often already points at .dotfiles/.claude)
install_host "$HOME_DIR/.claude" "$STACK/claude.CLAUDE.md" "CLAUDE.md"

# Codex (real dir with sessions — instruction files only)
install_host "$HOME_DIR/.codex" "$STACK/codex.AGENTS.md" "AGENTS.md"

# Grok (both casings)
install_host "$HOME_DIR/.grok" "$STACK/grok.Agents.md" "Agents.md"
link_one "$HOME_DIR/.grok/AGENTS.md" "$STACK/grok.Agents.md"

# Cursor alwaysApply rule
mkdir -p "$HOME_DIR/.cursor/rules"
link_one "$HOME_DIR/.cursor/rules/shared-agent-stack.mdc" "$STACK/cursor.shared-stack.mdc"

# $HOME AGENTS for home-walking hosts
install_host "$HOME_DIR" "$STACK/home.AGENTS.md" "AGENTS.md"

echo "done. Re-run after 'bd setup codex' if it rewrites ~/.codex/AGENTS.md."
