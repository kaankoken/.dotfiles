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

export PATH="/Users/legolas/fvm/default/bin:$PATH"
alias flutter="fvm flutter"
alias dart="fvm dart"

# Ruby
export PATH="/opt/homebrew/opt/ruby/bin:$PATH"
export LDFLAGS="-L/opt/homebrew/opt/ruby/lib"
export CPPFLAGS="-I/opt/homebrew/opt/ruby/include"

# pnpm
export PNPM_HOME="/Users/legolas/Library/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
# pnpm end

# Java
export JAVA_HOME=/Applications/Android\ Studio.app/Contents/jbr/Contents/Home

# Ghostty

if [[ -n $GHOSTTY_RESOURCES_DIR ]]; then
  source "$GHOSTTY_RESOURCES_DIR"/shell-integration/zsh/ghostty-integration
fi
