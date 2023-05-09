local builtin = require('telescope.builtin')

vim.keymap.set('n', '<leader>pf', builtin.find_files, { desc = "Find in [P]roject [F]ile" })
vim.keymap.set('n', '<C-p>', builtin.git_files, { desc = "Fuzzy Finder in [P]roject" })
vim.keymap.set('n', '<leader>ps', function()
	builtin.grep_string({ search = vim.fn.input("Grep > ")})
end, { desc = "[P]roject [S]earch "})
