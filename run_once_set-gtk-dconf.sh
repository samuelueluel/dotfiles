#!/usr/bin/env bash
# chezmoi run_once: sets org.gnome.desktop.interface via gsettings/dconf.
# Without this, flatpak apps receive the wrong GTK theme via the
# xdg-desktop-portal-gtk settings portal (which reads dconf, not settings.ini).

if ! command -v gsettings &>/dev/null; then exit 0; fi

gsettings set org.gnome.desktop.interface gtk-theme        adw-gtk3-dark
gsettings set org.gnome.desktop.interface color-scheme     prefer-dark
gsettings set org.gnome.desktop.interface icon-theme       Papirus
gsettings set org.gnome.desktop.interface cursor-theme     oreo_spark_orange_cursors
gsettings set org.gnome.desktop.interface cursor-size      32
gsettings set org.gnome.desktop.interface font-name        'IBM Plex Sans Semi-Bold 12'
