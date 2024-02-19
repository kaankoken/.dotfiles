return {
  {
    "folke/todo-comments.nvim",
    dependencies = { "nvim-lua/plenary.nvim" },
    config = function() require("todo-comments").setup {} end,
    -- config equivalent
    -- opt = {},
    event = "User AstroFile",
    cmd = { "TodoQuickFix" },
    keys = {
      { "<leader>td", "<cmd>TodoTelescope<cr>", desc = "Open TODOs in telescope" },
    },
  },
}
