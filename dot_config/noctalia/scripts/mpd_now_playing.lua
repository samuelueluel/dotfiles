barWidget.setGlyph("music")
barWidget.setUpdateInterval(350)

local fullText = ""
local scrollPos = 0
local pauseTicks = 0
local DISPLAY = 70   -- visible character width
local PAUSE = 10     -- ticks to hold before scrolling starts
local fetchTick = 9  -- trigger fetch on first update

function update()
    fetchTick = fetchTick + 1
    if fetchTick >= 10 then
        fetchTick = 0
        noctalia.runAsync("mpc current -f '%title% - %artist%'", function(result)
            if not result.timedOut and result.exitCode == 0 then
                local song = result.stdout:match("^(.-)%s*$")
                if song and song ~= "" then
                    if song ~= fullText then
                        fullText = song
                        scrollPos = 0
                        pauseTicks = PAUSE
                    end
                    barWidget.setVisible(true)
                else
                    fullText = ""
                    barWidget.setVisible(false)
                end
            end
        end)
    end

    if fullText == "" then return end

    if #fullText <= DISPLAY then
        barWidget.setText(fullText)
        return
    end

    local padded = fullText .. "    "
    local len = #padded
    local display = ""
    for i = 0, DISPLAY - 1 do
        local idx = ((scrollPos + i) % len) + 1
        display = display .. padded:sub(idx, idx)
    end
    barWidget.setText(display)

    if pauseTicks > 0 then
        pauseTicks = pauseTicks - 1
    else
        scrollPos = (scrollPos + 1) % len
    end
end

function onClick()
    noctalia.runAsync("niri msg action spawn -- ghostty --title=rmpc\\ Float -e rmpc")
end
