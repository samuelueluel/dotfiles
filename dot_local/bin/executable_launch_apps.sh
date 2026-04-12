#!/bin/bash

# Launch Zen Personal
env MOZ_APP_REMOTINGNAME=zen-personal zen-browser --profile "$HOME/.config/zen/zen.personal" --new-instance &

# Launch Zen Utility
env MOZ_APP_REMOTINGNAME=zen-utility zen-browser --profile "$HOME/.config/zen/zen.utility" --new-instance &

# Launch Quod Libet
flatpak run io.github.quodlibet.QuodLibet &

# Launch Alacritty
alacritty &
