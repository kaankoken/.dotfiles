-- lua/plugins/arb.lua
-- ARB configuration with forced schema association

return {
  -- Filetype detection
  {
    "AstroNvim/astrocore",
    opts = {
      filetypes = {
        extension = {
          arb = "json",
        },
      },
      autocmds = {
        arb_schema_force = {
          {
            event = { "BufRead", "BufNewFile" },
            pattern = "*.arb",
            callback = function()
              -- Set filetype to json
              vim.bo.filetype = "json"

              -- Force schema association after LSP attaches
              vim.defer_fn(function()
                -- Use the new API to get active clients
                local clients = vim.lsp.get_clients { bufnr = 0, name = "jsonls" }
                if #clients > 0 then
                  local client = clients[1]
                  local bufnr = vim.api.nvim_get_current_buf()

                  -- Get the file URI
                  local uri = vim.uri_from_bufnr(bufnr)

                  -- Create a properly typed settings structure
                  ---@type table
                  local settings = vim.deepcopy(client.config.settings) or {}

                  -- Safely ensure json table exists
                  if type(settings.json) ~= "table" then settings.json = {} end

                  -- Safely ensure schemas array exists
                  ---@diagnostic disable-next-line: inject-field
                  if type(settings.json.schemas) ~= "table" then settings.json.schemas = {} end

                  -- Add specific schema for this file
                  local file_specific_schema = {
                    fileMatch = { uri },
                    url = "https://raw.githubusercontent.com/google/app-resource-bundle/main/schema/arb.json",
                  }

                  -- Safely add schema with type cast
                  ---@diagnostic disable-next-line: inject-field
                  table.insert(settings.json.schemas, file_specific_schema)

                  -- Notify the client of the configuration change
                  client.rpc.notify("workspace/didChangeConfiguration", {
                    settings = settings,
                  })
                end
              end, 1000) -- Wait 1 second for LSP to fully attach
            end,
          },
        },
      },
    },
  },

  -- Enhanced JSON LSP configuration
  {
    "AstroNvim/astrolsp",
    opts = {
      config = {
        jsonls = {
          on_new_config = function(config)
            -- Initialize settings
            config.settings = config.settings or {}
            config.settings.json = config.settings.json or {}
            config.settings.json.schemas = config.settings.json.schemas or {}

            -- Add multiple ARB schema patterns
            local arb_schemas = {
              {
                name = "ARB",
                description = "Application Resource Bundle (ARB) for Flutter i18n",
                fileMatch = { "*.arb" },
                url = "https://raw.githubusercontent.com/google/app-resource-bundle/main/schema/arb.json",
              },
              {
                name = "ARB_l10n",
                description = "Application Resource Bundle in l10n directory",
                fileMatch = { "**/l10n/*.arb", "**/lib/l10n/*.arb" },
                url = "https://raw.githubusercontent.com/google/app-resource-bundle/main/schema/arb.json",
              },
              {
                name = "ARB_intl",
                description = "Application Resource Bundle in intl directory",
                fileMatch = { "**/intl/*.arb", "**/assets/l10n/*.arb" },
                url = "https://raw.githubusercontent.com/google/app-resource-bundle/main/schema/arb.json",
              },
            }

            for _, schema in ipairs(arb_schemas) do
              table.insert(config.settings.json.schemas, schema)
            end
          end,
          settings = {
            json = {
              validate = { enable = true },
              format = { enable = true },
              schemaStore = { enable = false },
              -- Force schema download and caching
              schemaDownload = { enable = true },
              -- Multiple schema definitions for better matching
              schemas = {
                {
                  fileMatch = { "*.arb" },
                  url = "https://raw.githubusercontent.com/google/app-resource-bundle/main/schema/arb.json",
                },
                {
                  fileMatch = { "**/l10n/*.arb" },
                  url = "https://raw.githubusercontent.com/google/app-resource-bundle/main/schema/arb.json",
                },
                {
                  fileMatch = { "**/lib/l10n/*.arb" },
                  url = "https://raw.githubusercontent.com/google/app-resource-bundle/main/schema/arb.json",
                },
              },
            },
          },
        },
      },
    },
  },
}
