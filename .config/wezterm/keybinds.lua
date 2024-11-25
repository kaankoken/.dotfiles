-- File: ~/.config/wezterm/wezterm.lua
local wezterm = require("wezterm")
local config = {}

if wezterm.config_builder then
	config = wezterm.config_builder()
end

-- Leader key
config.leader = {
	key = "b",
	mods = "CTRL",
	timeout_milliseconds = 3000,
}

-- Key mappings
config.keys = {
	-- Create new tab
	{
		key = "c",
		mods = "LEADER",
		action = wezterm.action.SpawnTab("CurrentPaneDomain"),
	},

	-- Switch to next/previous tab
	{
		key = "n",
		mods = "LEADER",
		action = wezterm.action.ActivateTabRelative(1),
	},
	{
		key = "p",
		mods = "LEADER",
		action = wezterm.action.ActivateTabRelative(-1),
	},

	-- New window
	{
		key = "c",
		mods = "LEADER|CTRL",
		action = wezterm.action.SpawnWindow,
	},

	-- Copy mode
	{
		key = "[",
		mods = "LEADER",
		action = wezterm.action.ActivateCopyMode,
	},

	-- Reload config
	{
		key = "r",
		mods = "LEADER",
		action = wezterm.action.ReloadConfiguration,
	},

	-- Split panes
	{
		key = "%",
		mods = "LEADER|SHIFT",
		action = wezterm.action.SplitPane({
			direction = "Right",
			size = { Percent = 50 },
		}),
	},
	{
		key = '"',
		mods = "LEADER|SHIFT",
		action = wezterm.action.SplitPane({
			direction = "Down",
			size = { Percent = 50 },
		}),
	},

	-- Pane resizing
	{
		key = "H",
		mods = "LEADER",
		action = wezterm.action.AdjustPaneSize({ "Left", 5 }),
	},
	{
		key = "L",
		mods = "LEADER",
		action = wezterm.action.AdjustPaneSize({ "Right", 5 }),
	},
	{
		key = "K",
		mods = "LEADER",
		action = wezterm.action.AdjustPaneSize({ "Up", 5 }),
	},
	{
		key = "J",
		mods = "LEADER",
		action = wezterm.action.AdjustPaneSize({ "Down", 5 }),
	},

	-- Pane switching
	{
		key = "h",
		mods = "LEADER",
		action = wezterm.action.ActivatePaneDirection("Left"),
	},
	{
		key = "l",
		mods = "LEADER",
		action = wezterm.action.ActivatePaneDirection("Right"),
	},
	{
		key = "k",
		mods = "LEADER",
		action = wezterm.action.ActivatePaneDirection("Up"),
	},
	{
		key = "j",
		mods = "LEADER",
		action = wezterm.action.ActivatePaneDirection("Down"),
	},

	-- Close pane
	{
		key = "x",
		mods = "LEADER",
		action = wezterm.action.CloseCurrentPane({ confirm = true }),
	},

	-- Rename tab
	{
		key = ",",
		mods = "LEADER",
		action = wezterm.action.PromptInputLine({
			description = "Enter new name for tab",
			action = wezterm.action_callback(function(window, pane, line)
				if line then
					window:active_tab():set_title(line)
				end
			end),
		}),
	},
}

-- Color scheme
config.color_scheme = "Catppuccin Mocha"

-- Tab bar configuration
config.use_fancy_tab_bar = false
config.tab_bar_at_bottom = true
config.hide_tab_bar_if_only_one_tab = false
config.tab_max_width = 32

-- Other settings
config.window_padding = {
	left = 10,
	right = 0,
	top = 10,
	bottom = 0,
}

-- Enable Vi mode
config.enable_kitty_keyboard = true
config.use_dead_keys = false
config.enable_csi_u_key_encoding =true

return config
