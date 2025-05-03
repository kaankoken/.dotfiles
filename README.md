# Dotfiles

Personal dotfiles used for development.

> **Note:**
>
> Run `stow` after installing all necessary packages below to symlink

## Nu Shell

`zsh` alternative

- [Installation](https://www.nushell.sh/book/installation.html)

```bash
brew install nushell
```

- Default Shell

```bash
echo /opt/homebrew/bin/nu | sudo tee -a /etc/shells
chsh -s /opt/homebrew/bin/nu

# Restart your computer
```
- Ghostty Integration

```bash
# Add these two lines to ghostty config
command = /opt/homebrew/bin/nu -l --config ~/.config/nushell/config.nu --env-config ~/.config/nushell/env.nu
```

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

cd ~/.dotfiles

# Run stow
stow .
```

## Font

- Installation

```bash
# Fira Code
brew install --cask font-fira-mono-nerd-font
brew install --cask font-jetbrains-mono-nerd-font

# check the installed fonts & packages
brew list
```

## Atuin (shell history)

```bash
brew install atuin
```

### Sync history with existing history

```bash
atuin key # use this on existing machine & get the key
atuin login
# enter username
# enter password
# enter key

atuin sync -fA
```

## Spaceship

- [Installation](https://spaceship-prompt.sh/getting-started/)

```bash
brew install starship
```

### Startup via zsh

```bash
echo 'eval "$(starship init zsh)"' >> ~/.dotfiles/.zshrc
stow .
source ~/.zshrc
```

## Wezterm

- [Installation](https://wezfurlong.org/wezterm/install/macos.html)

```bash
brew install --cask wezterm
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
# Purge existing installation
rm -rf ~/.dotfiles/.config/tmux/plugins/

# Run tmux in the terminal
tmux

# Hit Control(Ctrl) + b + I to install tmux plugins
# Either hit Control(Ctrl) + b + R or tmux source ~/dotfies/.config/tmux/tmux.config
```

## Neovim (Astronvim)

- Installation

```bash
# Install neovim
brew install neovim

# Unlink utf8proc
brew unlink utf8proc

# Re-install utf8proc
brew install --HEAD utf8proc

# Clone astronvim config
git clone --depth 1 https://github.com/AstroNvim/AstroNvim ~/.dotfiles/.config/nvim

# Run neovim to initialize & quit after first initialization
nvim
```

- Add alias

```bash
# Set alias for nvim as vim
echo '\nalias vim="nvim"' >> ~/.zshrc
stow .
source ~/.zshrc
```

## Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## Rust Based Tools

### Ripgrep

```bash
brew install ripgrep
```

### Lazygit

```bash
brew install lazygit
```

### cargo-unused-features
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
cargo install bacon --loced
```

- Install `msrv`

```bash
cargo install cargo-msrv
```

- Install `cargo-nextest`

```bash
cargo install cargo-nextest --locked
```

- Install `cargo-mutants`

```bash
cargo install cargo-mutants --locked

# if cargo-nextest installed
cargo mutants --test-tool=nextest
```

- Install `cargo-unused-features`

```bash
cargo install cargo-unused-features --locked
```

- Install `cargo-tarpaulin`

```bash
cargo install cargo-tarpaulin --locked
```

- Install `cargo-update`

```bash
cargo install cargo-update

# Check installed binaries outdated
cargo install-update -l

# Update all binaries
cargo install-update --all
```

## goenv

```bash
git clone https://github.com/go-nv/goenv.git ~/.goenv

# Restart shell
exec $SHELL
```

### Install go

```bash
goenv install x.xx.x

# set global
goenv global x.xx.x
```

## NVM

```bash
brew install nvm

# Create a folder if does not exist
mkdir -p ~/.nvm

nvm install --lts
```

### Pnpm

```bash
brew install pnpm
```
