#!/bin/bash

source "$(dirname "$0")/_helpers.sh"

if ! apply_mozilla_profiles_proxy clear_mozilla_proxy_user_js \
    "$HOME/.var/app/io.gitlab.librewolf-community/.librewolf" \
    "$HOME/.librewolf"; then
    echo "Error: LibreWolf is not installed." >&2
    exit 1
fi

if flatpak_app_installed io.gitlab.librewolf-community; then
    stop_flatpak_app io.gitlab.librewolf-community
elif command -v librewolf &> /dev/null; then
    pkill -x librewolf 2>/dev/null || true
fi
