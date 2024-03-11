local prefix = "<leader><leader>"
local term_string = vim.fn.exists "$TMUX" == 1 and "tmux" or "term"
local maps = { n = {} }
local icon = vim.g.icons_enabled and "󱡀 " or ""

maps.n[prefix] = { desc = icon .. "Harpoon" }

require("astronvim.utils").set_mappings(maps)
local harpoon = require "harpoon"
harpoon:setup {}

return {
  {
    "ThePrimeagen/harpoon",
    branch = "harpoon2",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-telescope/telescope.nvim",
    },
    keys = {
      { prefix .. "a", function() harpoon:list():append() end, desc = "Add file" },
      {
        prefix .. "e",
        function() harpoon.ui:toggle_quick_menu(harpoon:list()) end,
        desc = "Toggle quick menu",
      },
      {
        prefix .. "x",
        function()
          vim.ui.input({ prompt = "Harpoon mark index: " }, function(input)
            local num = tonumber(input)
            if num then harpoon:list():select(num) end
          end)
        end,
        desc = "Goto index of mark",
      },
      { prefix .. "p", function() harpoon:list():prev() end, desc = "Goto previous mark" },
      { prefix .. "n", function() harpoon:list():next() end, desc = "Goto next mark" },
      { prefix .. "m", "<cmd>Telescope harpoon marks<CR>", desc = "Show marks in Telescope" },
      {
        prefix .. "t",
        function()
          vim.ui.input({ prompt = term_string .. " window number: " }, function(input)
            local num = tonumber(input)
            if num then harpoon:term():select(num) end
          end)
        end,
        desc = "Go to " .. term_string .. " window",
      },
    },
    opts = {},
  },
}
