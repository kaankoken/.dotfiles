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
