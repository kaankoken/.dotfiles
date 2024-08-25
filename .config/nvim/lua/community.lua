-- if true then return {} end -- WARN: REMOVE THIS LINE TO ACTIVATE THIS FILE

-- AstroCommunity: import any community modules here
-- We import this file in `lazy_setup.lua` before the `plugins/` folder.
-- This guarantees that the specs are processed before any user plugins.

---@type LazySpec
return {
  "AstroNvim/astrocommunity",
  { import = "astrocommunity.colorscheme.mellow-nvim" },
  { import = "astrocommunity.editing-support.comment-box-nvim" },
  { import = "astrocommunity.editing-support.undotree" },
  { import = "astrocommunity.completion.copilot-lua-cmp" },
  { import = "astrocommunity.media.presence-nvim" },
  { import = "astrocommunity.motion.harpoon" },
  { import = "astrocommunity.lsp.garbage-day-nvim" },
  { import = "astrocommunity.pack.kotlin" },
  { import = "astrocommunity.pack.typescript" },
  { import = "astrocommunity.pack.lua" },
  { import = "astrocommunity.pack.go" },
  { import = "astrocommunity.pack.toml" },
  { import = "astrocommunity.pack.json" },
  { import = "astrocommunity.pack.yaml" },
  { import = "astrocommunity.pack.docker" },
  { import = "astrocommunity.pack.markdown" },
  { import = "astrocommunity.pack.ruby" },
  { import = "astrocommunity.pack.rust" },
  { import = "astrocommunity.pack.python-ruff"},
  { import = "astrocommunity.recipes.disable-tabline" },
  { import = "astrocommunity.workflow.hardtime-nvim" },
}
