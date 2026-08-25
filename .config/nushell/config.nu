$env.config.show_banner = false
$env.config.history.file_format = "sqlite"
$env.config.buffer_editor = "nvim"

# --- Aliases ---
alias vim = nvim
alias nu-open = open
alias open = ^open
alias update-tools = ^update-tools.nu

# bat (if not already in sourced bat.nu)
alias cat = ^bat
alias batp = ^bat --plain
alias batl = ^bat --style=plain --paging=never

# --- Integrations ---
source ~/.local/share/atuin/init.nu
source ~/.config/nushell/.zoxide.nu

def --wrapped pi [...args: string] {
  ^bun $"($env.HOME)/.bun/bin/pi" ...$args
}
