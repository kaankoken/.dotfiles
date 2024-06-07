return {
  {
    "nvim-treesitter/nvim-treesitter",
    optional = true,
    opts = function(_, opts)
      if opts.ensure_installed ~= "all" then
        opts.ensure_installed = require("astrocore").list_insert_unique(opts.ensure_installed, { "ruby" })
      end
      -- Add filetype detection for Fastfile
      vim.cmd [[
        augroup fastlane
          autocmd!
          autocmd BufNewFile,BufRead Fastfile set filetype=ruby
          autocmd BufNewFile,BufRead Appfile set filetype=ruby
          autocmd BufNewFile,BufRead Pluginfile set filetype=ruby
          autocmd BufNewFile,BufRead Matchfile set filetype=ruby
          autocmd BufNewFile,BufRead **/fastlane/*file set filetype=ruby
        augroup END
      ]]
    end,
  },
  {
    "williamboman/mason-lspconfig.nvim",
    optional = true,
    opts = function(_, opts)
      opts.ensure_installed =
        require("astrocore").list_insert_unique(opts.ensure_installed, { "solargraph", "standardrb" })
      -- Configure LSP for Fastfile
      require("lspconfig").solargraph.setup {
        on_attach = function(client, bufnr)
          -- Enable LSP for files ending with 'file' in the fastlane directory
          local filepath = vim.api.nvim_buf_get_name(bufnr)
          if filepath:match "fastlane/.*file$" then
            client.config.settings.solargraph.filetypes = { "ruby", "rakefile", "fastfile", "appfile", "pluginfile", "matchfile" }
            client.config.root_dir = require("lspconfig.util").root_pattern("Gemfile", ".git")(filepath)
          end
          client.notify "workspace/didChangeConfiguration"
        end,
        settings = {
          solargraph = {
            autoformat = true,
            bundlerPath = "bundle",
            checkGemVersion = true,
            commandPath = "solargraph",
            definitions = true,
            completion = true,
            folding = true,
            diagnostics = true,
            formatting = true,
            hover = true,
            logLevel = "warn",
            references = true,
            rename = true,
            symbols = true,
            transport = "socket",
            useBundler = false,
            filetypes = { "ruby", "rakefile", "fastfile", "appfile", "pluginfile" }, -- Ensure Fastfile, Appfile, and Pluginfile are recognized
          },
        },
      }
    end,
  },
  {
    "WhoIsSethDaniel/mason-tool-installer.nvim",
    optional = true,
    opts = function(_, opts)
      opts.ensure_installed =
        require("astrocore").list_insert_unique(opts.ensure_installed, { "solargraph", "standardrb" })
    end,
  },
  {
    "mfussenegger/nvim-dap",
    optional = true,
    dependencies = { "suketa/nvim-dap-ruby", config = true },
  },
  {
    "stevearc/conform.nvim",
    optional = true,
    opts = {
      formatters_by_ft = {
        ruby = { "standardrb" },
      },
    },
  },
}
