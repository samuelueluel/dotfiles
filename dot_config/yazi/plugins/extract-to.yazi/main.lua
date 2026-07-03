local M = {}

local get_target = ya.sync(function()
  local h = cx.active.current.hovered
  if h then
    return { url = tostring(h.url), name = h.name, cwd = tostring(cx.active.current.cwd) }
  end
end)

function M:entry()
  local target = get_target()
  if not target then
    return
  end

  -- Prompt user for the destination directory
  local dest, event = ya.input({
    title = "Extract to:",
    value = target.cwd .. "/",
    pos = { "top-center", y = 3, w = 60 },
  })

  if event ~= 1 or not dest or dest == "" then
    return
  end

  -- Run decompression via ouch in the background
  ya.emit("shell", {
    "ouch d -y " .. ya.quote(target.url) .. " --dir " .. ya.quote(dest),
    block = false,
    confirm = false
  })
end

return M
