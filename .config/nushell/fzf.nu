# fzf
$env.FZF_CTRL_R_COMMAND = ""   # keep Atuin on Ctrl-R

$env.FZF_DEFAULT_OPTS = "--height 40% --layout=reverse --border --preview 'bat --color=always --style=numbers --line-range=:500 {}'"
$env.FZF_CTRL_T_OPTS = "--preview 'bat --color=always --style=numbers --line-range=:500 {}'"

if (which fd | is-not-empty) {
  $env.FZF_DEFAULT_COMMAND = "fd --type f --hidden --follow --exclude .git"
  $env.FZF_CTRL_T_COMMAND = $env.FZF_DEFAULT_COMMAND
}

if (which fzf | is-not-empty) {
  let fzf_init = ($nu.default-config-dir | path join "autoload/_fzf_integration.nu")
  mkdir ($fzf_init | path dirname)
  fzf --nushell | save -f $fzf_init
}
