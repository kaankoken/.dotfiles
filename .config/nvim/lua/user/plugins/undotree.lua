-- FIXME: this plugin is not working due to shortcut conflicts
return {
  {
    "mbbill/undotree",
    cmd = "UndotreeToggle",
    keys = {
      { "n", "<leader>tu", desc = "Toggle undotree" },
    },
  },
}
