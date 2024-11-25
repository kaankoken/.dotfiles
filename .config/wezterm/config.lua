local wezterm = require("wezterm")
local config = {}

config = {
	-- General
	default_cursor_style = "SteadyBar",
	automatically_reload_config = true,
	hide_mouse_cursor_when_typing = true,
	adjust_window_size_when_changing_font_size = false,
	max_fps = 120,
	enable_kitty_graphics = true,
	-- Color
	color_scheme = "Catppuccin Mocha",
	-- Font
	font = wezterm.font_with_fallback({ "JetBrainsMono Nerd Font", "FiraCode Nerd Font" }),
	font_size = 16.0,
	harfbuzz_features = { "zero" },
	-- Tab
	enable_tab_bar = true,
	-- Window
	inactive_pane_hsb = {
		saturation = 0.7,
		brightness = 0.5,
	},
	window_background_opacity = 0.85,
	-- window_padding = {
	-- 	left = 10,
	-- 	right = 10,
	-- 	top = 10,
	-- 	bottom = 10,
	-- },
	-- window_frame = {
	-- 	border_left_width = "0.5cell",
	-- 	border_right_width = "0.5cell",
	-- 	border_bottom_height = "0.5cell",
	-- 	border_top_height = "0.5cell",
	-- },
	window_close_confirmation = "NeverPrompt",
	window_decorations = "RESIZE",
	macos_window_background_blur = 10,
	-- Hyperlink
	hyperlink_rules = {
		-- Matches: a URL in parens: (URL)
		{
			regex = "\\((\\w+://\\S+)\\)",
			format = "$1",
			highlight = 1,
		},
		-- Matches: a URL in brackets: [URL]
		{
			regex = "\\[(\\w+://\\S+)\\]",
			format = "$1",
			highlight = 1,
		},
		-- Matches: a URL in curly braces: {URL}
		{
			regex = "\\{(\\w+://\\S+)\\}",
			format = "$1",
			highlight = 1,
		},
		-- Matches: a URL in angle brackets: <URL>
		{
			regex = "<(\\w+://\\S+)>",
			format = "$1",
			highlight = 1,
		},
		-- Then handle URLs not wrapped in brackets
		{
			-- Before
			--regex = '\\b\\w+://\\S+[)/a-zA-Z0-9-]+',
			--format = '$0',
			-- After
			regex = "[^(]\\b(\\w+://\\S+[)/a-zA-Z0-9-]+)",
			format = "$1",
			highlight = 1,
		},
		-- implicit mailto link
		{
			regex = "\\b\\w+@[\\w-]+(\\.[\\w-]+)+\\b",
			format = "mailto:$0",
		},
	},
	-- Render
	webgpu_power_preference = "HighPerformance",
	-- Bar styling configuration
	use_fancy_tab_bar = false,
	tab_bar_at_bottom = true,
	hide_tab_bar_if_only_one_tab = true,
	send_composed_key_when_left_alt_is_pressed = true,
}

-- Default domain options
config.default_domain = "local"
-- Exit behavior
config.exit_behavior = "Close"
-- Clean exit config
config.clean_exit_codes = { 0, 130 }

local default_prog = nil
if wezterm.target_triple == "x86_64-pc-windows-msvc" then
	default_prog = { "powershell.exe" }
end
config.default_prog = default_prog

return config
