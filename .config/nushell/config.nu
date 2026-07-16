# config.nu — interactive shell configuration (loaded after env.nu)
# Official role: $env.config, aliases, custom commands, sources.
# PATH and tool env vars live in env.nu — do not re-declare them here.
# See: https://www.nushell.sh/book/configuration.html

# --- Shell options ---
$env.config.show_banner = false
$env.config.history.file_format = "sqlite"
$env.config.buffer_editor = "nvim"

# --- Aliases ---
alias vim = nvim
alias nu-open = open
alias open = ^open

# Flutter / Dart via FVM when present on PATH (env.nu)
alias flutter = fvm flutter
alias dart = fvm dart

# --- Integrations (env.nu generates init files) ---
source ~/.local/share/atuin/init.nu
# starship + asdf: vendor/autoload (generated in env.nu)

# --- Claude Code (personal profile via headroom) ---
def --wrapped claude [...args: string] {
    let json_link = $"($env.HOME)/.claude.json"
    let json_target = $"($env.HOME)/.dotfiles/.claude.json.personal"
    rm -f $json_link
    ln -s $json_target $json_link
    with-env { CLAUDE_CONFIG_DIR: $"($env.HOME)/.claude" } {
        ^headroom wrap claude ...$args
    }
}

# Alias kept for old muscle memory
def --wrapped claude-personal [...args: string] {
    claude ...$args
}

# --- Codex (via headroom by default) ---
def --wrapped codex [...args: string] {
    ^headroom wrap codex ...$args
}

def --wrapped codex-raw [...args: string] {
    ^codex ...$args
}

# --- Firebase multi-account helpers (personal / voluble only) ---
def --wrapped firebase [...args: string] {
    let voluble_dir = $"($env.HOME)/Desktop/voluble"
    let personal_dir = $"($env.HOME)/Desktop/personal"

    let config_base = $"($env.HOME)/.dotfiles/.config/configstore/firebase-tools.json"
    let config_link = $"($env.HOME)/.config/configstore/firebase-tools.json"

    let config_suffix = if ($env.PWD | str starts-with $voluble_dir) {
        "voluble"
    } else if ($env.PWD | str starts-with $personal_dir) {
        "personal"
    } else {
        "personal"
    }

    let target_config = $"($config_base).($config_suffix)"
    rm -f $config_link
    ln -s $target_config $config_link

    ^firebase ...$args
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
