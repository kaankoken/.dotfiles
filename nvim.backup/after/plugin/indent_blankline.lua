vim.opt.list = true
vim.opt.listchars:append "eol:↴"

vim.opt.termguicolors = true
require("indent_blankline").setup {
	-- for example, context is off by default, use this to turn it on
	show_current_context = true,
	show_current_context_start = true,
	show_end_of_line = true,
    show_trailing_blankline_indent = true,
}

