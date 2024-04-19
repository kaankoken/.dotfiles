return {
  "Saecki/crates.nvim",
  event = { "BufRead Cargo.toml" },
  dependencies = {
    "AstroNvim/astrocore",
    opts = {
      autocmds = {
        CmpSourceCargo = {
          {
            event = "BufRead",
            desc = "Load crates.nvim into Cargo buffers",
            pattern = "Cargo.toml",
            callback = function()
              require("cmp").setup.buffer { sources = { { name = "crates" } } }
              require "crates"
            end,
          },
        },
      },
    },
  },
  opts = {
    null_ls = {
      enabled = true,
      name = "crates.nvim",
    },
    src = {
      cmp = { enabled = true },
    },
  },
}
