return {
  -- Add the community repository of plugin specifications
  "AstroNvim/astrocommunity",
  -- example of importing a plugin, comment out to use it or add your own
  -- available plugins can be found at https://github.com/AstroNvim/astrocommunity

  { import = "astrocommunity.pack.go" },
  { import = "astrocommunity.pack.toml" },
  { import = "astrocommunity.pack.json" },
  { import = "astrocommunity.pack.docker" },
  { import = "astrocommunity.pack.typescript" },
  { import = "astrocommunity.completion.copilot-lua-cmp" },
  { import = "astrocommunity.motion.harpoon" },
  { import = "astrocommunity.colorscheme.mellow-nvim" },
}
