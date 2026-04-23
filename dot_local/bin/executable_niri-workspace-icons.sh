#!/bin/bash

# Noctalia accent color
ACCENT_COLOR="#00B6C2"

# Get current focused workspace ID
ACTIVE_WS=$(niri msg -j workspaces | jq '.[] | select(.is_focused == true) | .id')

# Map app_ids to Nerd Font icons
# We use these because GTK labels in Waybar cannot easily render multiple 
# different themed pixel-icons in a single string.
RESULT=$(niri msg -j windows | jq --argjson ws "$ACTIVE_WS" --arg accent "$ACCENT_COLOR" -rc '
    [ .[] | select(.workspace_id == $ws) ] | 
    sort_by(.layout.pos_in_scrolling_layout[0]) | 
    map(
        (.app_id as $id | 
        (if $id == "VivaldiLLM" then "󰗚"
         elif $id == "VivaldiCasual" then "󰈹"
         elif $id == "VivaldiWork" then "󰖟"
         elif $id == "alacritty-custom" then ""
         elif $id == "io.github.quodlibet.QuodLibet" then ""
         elif ($id | test("alacritty")) then ""
         elif ($id | test("vivaldi")) then "󰈹"
         else "" end) as $icon |
        if .is_focused then "<span color=\"" + $accent + "\" size=\"large\">" + $icon + "</span>"
        else $icon end)
    ) | join("  ") | {text: ., tooltip: .}')

echo "${RESULT:-"{\"text\":\"\"}"}"
