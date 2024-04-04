return {
  "mrcjkb/rustaceanvim",
  version = "^3",
  event = "BufReadPost",
  dependencies = {
    "nvim-lua/plenary.nvim",
    "mfussenegger/nvim-dap",
    {
      "lvimuser/lsp-inlayhints.nvim",
      opts = {},
    },
  },
  ft = { "rust" },
  config = function()
    vim.g.rustaceanvim = {
      inlay_hints = {
        highlight = "NonText",
      },
      tools = {
        hover_actions = {
          auto_focus = true,
        },
      },
      server = {
        on_attach = function(client, bufnr)
          require("lsp-inlayhints").setup {}
          require("lsp-inlayhints").on_attach(client, bufnr)
          vim.lsp.inlay_hint(bufnr, true)
          require("lsp-inlayhints").show()
        end,
      },
    }
  end,
  cmd = { "Rust InlayHints" },
  keys = {
    { "<leader>uH", function() require("lsp-inlayhints").toggle() end, desc = "Toggle inlay hints" },
  },
}
