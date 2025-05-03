# Config file for Nushell

# First, import the path add utility if not done in env.nu
use std/util "path add"

# Set config path to ~/.config
let-env XDG_CONFIG_HOME = $"($env.HOME)/.config"

# Flutter and Dart aliases using fvm
alias flutter = fvm flutter
alias dart = fvm dart

alias nu-open = open
alias open = ^open

# Initialize Starship prompt
def create_left_prompt [] {
    starship prompt --cmd-duration $env.CMD_DURATION_MS $'--status=($env.LAST_EXIT_CODE)'
}

# Use Nushell functions to define your left prompt
$env.PROMPT_COMMAND = { || create_left_prompt }

# Set right prompt (empty for now)
$env.PROMPT_COMMAND_RIGHT = ""

# Initialize NVM if the script exists
def --env load-nvm [] {
    if ($env.NVM_DIR | path exists) and ("/usr/local/opt/nvm/nvm.sh" | path exists) {
        # This is a simplification - might need to create a custom command to properly source nvm
        zsh -c "source /usr/local/opt/nvm/nvm.sh && node -v" | str trim | load-env { NODE_VERSION: $in }
        echo "NVM loaded, using Node" $env.NODE_VERSION
    }
}

# Call the nvm loader
load-nvm

# Initialize goenv if it's installed
if not (which goenv | is-empty) {
    # This gets more complex in Nushell and might require a custom plugin
    # For now, we'll just add the path
    if ($env | get -i GOENV_ROOT) != null {
        let goenv_root = $env.GOENV_ROOT
        $env.PATH = ($env.PATH | prepend $"($goenv_root)/shims")
    }
}
