return {
  "Pocco81/auto-save.nvim",
  event = { "User AstroFile", "InsertEnter" },
  opts = {
    enabled = true, -- start auto-save when the plugin is loaded (i.e. when your package manager loads it)
    execution_message = {
      message = function() -- message to print on save
        return ("AutoSave: saved at " .. vim.fn.strftime "%H:%M:%S")
      end,
      dim = 0.18, -- dim the color of `message`
      cleaning_interval = 1250, -- (milliseconds) automatically clean MsgArea after displaying `message`. See :h MsgArea
    },
    trigger_events = { "InsertLeave", "TextChanged" },
    -- vim events that trigger auto-save. See :h events
    -- function that determines whether to save the current buffer or not
    -- return true: if buffer is ok to be saved
    -- return false: if it's not ok to be saved
    condition = function(buf)
      local fn = vim.fn
      local utils = require "auto-save.utils.data"

      if vim.bo.ft == "harpoon" then return false end
      vim.cmd "silent! wall"

      if fn.getbufvar(buf, "&modifiable") == 1 and utils.not_in(fn.getbufvar(buf, "&filetype"), {}) then
        return true -- met condition(s), can save
      end

      return false -- can't save
    end,
    write_all_buffers = false, -- write all buffers when the current one meets `condition`
    debounce_delay = 135, -- saves the file at most every `debounce_delay` milliseconds
    callbacks = {
      before_saving = function()
        -- save global autoformat status
        vim.g.OLD_AUTOFORMAT = vim.g.autoformat_enabled

        vim.g.autoformat_enabled = false
        vim.g.OLD_AUTOFORMAT_BUFFERS = {}
        -- disable all manually enabled buffers
        for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
          if vim.b[bufnr].autoformat_enabled then
            table.insert(vim.g.OLD_BUFFER_AUTOFORMATS, bufnr)
            vim.b[bufnr].autoformat_enabled = false
          end
        end
      end,
      after_saving = function()
        -- restore global autoformat status
        vim.g.autoformat_enabled = vim.g.OLD_AUTOFORMAT
        -- reenable all manually enabled buffers
        for _, bufnr in ipairs(vim.g.OLD_AUTOFORMAT_BUFFERS or {}) do
          vim.b[bufnr].autoformat_enabled = true
        end
      end,
    },
    autocmd = {},
  },
}
