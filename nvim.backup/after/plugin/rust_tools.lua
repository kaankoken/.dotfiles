require("rust-tools").setup({})

-- Set inlay hints for the current buffer
require('rust-tools').inlay_hints.set()
-- Unset inlay hints for the current buffer
require('rust-tools').inlay_hints.unset()

-- Enable inlay hints auto update and set them for all the buffers
require('rust-tools').inlay_hints.enable()
-- Disable inlay hints auto update and unset them for all buffers
require('rust-tools').inlay_hints.disable()
