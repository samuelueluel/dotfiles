require("full-border"):setup {
	type = ui.Border.ROUNDED,
}

-- Format helper for file/directory size with consistent fixed column width
local function format_size(file)
	local size = file:size()
	if size then
		return string.format("%7s", ya.readable_size(size)), "yellow"
	end
	if file.cha.is_dir then
		local folder = cx.active:history(file.url)
		if folder then
			return string.format("%5d itm", #folder.files), "cyan"
		end
		return string.format("%7s", "DIR"), "cyan"
	end
	return string.format("%7s", "-"), "darkgray"
end

-- Format helper for timestamps (mm/dd HH:MM for current year, mm/dd YYYY for older)
local function format_time(ts)
	local time = math.floor(ts or 0)
	if time == 0 then
		return "            "
	elseif os.date("%Y", time) == os.date("%Y") then
		return os.date("%m/%d %H:%M", time)
	else
		return os.date("%m/%d  %Y", time)
	end
end

-- Always show Size + Modified Time
function Linemode:mtime()
	local sz, col = format_size(self._file)
	local t = format_time(self._file.cha.mtime)
	return ui.Line {
		ui.Span(sz .. "  "):fg(col),
		ui.Span(t),
	}
end

-- Always show Size + Birth Time
function Linemode:btime()
	local sz, col = format_size(self._file)
	local t = format_time(self._file.cha.btime)
	return ui.Line {
		ui.Span(sz .. "  "):fg(col),
		ui.Span(t):fg("magenta"),
	}
end

-- Size mode: Highlight Size + Modified Time
function Linemode:size()
	local sz, col = format_size(self._file)
	local t = format_time(self._file.cha.mtime)
	return ui.Line {
		ui.Span(sz .. "  "):fg(col):bold(),
		ui.Span(t),
	}
end

-- Status bar badge showing active sort method, direction, and linemode
Status:children_add(function(self)
	local pref = cx.active.pref
	if not pref then return end

	local sort_by = tostring(pref.sort_by or "")
	local dir = pref.sort_reverse and "↑" or "↓"
	local linemode = tostring(pref.linemode or "")

	return ui.Line {
		ui.Span(" ["):fg("darkgray"),
		ui.Span(sort_by .. " " .. dir):fg("cyan"):bold(),
		ui.Span(" │ "):fg("darkgray"),
		ui.Span("col:" .. linemode):fg("magenta"),
		ui.Span("] "):fg("darkgray"),
	}
end, 500, Status.RIGHT)
