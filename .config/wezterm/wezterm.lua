local wezterm = require('wezterm')
local keybinds = require('keybinds')
local config = require('config')
local bar = require('bar')

local final_config = {}

if wezterm.config_builder then
  final_config = wezterm.config_builder()
end

-- Merge all configurations
for k, v in pairs(config) do
  final_config[k] = v
end

-- Apply keybindings
-- final_config.keys = keybinds.keys
final_config.key_tables = keybinds.key_tables
-- final_config.leader = keybinds.leader

-- Add SSH specific overrides for connecting to GitHub
if final_config.ssh_domains then
  -- Set specific options for SSH sessions
  final_config.set_environment_variables = {
    -- Ensure SSH agent is available
    SSH_AUTH_SOCK = os.getenv("SSH_AUTH_SOCK"),
    -- Set term type for SSH sessions
    TERM = "screen-256color",
  }
end

-- Apply bar configuration
bar.setup()
return final_config
