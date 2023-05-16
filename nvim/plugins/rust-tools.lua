local utils = require "astronvim.utils"

return {
  {
    "rust-lang/rust.vim",
    ft = "rust",
    init = function() vim.g.rustfmt_autosave = 1 end,
  },
  {
    "simrat39/rust-tools.nvim",
    ft = { "rust" },
    init = function() astronvim.lsp.skip_setup = utils.list_insert_unique(astronvim.lsp.skip_setup, "rust_analyzer") end,
    opts = function()
      local package_path = require("mason-registry").get_package("codelldb"):get_install_path()
      local codelldb_path = package_path .. "/codelldb"
      local liblldb_path = package_path .. "/extension/lldb/lib/liblldb"
      local this_os = vim.loop.os_uname().sysname

      -- The path in windows is different
      if this_os:find "Windows" then
        codelldb_path = package_path .. "\\extension\\adapter\\codelldb.exe"
        liblldb_path = package_path .. "\\extension\\lldb\\bin\\liblldb.dll"
      else
        -- The liblldb extension is .so for linux and .dylib for macOS
        liblldb_path = liblldb_path .. (this_os == "Linux" and ".so" or ".dylib")
      end

      return {
        server = {
          require("astronvim.utils.lsp").config "rust_analyzer",
          filetypes = { "rust" },
          --root_dir = utils.root_pattern "Cargo.toml",
          settings = {
            ["rust-analyzer"] = {
              checkOnSave = {
                command = "clippy",
              },
              cargo = {
                allFeatures = true,
              },
            },
          },
        },
        dap = {
          adapter = require("rust-tools.dap").get_codelldb_adapter(codelldb_path, liblldb_path),
        },
      }
    end,
    dependencies = {
      {
        "jay-babu/mason-nvim-dap.nvim",
        opts = function(_, opts) opts.ensure_installed = utils.list_insert_unique(opts.ensure_installed, "codelldb") end,
      },
    },
  },
}
