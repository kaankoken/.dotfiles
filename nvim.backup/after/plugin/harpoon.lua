local mark = require("harpoon.mark")
local ui = require("harpoon.ui")


vim.keymap.set("n", "<leader>a", mark.add_file, { desc = "[A]dd a file to harpoon" })
vim.keymap.set("n", "<C-e>", ui.toggle_quick_menu, { desc = "Toggle Quick Menu" })

vim.keymap.set("n", "<C-h>", function() ui.nav_file(1) end, { desc = "Toggle to First harpoon file" })
vim.keymap.set("n", "<C-t>", function() ui.nav_file(2) end, { desc = "Toggle to Second harpoon file" })
vim.keymap.set("n", "<C-n>", function() ui.nav_file(3) end, { desc = "Toggle to Third harpoon file" })
vim.keymap.set("n", "<C-s>", function() ui.nav_file(4) end, { desc = "Toggle to Fourth harpoon file" })

