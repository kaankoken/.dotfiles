# Dotfiles

Personal dotfiles used for development.

> **Note:**
>
> Run `stow` after installing all necessary packages below to symlink

## GNU Stow

Creating symlink between the system & the `.dotfiles` folder.

- [Installation](https://github.com/aspiers/stow)

```bash
# MacOS
brew install stow

# Arch Linux
pacman -S stow
```

- Usage

```bash
# Clone the repo
git clone git@github.com:kaankoken/.dotfiles.git

# Move it under home
mv -r .dotfiles ~/.dotfiles
cd ~/.dotfiles

# Run stow
stow --adopt .
```

## ZSH

- Installation

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
```

## Spaceship

- [Installation](https://spaceship-prompt.sh/getting-started/)

```bash
git clone https://github.com/spaceship-prompt/spaceship-prompt.git "$ZSH_CUSTOM/themes/spaceship-prompt" --depth=1
ln -s "$ZSH_CUSTOM/themes/spaceship-prompt/spaceship.zsh-theme" "$ZSH_CUSTOM/themes/spaceship.zsh-theme"
```

### Assign Theme to ZSH

```bash
# Set in .zshrc
ZSH_THEME="spaceship"
```

## Alacritty

- [Installation](https://alacritty.org)

```bash
brew install --cask alacritty

# After install to macos for the first time [issue](https://github.com/alacritty/alacritty/issues/6500)
Application > (Right click to Alacritty) > Open
```

### Font

- Installation

```bash
# Fira Code
brew tap homebrew/cask-fonts
brew install --cask font-fira-mono-nerd-font

# Check font is installed
fc-list -f '%{file}\n' | sort | grep Fira

# If you encounter error (Fontconfig warning: ignoring UTF-8: not a valid region tag)
brew reinstall fontconfig
```

## [Tmux](https://github.com/tmux/tmux/wiki)

- Installation

```bash
brew install tmux

# Install TPM (tmux plugin manager)
git clone https://github.com/tmux-plugins/tpm.git ~/.tmux/plugins/tpm
```

- Running

```bash
# Run tmux in the terminal
tmux

# Hit Control(Ctrl) + b + I to install tmux plugins
# Either hit Control(Ctrl) + b + R or tmux source ~/.config/tmux/tmux.config
```

## Neovim (Astronvim)

- Installation

```bash
# Install neovim
brew install neovim

# Clone astronvim config
git clone --depth 1 https://github.com/AstroNvim/AstroNvim ~/.config/nvim

# Run neovim to initialize & quit after first initialization
nvim
```
- Add alias

```bash
# Set alias for nvim as vim
echo '\nalias vim="nvim"' >> ~/.zshrc && source ~/.zshrc
```

### Ripgrep

```bash
cargo install ripgrep
```

### Lazygit

```bash
brew install lazygit
```

## Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

- Install `cargo-unused-features`

```bash
cargo install cargo-unused-features
```

- Install `cross`

```bash
brew install llvm
cargo install cross --git https://github.com/cross-rs/cross
```

- Install `git-cliff`

```bash
cargo install --git https://github.com/orhun/git-cliff
```

- Install `typos`

```bash
cargo install typos-cli
```

- Install `sccache`

```bash
cargo install sccache
```

- Install `bacon`

```bash
cargo install bacon
```

## Go

```bash
brew install go
```

### goenv

```bash
git clone https://github.com/go-nv/goenv.git ~/.goenv
```

