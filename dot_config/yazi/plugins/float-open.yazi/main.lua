--- @sync entry
return {
  entry = function()
    local h = cx.active.current.hovered
    if h and h.cha.is_dir then
      if os.getenv("YAZI_CHOOSER") == "1" then
        ya.emit("open", {})
      else
        ya.emit("enter", {})
      end
    else
      ya.emit("open", {})
      if os.getenv("YAZI_FLOAT") == "1" then
        ya.async(function()
          ya.sleep(0.1)
          ya.emit("quit", {})
        end)()
      end
    end
  end,
}
