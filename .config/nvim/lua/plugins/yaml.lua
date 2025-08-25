return {
  "b0o/schemastore.nvim",
  lazy = true,
  dependencies = {
    {
      "AstroNvim/astrolsp",
      optional = true,
      ---@type AstroLSPOpts
      opts = {
        ---@diagnostic disable: missing-fields
        config = {
          yamlls = {
            on_new_config = function(config)
              config.settings.yaml.schemas =
                vim.tbl_deep_extend("force", config.settings.yaml.schemas or {}, require("schemastore").yaml.schemas())
            end,
            settings = { yaml = { schemaStore = { enable = false, url = "" } } },
          },
          -- Add JSON Language Server configuration
          jsonls = {
            on_new_config = function(config)
              -- Get default schemas from schemastore
              local default_schemas = require("schemastore").json.schemas()

              -- Add your custom GCP Workflows schema
              local custom_schemas = {
                {
                  description = "Google Cloud Workflows",
                  fileMatch = {
                    "*.workflows.json",
                    "*.workflow.json",
                    "**/workflows/*.json",
                    "**/gcp/workflows/*.json",
                  },
                  name = "workflows.json",
                  url = "https://raw.githubusercontent.com/SchemaStore/schemastore/master/src/schemas/json/workflows.json",
                },
              }
              -- Combine default and custom schemas
              config.settings.json.schemas =
                vim.tbl_deep_extend("force", config.settings.json.schemas or {}, default_schemas, custom_schemas)
            end,
            settings = {
              json = {
                schemaStore = { enable = false, url = "" },
                validate = { enable = true },
              },
            },
          },
        },
      },
    },
  },
}
