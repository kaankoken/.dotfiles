local path = vim.fn.expand "~" .. "/Desktop/obsidian"

return {
  {
    "epwalsh/obsidian.nvim",
    lazy = true,
    ft = "markdown",
    event = { "bufreadpre " .. path .. "/**.md" },
    dependencies = {
      -- Required.
      "nvim-lua/plenary.nvim",
      "hrsh7th/nvim-cmp",
      "nvim-telescope/telescope.nvim",
      "nvim-treesitter/nvim-treesitter",
      {
        "AstroNvim/astrocore",
        opts = {
          mappings = {
            n = {
              ["<leader>oF"] = {
                function()
                  vim.wo.conceallevel = 2
                  vim.opt_local.conceallevel = 2
                  return require("obsidian").util.gf_passthrough()
                end,
                desc = "Obsidian Follow Link",
              },
              ["<leader>oc"] = {
                function() return require("obsidian").util.toggle_checkbox() end,
                desc = "Toggle Checkbox or Original",
              },
              ["<leader>oC"] = {
                function() return require("obsidian").util.smart_action() end,
                desc = "Obsidian Smart Action or Original",
              },
              ["<leader>oo"] = { "<cmd>ObsidianOpen<CR>", desc = "Obsidian Open" },
              ["<leader>ow"] = { "<cmd>ObsidianWorkspace<CR>", desc = "Obsidian workspaces" },
              ["<leader>ot"] = { "<cmd>ObsidianToday<CR>", desc = "Open today's note in the current workspace" },
              ["<leader>oT"] = { "<cmd>ObsidianTomorrow<CR>", desc = "Open tomorrow's note in the current workspace" },
              ["<leader>oy"] = { "<cmd>ObsidianYesterday<CR>", desc = "Open yestardays' note in the current workspace" },
              ["<leader>os"] = { "<cmd>ObsidianSearch<CR>", desc = "Search in workspace" },
            },
          },
        },
      },
    },
    config = function()
      require("obsidian").setup {
        workspaces = {
          {
            name = "personal",
            path = path .. "/Personal",
          },
          {
            name = "work",
            path = path .. "/Work",
          },
          {
            name = "morfeu",
            path = path .. "/Morfeu",
          },
        },
        dir = path,
        use_advanced_uri = true,
        finder = "telescope.nvim",
        -- templates = {
        --   subdir = "templates",
        --   date_format = "%Y-%m-%d-%a",
        --   time_format = "%H:%M",
        -- },
        daily_notes = {
          date_format = "%Y-%m-%d",
          alias_format = "%B %-d, %Y",
          default_tags = { "daily-notes" },
          template = nil,
        },
        note_frontmatter_func = function(note)
          local out = { id = note.id, aliases = note.aliases, tags = note.tags }
          if note.metadata ~= nil and require("obsidian").util.table_length(note.metadata) > 0 then
            for k, v in pairs(note.metadata) do
              out[k] = v
            end
          end
          return out
        end,
        follow_url_func = vim.ui.open or function(url) require("astrocore").system_open(url) end,
        completion = {
          nvim_cmp = true,
          min_chars = 2,
        },
        picker = {
          name = "telescope.nvim",
          mappings = {
            new = "<leader>ox",
            insert_link = "<leader>ol>",
          },
        },
        callbacks = {
          post_setup = function(client) end,
          enter_note = function(client, note) end,
          leave_note = function(client, note) end,
          pre_write_note = function(client, note) end,
          post_set_workspace = function(client, workspace) end,
        },
        ui = {
          enable = true,
          update_debounce = 200,
          max_file_length = 5000,
          checkboxes = {
            [" "] = { char = "󰄱", hl_group = "ObsidianTodo" },
            ["x"] = { char = "", hl_group = "ObsidianDone" },
            [">"] = { char = "", hl_group = "ObsidianRightArrow" },
            ["~"] = { char = "󰰱", hl_group = "ObsidianTilde" },
            ["!"] = { char = "", hl_group = "ObsidianImportant" },
          },
          bullets = { char = "•", hl_group = "ObsidianBullet" },
          external_link_icon = { char = "", hl_group = "ObsidianExtLinkIcon" },
          reference_text = { hl_group = "ObsidianRefText" },
          highlight_text = { hl_group = "ObsidianHighlightText" },
          tags = { hl_group = "ObsidianTag" },
          block_ids = { hl_group = "ObsidianBlockID" },
          hl_groups = {
            ObsidianTodo = { bold = true, fg = "#f78c6c" },
            ObsidianDone = { bold = true, fg = "#89ddff" },
            ObsidianRightArrow = { bold = true, fg = "#f78c6c" },
            ObsidianTilde = { bold = true, fg = "#ff5370" },
            ObsidianImportant = { bold = true, fg = "#d73128" },
            ObsidianBullet = { bold = true, fg = "#89ddff" },
            ObsidianRefText = { underline = true, fg = "#c792ea" },
            ObsidianExtLinkIcon = { fg = "#c792ea" },
            ObsidianTag = { italic = true, fg = "#89ddff" },
            ObsidianBlockID = { italic = true, fg = "#89ddff" },
            ObsidianHighlightText = { bg = "#75662e" },
          },
        },
        attachments = {
          img_folder = "attachments",
          img_text_func = function(client, path)
            path = client:vault_relative_path(path) or path
            return string.format("![%s](%s)", path.name, path)
          end,
        },
      }
    end,
    sort_by = "modified",
    sort_reversed = true,
    search_max_lines = 1000,
    open_notes_in = "current",
  },
}
