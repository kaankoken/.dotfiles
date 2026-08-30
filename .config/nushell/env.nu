$env.XDG_CONFIG_HOME = $"($env.HOME)/.config"

let managed_paths = ([
    "/opt/homebrew/bin"
    $"($env.HOME)/.bin"
    $"($env.HOME)/.bun/bin"
    $"($env.HOME)/.cargo/bin"
    $"($env.HOME)/.atuin/bin"
    $"($env.HOME)/.uv/bin"
    $"($env.HOME)/.local/bin"
] | where {|p| $p | path exists })

$env.PATH = ($managed_paths | append $env.PATH | uniq)

$env.CARGO_HOME = $"($env.HOME)/.cargo"
$env.COLORTERM = "truecolor"
$env.STARSHIP_CONFIG = $"($env.HOME)/.config/starship/starship.toml"
$env.HELIX_RUNTIME = $"($env.HOME)/Desktop/personal/helix-steel/runtime"

# Starship → vendor autoload
let autoload_dir = ($nu.data-dir | path join "vendor/autoload")
mkdir $autoload_dir
if (which starship | is-not-empty) {
  starship init nu | save -f ($autoload_dir | path join "starship.nu")
}

# Atuin init file (for config.nu to source)
let atuin_init_file = ($env.HOME | path join ".local/share/atuin/init.nu")
mkdir ($atuin_init_file | path dirname)
let atuin_bin = $"($env.HOME)/.atuin/bin/atuin"
if (($atuin_bin | path exists) or (which atuin | is-not-empty)) {
  let needs = (not ($atuin_init_file | path exists)) or (
    ($atuin_init_file | path exists) and ((ls $atuin_init_file).0.size < 100b)
  )
  if $needs {
    if ($atuin_bin | path exists) { ^$atuin_bin init nu --disable-up-arrow | save -f $atuin_init_file } else { ^atuin init nu --disable-up-arrow | save -f $atuin_init_file }
  }
}

# zoxide generate
let zoxide_init = $"($env.HOME)/.config/nushell/.zoxide.nu"
if (which zoxide | is-not-empty) {
  zoxide init nushell --cmd cd | save -f $zoxide_init
}

# modular tool env
source ~/.config/nushell/fzf.nu
source ~/.config/bat/bat.nu
