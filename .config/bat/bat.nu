if (which bat | is-not-empty) {
  $env.BAT_THEME = "rose-pine"
  $env.BAT_STYLE = "numbers,changes,header"
  $env.BAT_PAGER = "less -RF"
  $env.MANPAGER = "sh -c 'col -bx | bat -l man -p'"
  $env.MANROFFOPT = "-c"
}
