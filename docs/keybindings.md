
# Keybindings cheat sheet

**Rule of thumb:** `Cmd` = windows (AeroSpace) · `Ctrl` = panes/tabs (Zellij) · `Space` = editor (Neovim)

Turkish Q: do **not** use Option/Alt for these. Left Option stays for typing; Ghostty uses Right Option as Alt.

Machine-readable copy: [`.config/keybinds/keybinds.json`](../.config/keybinds/keybinds.json)  
Launcher: `bin/show-keybinds <app>` (Swift cheatsheet app when installed)

---

## Help / cheatsheet

| App | Keys |
|-----|------|
| AeroSpace | `Cmd+/` · or `Cmd+;` then `i` or `/` |
| Zellij | `Ctrl+/` · or `Ctrl+a` then `i` or `/` |
| Ghostty | (uses AeroSpace when focused; see Ghostty section in JSON) |
| Neovim | `Space` then follow which-key · `<Leader>?` planned |

---

## AeroSpace (Cmd)

### Daily

| Keys | Action |
|------|--------|
| `Cmd+h/j/k/l` | Focus |
| `Cmd+Shift+h/j/k/l` | Move window |
| `Cmd+1`…`7` | Workspace N |
| `Cmd+Shift+1`…`7` | Send window to workspace N |
| `Cmd+Shift+p` / `n` | Workspace prev / next |
| `Cmd+Shift+Tab` | Back and forth |
| `Cmd+-` / `=` | Resize smart |
| `Cmd+Ctrl+s` / `g` | Monitor focus left / right |
| `Cmd+/` | Cheatsheet |
| `Cmd+;` | Leader |

### Leader (`Cmd+;` then …)

| Keys | Action |
|------|--------|
| `h/j/k/l` | Join/merge |
| `s` / `v` / `o` | Layout h_tiles / v_tiles / toggle tiles orientation |
| `w` then `h/j/k/l` | Swap |
| `f` | Float / tile |
| `m` | Fullscreen |
| `e` | Balance |
| `r` | Reload config |
| `b` | Close others |
| `i` or `/` | Cheatsheet |
| `Esc` | Cancel |

---

## Zellij (Ctrl)

### Daily

| Keys | Action |
|------|--------|
| `Ctrl+h/j/k/l` | Focus pane |
| `Ctrl+Shift+h/j/k/l` | Move pane |
| `Ctrl+1`…`5` | Tab N |
| `Ctrl+[` / `Ctrl+]` | Prev / next tab *(recommended)* |
| `Ctrl+Shift+Left` / `Right` | Prev / next tab |
| `Ctrl+Left` / `Right` | Prev / next tab *(often broken: macOS Spaces steals these — disable Mission Control “Move left/right a space” if you want them)* |
| `Ctrl+t` | New tab |
| `Ctrl+w` | Close pane |
| `Ctrl+-` / `=` | Resize |
| `Ctrl+g` | Lock / unlock |
| `Ctrl+/` | Cheatsheet |
| `Ctrl+a` | Leader (status bar may say “tmux” — Zellij internal name only) |
| `Ctrl+o` | Session mode |

### Leader (`Ctrl+a` then …)

| Keys | Action |
|------|--------|
| `h/j/k/l` | Split (new pane) that way |
| `n` | New pane |
| `x` | Close pane |
| `f` | Floating |
| `z` | Zoom |
| `r` | Rename current tab |
| `a` | zj-agents sidebar (floating agent list) |
| `w` then `h/j/k/l` | Move pane |
| `i` or `/` | Cheatsheet |
| `Esc` | Cancel |

### Session (`Ctrl+o` then …)

| Keys | Action |
|------|--------|
| `w` or `s` | Session manager (switch / attach UI) |
| `d` | Detach |
| `Esc` | Cancel |

---

## Ghostty

- All listed **Cmd** AeroSpace chords are `ignore` (pass-through).
- **No** terminal splits here — use Zellij.
- `macos-option-as-alt = right`
