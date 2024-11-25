# Starship
eval "$(starship init zsh)"

# Truecolor
export COLORTERM=truecolor

# Neovim alias
alias vim="nvim"

# goenv
eval "$(goenv init -)"

# NVM
## Loads nvm
export NVM_DIR="$HOME/.nvm"
[ -s "/usr/local/opt/nvm/nvm.sh" ] && . "/usr/local/opt/nvm/nvm.sh"

## This loads nvm bash_completion
[ -s "/usr/local/opt/nvm/etc/bash_completion.d/nvm" ] && . "/usr/local/opt/nvm/etc/bash_completion.d/nvm"

eval "source $(brew --prefix nvm)/nvm.sh"

# Atuin
eval "$(atuin init zsh --disable-up-arrow)"

# FVM
## [Completion]
## Completion scripts setup. Remove the following line to uninstall
[[ -f /Users/legolas/.dart-cli-completion/zsh-config.zsh ]] && . /Users/legolas/.dart-cli-completion/zsh-config.zsh || true
## [/Completion]

alias flutter="fvm flutter"
alias dart="fvm dart"
