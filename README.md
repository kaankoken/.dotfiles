# Configuration

Quick log of what we configured.

---

## 1. Install tools

```bash
# Homebrew (if needed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval "$(/opt/homebrew/bin/brew shellenv)"

# Core packages
brew install nushell stow
```

## 2. Set Default Terminal

```bash
# Add to allow list
echo $(which nu) | sudo tee -a /etc/shells

# Change login shell
chsh -s $(which nu)
```

## 3. Clone Configurations from Git

```nu
# Clone / update
git clone git@github.com:kaankoken/.dotfiles.git ~/.dotfiles
cd ~/.dotfiles
stow .

```

## 4. Atuin

```bash
rm ~/.local/share/atuin/init.nu
mkdir ~/.local/share/atuin
atuin init nu | save -f ~/.local/share/atuin/init.nu
```
