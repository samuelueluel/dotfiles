-- Function to find a firefox/zen based player
local function getPlayerName()
    -- We'll try to find a player starting with 'firefox'
    -- This covers Zen Browser instances
    return "firefox"
end

function update()
    local player = getPlayerName()
    noctalia.runAsync("playerctl -p " .. player .. " status", function(result)
        if not result.timedOut and result.exitCode == 0 then
            if result.stdout:find("Playing") then
                barWidget.setGlyph("player-pause")
            else
                barWidget.setGlyph("player-play")
            end
        else
            barWidget.setGlyph("player-play")
        end
    end)
end

function onClick()
    local player = getPlayerName()
    -- Using -a (all) might be safer if there are multiple, 
    -- but usually we just want to toggle the current one.
    noctalia.runAsync("playerctl -p " .. player .. " play-pause")
end
