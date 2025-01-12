return {
  { import = "astrocommunity.pack.yaml" },
  {
    "AstroNvim/astrolsp",
    optional = true,
    ---@type AstroLSPOpts
    opts = {
      ---@diagnostic disable: missing-fields
      handlers = { dartls = false },
    },
  },
  {
    "nvim-treesitter/nvim-treesitter",
    optional = true,
    opts = function(_, opts)
      if opts.ensure_installed ~= "all" then
        opts.ensure_installed = require("astrocore").list_insert_unique(opts.ensure_installed, { "dart" })
      end
      local select = vim.tbl_get(opts, "textobjects", "select")
      if select then select.disable = require("astrocore").list_insert_unique(select.disable, { "dart" }) end
    end,
  },
  {
    "akinsho/flutter-tools.nvim",
    ft = "dart",
    opts = function()
      local astrolsp_avail, astrolsp = pcall(require, "astrolsp")
      local opts = {
        debugger = { 
          enabled = true,
          run_via_dap = true,
          register_configurations = function(_)
            local dap = require("dap")
            -- dap.configurations.dart = {
            --   {
            --     type = "dart",
            --     request = "launch",
            --     name = "Launch Dev",
            --     program = "lib/main/dev.dart",
            --     args = {"--flavor", "dev"},
            --     flutterMode = "debug",
            --   },
            --   {
            --     type = "dart",
            --     request = "launch",
            --     name = "Launch Staging",
            --     program = "lib/main/stag.dart",
            --     args = {"--flavor", "stag"},
            --     flutterMode = "debug",
            --   },
            --   {
            --     type = "dart",
            --     request = "launch",
            --     name = "Launch Prod",
            --     program = "lib/main/prod.dart",
            --     args = {"--flavor", "prod"},
            --     flutterMode = "release",
            --   },
            -- }
          end
        },
        dev_log = {
          enabled = true,
          open_cmd = "tabedit",
        },
        outline = {
          open_cmd = "30vnew", -- Opens outline in a vertical split of width 30
          auto_open = false    -- Configure if you want outline to auto open
        },
        widget_guides = {
          enabled = true,      -- Show widget guide lines
        },
        closing_tags = {
          highlight = "ErrorMsg", -- Change highlight of closing tag
          prefix = "//",         -- Character to use for close tag
          enabled = true         -- Enable closing tags
        },
        lsp = astrolsp_avail and astrolsp.lsp_opts("dartls") or nil,
        settings = {
          showTodos = true,    -- Show todo comments in outline
          completeFunctionCalls = true, -- Complete function calls
          enableSnippets = true,
          updateImportsOnRename = true, -- Update imports on rename
        }
      }
      return opts
    end,
    dependencies = {
      "nvim-lua/plenary.nvim",
      "stevearc/dressing.nvim",    -- Optional: for better UI
      "rcarriga/nvim-dap-ui",      -- Add DAP UI support
      "mfussenegger/nvim-dap",     -- Add DAP support
    },
    keys = {
      -- Debug
      { "<F5>", function() require("dap").continue() end, desc = "Debug: Start/Continue" },
      { "<F10>", function() require("dap").step_over() end, desc = "Debug: Step Over" },
      { "<F11>", function() require("dap").step_into() end, desc = "Debug: Step Into" },
      { "<F12>", function() require("dap").step_out() end, desc = "Debug: Step Out" },
      { "<leader>db", function() require("dap").toggle_breakpoint() end, desc = "Debug: Toggle Breakpoint" },
      { "<leader>dB", function() require("dap").set_breakpoint(vim.fn.input('Breakpoint condition: ')) end, desc = "Debug: Set Conditional Breakpoint" },
      -- Flutter commands
      { "<leader>Fc", "<cmd>FlutterLogClear<cr>", desc = "Flutter: Clear Logs" },
      { "<leader>Fr", "<cmd>FlutterRun<cr>", desc = "Flutter: Run" },
      { "<leader>FR", "<cmd>FlutterRestart<cr>", desc = "Flutter: Restart" },
      { "<leader>Fq", "<cmd>FlutterQuit<cr>", desc = "Flutter: Quit" },
      { "<leader>Fo", "<cmd>FlutterOutlineToggle<cr>", desc = "Flutter: Toggle Outline" },
      { "<leader>Fd", "<cmd>FlutterDevTools<cr>", desc = "Flutter: DevTools" },
    },
    specs = {
      {
        "nvim-telescope/telescope.nvim",
        optional = true,
        opts = function() require("telescope").load_extension "flutter" end,
      },
    },
  },
  {
    "WhoIsSethDaniel/mason-tool-installer.nvim",
    optional = true,
    opts = function(_, opts)
      opts.ensure_installed = require("astrocore").list_insert_unique(opts.ensure_installed, { "dart-debug-adapter" })
    end,
  },
  {
    "jay-babu/mason-nvim-dap.nvim",
    optional = true,
    opts = function(_, opts)
      opts.ensure_installed = require("astrocore").list_insert_unique(opts.ensure_installed, { "dart" })
    end,
  },
}
