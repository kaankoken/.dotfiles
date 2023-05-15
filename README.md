# Development Config

Personal working environment config 

## ZSH
ohmyzsh
```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
```

### Theme

[spaceship](https://spaceship-prompt.sh/getting-started/)

```bash
# Instal nerd fonts(Fira Code)

brew tap homebrew/cask-fonts
brew install --cask font-fira-mono-nerd-font

# Restarting the pc is required
```

```bash
git clone https://github.com/spaceship-prompt/spaceship-prompt.git "$ZSH_CUSTOM/themes/spaceship-prompt" --depth=1
ln -s "$ZSH_CUSTOM/themes/spaceship-prompt/spaceship.zsh-theme" "$ZSH_CUSTOM/themes/spaceship.zsh-theme"

# Replace default theme with spaceship
ZSH_THEME=“spaceship”

(Optional)
SPACESHIP_RUST_VERBOSE_VERSION=true

# Check font is installed
fc-list -f '%{file}\n' | sort | grep Fira

# If you encounter error (Fontconfig warning: ignoring UTF-8: not a valid region tag)
brew reinstall fontconfig
```

## Terminal

[alacritty](https://alacritty.org)
```bash
brew install --cask alacritty

# After install to macos for the first time [issue](https://github.com/alacritty/alacritty/issues/6500)
Application > (Right click to Alacritty) > Open
```

### Config

Create a `.config` folder under `$HOME` directory 
```bash
mkdir -p .config/alacritty

# Download the config from the repo
cp -r ~/Downloads/alacritty ~/.config/alacritty/

# Add terminfo for 24-bit color support on tmux

cd ~/.config/alacritty
sudo tic -xe alacritty,alacritty-direct extra/alacritty.info

# Close & re-open the terminal
```

## Terminal Multiplexer

[tmux](https://github.com/tmux/tmux/wiki)

```bash
# Install TPM (tmux plugin manager)
git clone https://github.com/tmux-plugins/tpm.git ~/.tmux/plugins/tpm

mkdir -p .config/tmux

# Download the config from the repo
cp -r ~/Downloads/tmux ~/.config/tmux/

# Run tmux in the terminal
tmux

# Hit Control(Ctrl) + b + I to install tmux plugins
# Either hit Control(Ctrl) + b + R or tmux source ~/.config/tmux/tmux.config
```
[Tmux cheatsheet](https://tmuxcheatsheet.com)

## Neovim

[neovim](https://neovim.io)

```bash
# Install neovim
brew install neovim

# Clone astronvim config
git clone --depth 1 https://github.com/AstroNvim/AstroNvim ~/.config/nvim

# Run neovim to initialize & quit after first initialization
nvim

# Copy the config
cp -r ~/Downloads/nvim ~/.config/nvim/lua/user/

# Re-run neovim & initialize user configs & quit
nvim

# Set alias for nvim as vim
echo '\nalias vim="nvim"' >> ~/.zshrc && source ~/.zshrc
