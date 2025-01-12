return {
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
        local prefix = "<Leader>H"
        maps.n[prefix] = { desc = require("astroui").get_icon("Harpoon", 1, true) .. "Harpoon" }
        -- Terminal detection
        local term_string = vim.env.TMUX ~= nil and "tmux" or "term"
        -- Initialize harpoon
        local harpoon = require "harpoon"
        harpoon:setup()

        -- Telescope integration
        local conf = require("telescope.config").values
        local function toggle_telescope(harpoon_files)
          local file_paths = {}
          for _, item in ipairs(harpoon_files.items) do
            table.insert(file_paths, item.value)
          end

          local make_finder = function()
            local paths = {}
            for _, item in ipairs(harpoon_files.items) do
              table.insert(paths, item.value)
            end
            return require("telescope.finders").new_table {
              results = paths,
            }
          end

          require("telescope.pickers")
            .new({}, {
              prompt_title = "Harpoon",
              finder = require("telescope.finders").new_table {
                results = file_paths,
              },
              previewer = false,
              sorter = conf.generic_sorter {},
              layout_strategy = "center",
              layout_config = {
                preview_cutoff = 1,
                width = function(_, max_columns, _) return math.min(max_columns, 80) end,
                height = function(_, _, max_lines) return math.min(max_lines, 15) end,
              },
              borderchars = {
                prompt = { "─", "│", " ", "│", "╭", "╮", "│", "│" },
                results = { "─", "│", "─", "│", "├", "┤", "╯", "╰" },
                preview = { "─", "│", "─", "│", "╭", "╮", "╯", "╰" },
              },
              attach_mappings = function(prompt_buffer_number, map)
                map("i", "<c-d>", function()
                  local state = require "telescope.actions.state"
                  local selected_entry = state.get_selected_entry()
                  local current_picker = state.get_current_picker(prompt_buffer_number)

                  harpoon:list():remove(selected_entry)
                  current_picker:refresh(make_finder())
                end)
                return true
              end,
            })
            :find()
        end
        -- Updated keymaps
        maps.n[prefix .. "a"] = { function() harpoon:list():add() end, desc = "Add file" }
        maps.n[prefix .. "e"] =
          { function() harpoon.ui:toggle_quick_menu(harpoon:list()) end, desc = "Toggle quick menu" }
        maps.n[prefix .. "t"] = { function() toggle_telescope(harpoon:list()) end, desc = "Harpoon (Telescope)" }
        -- Terminal window navigation
        maps.n[prefix .. "T"] = {
          function()
            vim.ui.input({ prompt = term_string .. " window number: " }, function(input)
              local num = tonumber(input)
              if num then require("harpoon").term.gotoTerminal(num) end
            end)
          end,
          desc = "Go to " .. term_string .. " window",
        }
        -- Quick selection mappings
        maps.n["<C-h>"] = { function() harpoon:list():select(1) end, desc = "Select first file" }
        maps.n["<C-t>"] = { function() harpoon:list():select(2) end, desc = "Select second file" }
        maps.n["<C-n>"] = { function() harpoon:list():select(3) end, desc = "Select third file" }

        -- Navigation mappings
        maps.n["<C-p>"] = { function() harpoon:list():prev() end, desc = "Previous mark" }
        maps.n["<C-n>"] = { function() harpoon:list():next() end, desc = "Next mark" }
      end,
    },
  },
}
