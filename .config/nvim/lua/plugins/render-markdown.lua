return {
  -- In-buffer markdown rendering
  {
    "MeanderingProgrammer/render-markdown.nvim",
    dependencies = { "nvim-treesitter/nvim-treesitter", "nvim-tree/nvim-web-devicons" },
    ft = { "markdown", "norg", "rmd", "org", "codecompanion" },
    opts = {},
    keys = {
      { "<Leader>m", desc = "Markdown" },
      { "<Leader>mt", "<cmd>RenderMarkdown toggle<cr>", desc = "Toggle render" },
      { "<Leader>me", "<cmd>RenderMarkdown expand<cr>", desc = "Expand margin" },
      { "<Leader>mc", "<cmd>RenderMarkdown contract<cr>", desc = "Contract margin" },
      { "<Leader>mb", "<cmd>RenderMarkdown buf_toggle<cr>", desc = "Toggle (buffer only)" },
    },
  },
  -- Browser preview (supports Hindi, mermaid, images, LaTeX)
  {
    "iamcco/markdown-preview.nvim",
    cmd = { "MarkdownPreviewToggle", "MarkdownPreview", "MarkdownPreviewStop" },
    ft = { "markdown" },
    build = function() vim.fn["mkdp#util#install"]() end,
    keys = {
      { "<Leader>mp", "<cmd>MarkdownPreviewToggle<cr>", desc = "Browser preview" },
      {
        "<Leader>ms",
        function()
          -- Exit visual mode first to set '< and '> marks
          vim.cmd('normal! "xy')
          local content = vim.fn.getreg("x")
          if content == "" then
            vim.notify("No selection", vim.log.levels.WARN)
            return
          end

          -- Auto-detect mermaid if not wrapped in code fence
          local is_mermaid = content:match("^%s*flowchart") or content:match("^%s*graph")
            or content:match("^%s*sequenceDiagram") or content:match("^%s*classDiagram")
            or content:match("^%s*stateDiagram") or content:match("^%s*erDiagram")
            or content:match("^%s*journey") or content:match("^%s*gantt")
            or content:match("^%s*pie") or content:match("^%s*gitGraph")
            or content:match("^%s*C4Context") or content:match("^%s*C4Container")
            or content:match("^%s*C4Component") or content:match("^%s*C4Dynamic")
            or content:match("^%s*C4Deployment")

          if is_mermaid and not content:match("```mermaid") then
            content = "```mermaid\n" .. content .. "\n```"
          end

          -- Escape backticks and backslashes for JS template literal
          content = content:gsub("\\", "\\\\"):gsub("`", "\\`"):gsub("%$", "\\$")

          local html = [[
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 40px auto; padding: 20px; }
    pre { background: #f4f4f4; padding: 16px; border-radius: 8px; overflow-x: auto; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; }
    .mermaid { background: white; padding: 20px; border-radius: 8px; }
  </style>
</head>
<body>
  <div id="content"></div>
  <script>
    mermaid.initialize({ startOnLoad: false, theme: 'default' });
    const renderer = new marked.Renderer();
    renderer.code = function({ text, lang }) {
      if (lang === 'mermaid') {
        return '<div class="mermaid">' + text + '</div>';
      }
      return '<pre><code>' + text + '</code></pre>';
    };
    marked.setOptions({ renderer: renderer });
    document.getElementById('content').innerHTML = marked.parse(`]] .. content .. [[`);
    mermaid.init(undefined, '.mermaid');
  </script>
</body>
</html>]]

          local tmp_file = "/tmp/nvim_md_preview.html"
          local f = io.open(tmp_file, "w")
          if f then
            f:write(html)
            f:close()
            os.execute("open -a 'Google Chrome' '" .. tmp_file .. "' &")
            vim.notify("Opened preview in Chrome", vim.log.levels.INFO)
          else
            vim.notify("Failed to write temp file", vim.log.levels.ERROR)
          end
        end,
        mode = "v",
        desc = "Preview selection in browser",
      },
    },
  },
}
