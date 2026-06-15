#!/bin/bash

source "$(dirname "$0")/_helpers.sh"

# Function for writing the user.js file (proxy disabled)
write_standard_user_js() {
    local user_js_file=$1
    cat <<EOL > "$user_js_file"
user_pref("network.proxy.type", 0);
user_pref("network.proxy.http", "");
user_pref("network.proxy.http_port", 0);
user_pref("network.proxy.ssl", "");
user_pref("network.proxy.ssl_port", 0);
user_pref("network.proxy.ftp", "");
user_pref("network.proxy.ftp_port", 0);
user_pref("network.proxy.socks", "");
user_pref("network.proxy.socks_port", 0);
user_pref("network.proxy.socks_version", 0);
user_pref("network.proxy.no_proxies_on", "localhost, 127.0.0.1");
EOL
}

# Find standard installation
PROFILE_DIRS=$(find ~/.mozilla/firefox/ -name "*.default-release*")
for PROFILE_DIR in $PROFILE_DIRS; do
    USER_JS_FILE="$PROFILE_DIR/user.js"
    if [ -f "$USER_JS_FILE" ]; then
        echo "Set proxy settings to default in $USER_JS_FILE"
        write_standard_user_js "$USER_JS_FILE"
    else
        echo "No user.js file found in $PROFILE_DIR"
    fi
done

# Find standard installation 2
PROFILE_DIRS2=$(find ~/.config/mozilla/firefox/ -name "*.default-release*")
for PROFILE_DIR in $PROFILE_DIRS2; do
    USER_JS_FILE="$PROFILE_DIR/user.js"
    if [ -f "$USER_JS_FILE" ]; then
        echo "Set proxy settings to default in $USER_JS_FILE"
        write_standard_user_js "$USER_JS_FILE"
    else
        echo "No user.js file found in $PROFILE_DIR"
    fi
done

# Find snap installation
SNAP_PROFILE_DIRS=$(find ~/snap/firefox/common/.mozilla/firefox/ -name "*.default*")
for SNAP_PROFILE_DIR in $SNAP_PROFILE_DIRS; do
    USER_JS_FILE="$SNAP_PROFILE_DIR/user.js"
    if [ -f "$USER_JS_FILE" ]; then
        echo "Set proxy settings to default in $USER_JS_FILE (Snap)"
        write_standard_user_js "$USER_JS_FILE"
    else
        echo "No user.js file found in $SNAP_PROFILE_DIR"
    fi
done

# Find flatpak installation
FLATPAK_PROFILE_DIRS=$(find ~/.var/app/org.mozilla.firefox/.mozilla/firefox/ -name "*.default-release*")
for FLATPAK_PROFILE_DIR in $FLATPAK_PROFILE_DIRS; do
    USER_JS_FILE="$FLATPAK_PROFILE_DIR/user.js"
    if [ -f "$USER_JS_FILE" ]; then
        echo "Set proxy settings to default in $USER_JS_FILE (Flatpak)"
        write_standard_user_js "$USER_JS_FILE"
    else
        echo "No user.js file found in$FLATPAK_PROFILE_DIR"
    fi
done

if pgrep -x firefox >/dev/null || pgrep -x firefox-bin >/dev/null; then
    pkill firefox 2>/dev/null || true
    pkill firefox-bin 2>/dev/null || true
fi
