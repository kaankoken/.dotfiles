return {
  {
    "ThePrimeagen/harpoon",
    branch = "harpoon2",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-telescope/telescope.nvim",
      { "AstroNvim/astroui", opts = { icons = { Harpoon = "󱡀" } } },
      {
        "AstroNvim/astrocore",
        opts = function(_, opts)
          local maps = opts.mappings
          -- local term_string = vim.fn.exists "$TMUX" == 1 and "tmux" or "term"
          local prefix = "<Leader><Leader>"
          local harpoon = require "harpoon"
          harpoon.setup {}

          maps.n[prefix] = { desc = require("astroui").get_icon("Harpoon", 1, true) .. "Harpoon" }

          maps.n[prefix .. "a"] = { function() harpoon:list():append() end, desc = "Add file" }
          maps.n[prefix .. "e"] = {
            function() harpoon.ui:toggle_quick_menu(require("harpoon"):list()) end,
            desc = "Toggle quick menu",
          }
          maps.n["<C-x>"] = {
            function()
              vim.ui.input({ prompt = "Harpoon mark index: " }, function(input)
                local num = tonumber(input)
                if num then harpoon:list():select(num) end
              end)
            end,
            desc = "Goto index of mark",
          }
          maps.n["<C-p>"] = { function() harpoon:list():prev() end, desc = "Goto previous mark" }
          maps.n["<C-n>"] = { function() harpoon:list():next() end, desc = "Goto next mark" }
          maps.n[prefix .. "m"] = { "<Cmd>Telescope harpoon marks<CR>", desc = "Show marks in Telescope" }
          -- Code below does not work, harpoon does not have a term module
          -- maps.n[prefix .. "t"] = {
          --   function()
          --     vim.ui.input({ prompt = term_string .. " window number: " }, function(input)
          --       local num = tonumber(input)
          --       if num then harpoon.term.gotoTerminal(num) end
          --     end)
          --   end,
          --   desc = "Go to " .. term_string .. " window",
          -- }
        end,
      },
    },
  },
}