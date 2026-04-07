# Environment variables and path settings for Nushell
use std/util "path add"

# Add Homebrew paths first
$env.PATH = ($env.PATH | prepend "/opt/homebrew/bin")  # For Apple Silicon Macs
$env.PATH = ($env.PATH | prepend "/usr/local/bin")     # For Intel Macs (as fallback)

# UV tools
$env.PATH = ($env.PATH | prepend $"($env.HOME)/.local/bin")

# Orb Stack
$env.PATH = ($env.PATH | prepend $"($env.HOME)/.orbstack/bin")

# Rust's Cargo
$env.CARGO_HOME = $"($env.HOME)/.cargo"
$env.PATH = ($env.PATH | prepend $"($env.CARGO_HOME)/bin")

# Go Environment
$env.GOENV_ROOT = $"($env.HOME)/.goenv"
$env.PATH = ($env.PATH | prepend $"($env.GOENV_ROOT)/bin")
$env.PATH = ($env.PATH | prepend $"($env.GOENV_ROOT)/shims")

# Ruby
$env.PATH = ($env.PATH | prepend "/opt/homebrew/opt/ruby/bin")
$env.LDFLAGS = "-L/opt/homebrew/opt/ruby/lib"
$env.CPPFLAGS = "-I/opt/homebrew/opt/ruby/include"

# asdf configuration
$env.ASDF_DIR = "/opt/homebrew/opt/asdf/libexec"
$env.PATH = ($env.PATH | prepend "/opt/homebrew/opt/asdf/libexec/bin")
$env.PATH = ($env.PATH | prepend $"($env.HOME)/.asdf/shims")

# Source asdf completions and setup
source /opt/homebrew/opt/asdf/libexec/asdf.nu

# pnpm
$env.PNPM_HOME = $"($env.HOME)/Library/pnpm"
$env.PATH = ($env.PATH | prepend $env.PNPM_HOME)

# lazygit
$env.PATH = ($env.PATH | prepend "/opt/homebrew/opt/lazygit/bin")

# Java
$env.JAVA_HOME = "/Applications/Android Studio.app/Contents/jbr/Contents/Home"

# FVM (Flutter Version Management)
$env.PATH = ($env.PATH | prepend $"($env.HOME)/fvm/default/bin")
$env.PATH = ($env.PATH | prepend $"($env.HOME)/.pub-cache/bin")

# Set COLORTERM for truecolor support
$env.COLORTERM = "truecolor"

# Starship configuration
mkdir ($nu.data-dir | path join "vendor/autoload")
starship init nu | save -f ($nu.data-dir | path join "vendor/autoload/starship.nu")

# Atuin configuration
# Create directory for Atuin if it doesn't exist
if not (ls ~/.local/share/atuin/ | is-empty) {
  mkdir ~/.local/share/atuin/
}

# Only initialize Atuin if the file doesn't exist yet
if not ("~/.local/share/atuin/init.nu" | path exists) {
  # Create the directory if it doesn't exist
  mkdir ~/.local/share/atuin
  # Create Atuin initialization file
  atuin init nu | save -f ~/.local/share/atuin/init.nu
}

source ~/.local/share/atuin/init.nu

# NVIM config
$env.PATH = ($env.PATH | prepend "/opt/homebrew/bin/nvim")
alias vim = nvim
$env.config.buffer_editor = "vim"

$env.config.show_banner = false
# Default file format for history
$env.config.history.file_format = "sqlite"

$env.CLAUDE_CODE_NO_FLICKER = "1"

# Claude Code with separate configs
def --wrapped claude-personal [...args: string] {
    let json_link = $"($env.HOME)/.claude.json"
    let json_target = $"($env.HOME)/.dotfiles/.claude.json.personal"
    rm -f $json_link
    ln -s $json_target $json_link
    with-env { CLAUDE_CONFIG_DIR: $"($env.HOME)/.claude" } {
        ^claude ...$args
    }
}

def --wrapped claude-work [...args: string] {
    let json_link = $"($env.HOME)/.claude.json"
    let json_target = $"($env.HOME)/.dotfiles/.claude.json.enterprise"
    rm -f $json_link
    ln -s $json_target $json_link
    with-env { CLAUDE_CONFIG_DIR: $"($env.HOME)/.claude-enterprise" } {
        ^claude ...$args
    }
}

# Auto-select Claude config based on directory
def --wrapped claude [...args: string] {
    let work_dir = $"($env.HOME)/Desktop/morfeu"
    let is_work = ($env.PWD | str starts-with $work_dir)

    let config_dir = if $is_work { $"($env.HOME)/.claude-enterprise" } else { $"($env.HOME)/.claude" }
    let json_suffix = if $is_work { "enterprise" } else { "personal" }

    let json_link = $"($env.HOME)/.claude.json"
    let json_target = $"($env.HOME)/.dotfiles/.claude.json.($json_suffix)"
    rm -f $json_link
    ln -s $json_target $json_link

    with-env { CLAUDE_CONFIG_DIR: $config_dir } {
        ^claude ...$args
    }
}

def claude-which [] {
    let json_link = $"($env.HOME)/.claude.json"
    let target = (ls -la $json_link | get target.0 | path basename)
    print $"Currently using: ($target)"
}

# Firebase with auto-select based on directory
def --wrapped firebase [...args: string] {
    let morfeu_dir = $"($env.HOME)/Desktop/morfeu"
    let voluble_dir = $"($env.HOME)/Desktop/voluble"
    let personal_dir = $"($env.HOME)/Desktop/personal"

    let config_base = $"($env.HOME)/.dotfiles/.config/configstore/firebase-tools.json"
    let config_link = $"($env.HOME)/.config/configstore/firebase-tools.json"

    let config_suffix = if ($env.PWD | str starts-with $morfeu_dir) {
        "morfeu"
    } else if ($env.PWD | str starts-with $voluble_dir) {
        "voluble"
    } else if ($env.PWD | str starts-with $personal_dir) {
        "personal"
    } else {
        "morfeu"  # default
    }

    # Update symlink if needed
    let target_config = $"($config_base).($config_suffix)"
    rm -f $config_link
    ln -s $target_config $config_link

    ^firebase ...$args
}

# Manual Firebase config switching
def firebase-morfeu [] {
    let config_path = $"($env.HOME)/.config/configstore/firebase-tools.json"
    let target_path = $"($env.HOME)/.dotfiles/.config/configstore/firebase-tools.json.morfeu"
    rm -f $config_path
    ln -s $target_path $config_path
    print "Switched to Firebase morfeu (kaan@morfeu.ai)"
}

def firebase-voluble [] {
    let config_path = $"($env.HOME)/.config/configstore/firebase-tools.json"
    let target_path = $"($env.HOME)/.dotfiles/.config/configstore/firebase-tools.json.voluble"
    rm -f $config_path
    ln -s $target_path $config_path
    print "Switched to Firebase voluble (kaan@voluble.co.uk)"
}

def firebase-personal [] {
    let config_path = $"($env.HOME)/.config/configstore/firebase-tools.json"
    let target_path = $"($env.HOME)/.dotfiles/.config/configstore/firebase-tools.json.personal"
    rm -f $config_path
    ln -s $target_path $config_path
    print "Switched to Firebase personal (bkakm@hotmail.com)"
}

def firebase-which [] {
    let config_path = $"($env.HOME)/.config/configstore/firebase-tools.json"
    let target = (ls -la $config_path | get target.0 | path basename)
    print $"Currently using: ($target)"
}
