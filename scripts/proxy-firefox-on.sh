#!/bin/bash

source "$(dirname "$0")/_helpers.sh"

# Function for writing the user.js file
write_user_js() {
    local profile_dir=$1
    write_mozilla_proxy_user_js "$profile_dir"
}

launch_firefox_with_proxy() {
    wait_for_psiphon_proxy || exit 1

    if pgrep -x firefox >/dev/null || pgrep -x firefox-bin >/dev/null; then
        pkill firefox 2>/dev/null || true
        pkill firefox-bin 2>/dev/null || true
        sleep 1
    fi
    launch_browser firefox
}

# Search Firefox Installation
PROFILE_DIR=$(find ~/.mozilla/firefox/ -name "*.default-release*" 2>/dev/null | head -1)
PROFILE_DIR2=$(find ~/.config/mozilla/firefox/ -name "*.default-release*" 2>/dev/null | head -1)
SNAP_PROFILE_DIR=$(find ~/snap/firefox/common/.mozilla/firefox/ -name "*.default*" 2>/dev/null | head -1)
FLATPAK_PROFILE_DIR=$(find ~/.var/app/org.mozilla.firefox/.mozilla/firefox/ -name "*.default-release*" 2>/dev/null | head -1)

if [ -n "$PROFILE_DIR" ]; then
    write_user_js "$PROFILE_DIR"
elif [ -n "$PROFILE_DIR2" ]; then
    write_user_js "$PROFILE_DIR2"
elif [ -n "$SNAP_PROFILE_DIR" ]; then
    write_user_js "$SNAP_PROFILE_DIR"
elif [ -n "$FLATPAK_PROFILE_DIR" ]; then
    write_user_js "$FLATPAK_PROFILE_DIR"
else
    echo "Error: Firefox is not installed." >&2
    exit 1
fi

launch_firefox_with_proxy
