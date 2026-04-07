#!/bin/bash

# Launch Vivaldi Casual
vivaldi-stable --ozone-platform-hint=wayland --app-id-window-class=VivaldiCasual --class=VivaldiCasual --user-data-dir=/var/home/samuel/.config/vivaldi-casual &

# Launch Vivaldi LLM
vivaldi-stable --ozone-platform-hint=wayland --app-id-window-class=VivaldiLLM --class=VivaldiLLM --user-data-dir=/var/home/samuel/.config/vivaldi-llm &

# Launch Quod Libet
quodlibet &

# Launch Alacritty
alacritty &
