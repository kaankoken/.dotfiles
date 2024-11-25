-- bar.lua
local wezterm = require("wezterm")
local bar = wezterm.plugin.require("https://github.com/adriankarlen/bar.wezterm")

local M = {}

M.setup = function()
  local config = {
    position = "bottom",
    max_width = 32,
    padding = {
      left = 1,
      right = 1,
    },
    separator = {
      space = 1,
      left_icon = wezterm.nerdfonts.fa_long_arrow_right,
      right_icon = wezterm.nerdfonts.fa_long_arrow_left,
      field_icon = wezterm.nerdfonts.indent_line,
    },
    modules = {
      tabs = {
        active_tab_fg = 4,
        inactive_tab_fg = 6,
      },
      workspace = {
        enabled = true,
        icon = wezterm.nerdfonts.cod_window,
        color = 8,
      },
      leader = {
        enabled = true,
        icon = wezterm.nerdfonts.oct_rocket,
        color = 2,
      },
      pane = {
        enabled = true,
        icon = wezterm.nerdfonts.cod_multiple_windows,
        color = 7,
      },
      username = {
        enabled = true,
        icon = wezterm.nerdfonts.fa_user,
        color = 6,
      },
      hostname = {
        enabled = true,
        icon = wezterm.nerdfonts.cod_server,
        color = 8,
      },
      clock = {
        enabled = true,
        icon = wezterm.nerdfonts.md_calendar_clock,
        color = 5,
      },
      cwd = {
        enabled = true,
        icon = wezterm.nerdfonts.oct_file_directory,
        color = 7,
      },
    },
  }

  bar.apply_to_config(config)
end

return M
