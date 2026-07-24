# env.nu — environment for every Nu session (loaded before config.nu)
# Official role: PATH and env vars only. No aliases / custom commands / $env.config.
# See: https://www.nushell.sh/book/configuration.html

use std/util "path add"

# --- XDG ---
$env.XDG_CONFIG_HOME = $"($env.HOME)/.config"

# --- PATH (one ordered list; later prepends would invert priority) ---
# Determinate multi-user: bash loads this via /etc/bashrc → nix-daemon.sh;
# Nushell does not, so default profile must be listed here.
let managed_paths = ([
    $"/etc/profiles/per-user/($env.USER)/bin"   # home-manager (after nix-darwin)
    $"($env.HOME)/.nix-profile/bin"               # user nix profile
    "/nix/var/nix/profiles/default/bin"           # Determinate / multi-user nix
    "/run/current-system/sw/bin"                  # nix-darwin system path
    $"($env.HOME)/.local/bin"                     # agent CLIs (codex/rtk standalone), pi wrapper, uv tools
    $"($env.HOME)/.bun/bin"                       # bun globals (pi only — never codex)
    $"($env.HOME)/.cargo/bin"                     # rustup
    $"($env.HOME)/.orbstack/bin"                  # OrbStack
    $"($env.HOME)/Library/pnpm"                   # pnpm (macOS)
    $"($env.HOME)/fvm/default/bin"                # Flutter via FVM
    $"($env.HOME)/.pub-cache/bin"                 # Dart pub globals
    "/opt/homebrew/bin"                           # Homebrew (migration)
    "/opt/homebrew/opt/ruby/bin"                  # Homebrew ruby (optional)
    "/usr/local/bin"
] | where {|p| $p | path exists })

$env.PATH = ($managed_paths | append $env.PATH | uniq)

# --- Tool homes / flags ---
$env.CARGO_HOME = $"($env.HOME)/.cargo"
$env.COLORTERM = "truecolor"
$env.CLAUDE_CODE_NO_FLICKER = "1"

if ($"($env.HOME)/Library/pnpm" | path exists) {
    $env.PNPM_HOME = $"($env.HOME)/Library/pnpm"
}

if ("/opt/homebrew/opt/ruby/lib" | path exists) {
    $env.LDFLAGS = "-L/opt/homebrew/opt/ruby/lib"
    $env.CPPFLAGS = "-I/opt/homebrew/opt/ruby/include"
}

let android_jbr = "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
if ($android_jbr | path exists) {
    $env.JAVA_HOME = $android_jbr
}

# --- Generate vendor/autoload scripts (sourced automatically by Nu) ---
# Must run in env.nu so files exist before config / autoload phase.
let autoload_dir = ($nu.data-dir | path join "vendor/autoload")
mkdir $autoload_dir

if (which starship | is-not-empty) {
    starship init nu | save -f ($autoload_dir | path join "starship.nu")
}

if (which asdf | is-not-empty) {
    try {
        asdf completion nushell | save -f ($autoload_dir | path join "asdf.nu")
    }
}

# Atuin: write init for config.nu to `source` (atuin does not use vendor/autoload by default)
let atuin_init_file = ($env.HOME | path join ".local/share/atuin/init.nu")
mkdir ($atuin_init_file | path dirname)
if not ($atuin_init_file | path exists) {
    if (which atuin | is-not-empty) {
        atuin init nu | save -f $atuin_init_file
    } else {
        "# atuin not installed\n" | save -f $atuin_init_file
    }
}
