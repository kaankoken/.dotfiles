-- Customize Treesitter
-- --------------------
-- In v6, nvim-treesitter is just a parser download utility.
-- All treesitter configuration is handled through AstroCore.

---@type LazySpec
return {
  "AstroNvim/astrocore",
  ---@type AstroCoreOpts
  opts = {
    treesitter = {
      highlight = true,
      indent = true,
      auto_install = true,
      ensure_installed = {
        "lua",
        "vim",
        "rust",
        "python",
        "typescript",
        "javascript",
      },
    },
  },
}
