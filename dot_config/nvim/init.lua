-- ============================================================
-- Bootstrap lazy.nvim
-- ============================================================
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not (vim.uv or vim.loop).fs_stat(lazypath) then
  local out = vim.fn.system({
    "git", "clone", "--filter=blob:none", "--branch=stable",
    "https://github.com/folke/lazy.nvim.git", lazypath,
  })
  if vim.v.shell_error ~= 0 then
    error("Failed to clone lazy.nvim:\n" .. out)
  end
end
vim.opt.rtp:prepend(lazypath)

-- ============================================================
-- Options (apply everywhere)
-- ============================================================
local opt = vim.opt

opt.clipboard    = "unnamedplus"   -- sync with system clipboard
opt.ignorecase   = true            -- case-insensitive search...
opt.smartcase    = true            -- ...unless you type a capital
opt.scrolloff    = 8               -- keep lines above/below cursor
opt.timeoutlen   = 300             -- faster which-key / chord timeout

-- These only make sense outside VS Code (VS Code handles them visually)
if not vim.g.vscode then
  opt.number         = true
  opt.relativenumber = true
  opt.cursorline     = true
  opt.wrap           = false
  opt.termguicolors  = true
  opt.signcolumn     = "yes"
  opt.splitright     = true
  opt.splitbelow     = true
end

-- ============================================================
-- Keymaps
-- ============================================================
vim.g.mapleader = " "

local map = function(modes, lhs, rhs, opts)
  opts = vim.tbl_extend("force", { silent = true }, opts or {})
  vim.keymap.set(modes, lhs, rhs, opts)
end

-- Better j/k on wrapped lines (only useful outside VS Code)
if not vim.g.vscode then
  map({ "n", "v" }, "j", "gj")
  map({ "n", "v" }, "k", "gk")
end

-- Keep cursor centered when jumping
map("n", "<C-d>", "<C-d>zz")
map("n", "<C-u>", "<C-u>zz")
map("n", "n",     "nzzzv")
map("n", "N",     "Nzzzv")

-- Stay in visual mode when indenting
map("v", "<", "<gv")
map("v", ">", ">gv")

-- Clear search highlight
map("n", "<Esc>", "<cmd>nohlsearch<cr>")

-- ============================================================
-- VS Code mode indicator (nvim-ui-plus)
-- ============================================================
if vim.g.vscode then
  local vscode = require("vscode")
  local mode_map = {
    n = "normal", i = "insert", v = "visual", V = "visual",
    ["\22"] = "visual", c = "cmdline", R = "replace",
  }
  vim.api.nvim_create_autocmd("ModeChanged", {
    pattern = "*",
    callback = function()
      local m = vim.api.nvim_get_mode().mode
      vscode.action("nvim-ui-plus.setMode", {
        args = { mode = mode_map[m] or m }
      })
    end,
  })
end

-- ============================================================
-- Plugins
-- ============================================================
require("lazy").setup({

  -- Surround: ys/cs/ds + motion
  {
    "kylechui/nvim-surround",
    event = "VeryLazy",
    opts = {},
  },

  -- Flash: jump anywhere on screen with s + 2 chars + label
  {
    "folke/flash.nvim",
    event = "VeryLazy",
    opts = {
      -- Show labels on top of existing text (fewer visual artifacts in VS Code)
      label = { after = false, before = true },
    },
    keys = {
      -- s: jump to any visible location
      { "s", mode = { "n", "x", "o" }, function() require("flash").jump() end,            desc = "Flash jump" },
      -- S: jump to a treesitter node (select whole blocks, args, etc.)
      { "S", mode = { "n", "x", "o" }, function() require("flash").treesitter() end,      desc = "Flash treesitter" },
      -- r: in operator-pending mode, flash-select a remote target (e.g. yr + label)
      { "r", mode = "o",               function() require("flash").remote() end,           desc = "Flash remote" },
    },
  },

}, {
  -- Don't bother showing the lazy UI on startup
  change_detection = { notify = false },
})
