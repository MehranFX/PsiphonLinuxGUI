#!/bin/bash

flatpak_app_installed() {
    flatpak info "$1" >/dev/null 2>&1
}

snap_app_installed() {
    snap list 2>/dev/null | awk '{print $1}' | grep -qx "$1"
}

# Find Mozilla-family profile dirs (handles spaces in profile names)
find_mozilla_profiles() {
    local base="$1"
    if [ ! -d "$base" ]; then
        return 0
    fi
    find "$base" -maxdepth 2 -type f -name 'prefs.js' -printf '%h\0' 2>/dev/null
}

PSIPHON_HTTP_PROXY_HOST="127.0.0.1"
PSIPHON_HTTP_PROXY_PORT="8081"
PSIPHON_SOCKS_PROXY_PORT="1081"
PSIPHON_PROXY_SERVER="http=${PSIPHON_HTTP_PROXY_HOST}:${PSIPHON_HTTP_PROXY_PORT};https=${PSIPHON_HTTP_PROXY_HOST}:${PSIPHON_HTTP_PROXY_PORT};socks=${PSIPHON_HTTP_PROXY_HOST}:${PSIPHON_SOCKS_PROXY_PORT}"

wait_for_psiphon_proxy() {
    local i
    for ((i = 1; i <= 40; i++)); do
        if curl -x "http://${PSIPHON_HTTP_PROXY_HOST}:${PSIPHON_HTTP_PROXY_PORT}" \
            --connect-timeout 2 -k -s -o /dev/null -w "%{http_code}" \
            https://example.com 2>/dev/null | grep -qE '^[23]'; then
            return 0
        fi
        sleep 0.5
    done
    echo "Error: Psiphon proxy is not running on ${PSIPHON_HTTP_PROXY_HOST}:${PSIPHON_HTTP_PROXY_PORT}. Connect in PsiphonLinuxGUI first." >&2
    return 1
}

write_mozilla_proxy_user_js() {
    local profile_dir="$1"
    cat <<EOL > "$profile_dir/user.js"
user_pref("network.proxy.type", 1);
user_pref("network.proxy.http", "${PSIPHON_HTTP_PROXY_HOST}");
user_pref("network.proxy.http_port", ${PSIPHON_HTTP_PROXY_PORT});
user_pref("network.proxy.ssl", "${PSIPHON_HTTP_PROXY_HOST}");
user_pref("network.proxy.ssl_port", ${PSIPHON_HTTP_PROXY_PORT});
user_pref("network.proxy.ftp", "${PSIPHON_HTTP_PROXY_HOST}");
user_pref("network.proxy.ftp_port", ${PSIPHON_HTTP_PROXY_PORT});
user_pref("network.proxy.socks", "${PSIPHON_HTTP_PROXY_HOST}");
user_pref("network.proxy.socks_port", ${PSIPHON_SOCKS_PROXY_PORT});
user_pref("network.proxy.socks_version", 5);
user_pref("network.proxy.no_proxies_on", "localhost, 127.0.0.1");
EOL
}

clear_mozilla_proxy_user_js() {
    local profile_dir="$1"
    cat <<EOL > "$profile_dir/user.js"
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

launch_detached() {
    nohup "$@" >/dev/null 2>&1 &
    disown -h $! 2>/dev/null || true
}

launch_shell_cmd() {
    export DISPLAY="${DISPLAY:-:0}"
    nohup setsid bash -c "$1" >/dev/null 2>&1 &
    disown -h $! 2>/dev/null || true
}

launch_browser() {
    export DISPLAY="${DISPLAY:-:0}"
    nohup setsid "$@" >/dev/null 2>&1 &
    disown -h $! 2>/dev/null || true
}

launch_browser_with_proxy() {
    local bin="$1"
    local proxy="${2:-http=127.0.0.1:8081;https=127.0.0.1:8081;socks=127.0.0.1:1081}"
    launch_browser "$bin" --proxy-server="$proxy"
}

kill_vivaldi_processes() {
    pkill -x vivaldi 2>/dev/null || true
    pkill -x vivaldi-stable 2>/dev/null || true
}

kill_chromium_processes() {
    pkill -x chromium 2>/dev/null || true
    pkill -x chromium-browser 2>/dev/null || true
    pkill -f '/usr/lib/chromium/chromium' 2>/dev/null || true
}

kill_google_chrome_processes() {
    pkill -f '/opt/google/chrome/chrome' 2>/dev/null || true
    pkill -f 'google-chrome-stable' 2>/dev/null || true
    pkill -f 'google-chrome ' 2>/dev/null || true
}

resolve_chromium_binary() {
    if [ -x /usr/lib/chromium/chromium ]; then
        echo /usr/lib/chromium/chromium
    elif command -v chromium &>/dev/null; then
        command -v chromium
    elif command -v chromium-browser &>/dev/null; then
        command -v chromium-browser
    fi
}

resolve_google_chrome_binary() {
    if command -v google-chrome-stable &>/dev/null; then
        command -v google-chrome-stable
    elif command -v google-chrome &>/dev/null; then
        command -v google-chrome
    fi
}

kill_browser_by_binary() {
    local bin="$1"
    case "$bin" in
        *chromium*|*/usr/lib/chromium/*)
            kill_chromium_processes
            ;;
        *google-chrome*|*chrome*)
            kill_google_chrome_processes
            ;;
        *)
            kill_chromium_processes
            kill_google_chrome_processes
            ;;
    esac
}

write_chrome_family_policy() {
    local config_base="$1"
    [ -n "$config_base" ] || return 0
    local policy_dir="${config_base}/policies/managed"
    mkdir -p "$policy_dir"
    cat > "${policy_dir}/psiphonlinuxgui.json" <<EOF
{
  "ProxyMode": "fixed_servers",
  "ProxyServer": "${PSIPHON_HTTP_PROXY_HOST}:${PSIPHON_HTTP_PROXY_PORT}",
  "ProxyBypassList": "localhost,127.0.0.1",
  "WebRtcIpHandlingPolicy": "disable_non_proxied_udp"
}
EOF
}

remove_chrome_family_policy() {
    local config_base="$1"
    [ -n "$config_base" ] || return 0
    rm -f "${config_base}/policies/managed/psiphonlinuxgui.json"
}

set_chrome_family_proxy_prefs() {
    local config_base="$1"
    CONFIG_BASE="$config_base" PSIPHON_HTTP_PROXY_HOST="$PSIPHON_HTTP_PROXY_HOST" PSIPHON_HTTP_PROXY_PORT="$PSIPHON_HTTP_PROXY_PORT" python3 - <<'PY'
import json
import os

config_base = os.environ.get("CONFIG_BASE", "")
host = os.environ.get("PSIPHON_HTTP_PROXY_HOST", "127.0.0.1")
port = int(os.environ.get("PSIPHON_HTTP_PROXY_PORT", "8081"))

if not config_base or not os.path.isdir(config_base):
    raise SystemExit(0)

for name in os.listdir(config_base):
    prefs_path = os.path.join(config_base, name, "Preferences")
    if not os.path.isfile(prefs_path):
        continue
    with open(prefs_path, encoding="utf-8") as f:
        data = json.load(f)
    data["proxy"] = {
        "mode": "fixed_servers",
        "server": f"http://{host}:{port}",
    }
    with open(prefs_path, "w", encoding="utf-8") as f:
        json.dump(data, f)
PY
}

clear_chrome_family_proxy_prefs() {
    local config_base="$1"
    CONFIG_BASE="$config_base" python3 - <<'PY'
import json
import os

config_base = os.environ.get("CONFIG_BASE", "")
if not config_base or not os.path.isdir(config_base):
    raise SystemExit(0)

for name in os.listdir(config_base):
    prefs_path = os.path.join(config_base, name, "Preferences")
    if not os.path.isfile(prefs_path):
        continue
    with open(prefs_path, encoding="utf-8") as f:
        data = json.load(f)
    data["proxy"] = {"mode": "system"}
    with open(prefs_path, "w", encoding="utf-8") as f:
        json.dump(data, f)
PY
}

launch_chrome_family_with_proxy() {
    local bin="$1"
    local config_base="$2"

    if [ -z "$bin" ]; then
        echo "Error: Browser is not installed." >&2
        return 1
    fi

    wait_for_psiphon_proxy || return 1

    kill_browser_by_binary "$bin"
    sleep 1

    if [ -n "$config_base" ]; then
        write_chrome_family_policy "$config_base"
        set_chrome_family_proxy_prefs "$config_base"
    fi

    launch_browser "$bin" \
        --proxy-server="${PSIPHON_HTTP_PROXY_HOST}:${PSIPHON_HTTP_PROXY_PORT}" \
        --no-first-run \
        --no-default-browser-check \
        --force-webrtc-ip-handling-policy=disable_non_proxied_udp
}

stop_chrome_family_browser() {
    local bin="$1"
    local config_base="$2"

    if [ -n "$config_base" ]; then
        remove_chrome_family_policy "$config_base"
        clear_chrome_family_proxy_prefs "$config_base"
    fi

    if [ -n "$bin" ]; then
        kill_browser_by_binary "$bin"
    fi
}

# Backward-compatible aliases
launch_chromium_with_proxy() {
    launch_chrome_family_with_proxy "${1:-$(resolve_chromium_binary)}" "${2:-$HOME/.config/chromium}"
}

set_chromium_proxy_prefs() {
    set_chrome_family_proxy_prefs "$HOME/.config/chromium"
}

clear_chromium_proxy_prefs() {
    remove_chrome_family_policy "$HOME/.config/chromium"
    clear_chrome_family_proxy_prefs "$HOME/.config/chromium"
}

launch_flatpak_with_proxy() {
    local app_id="$1"
    local proxy="${2:-http=127.0.0.1:8081;https=127.0.0.1:8081;socks=127.0.0.1:1081}"
    flatpak kill "$app_id" 2>/dev/null || true
    sleep 1
    export DISPLAY="${DISPLAY:-:0}"
    nohup setsid flatpak run "$app_id" -- --proxy-server="$proxy" >/dev/null 2>&1 &
    disown -h $! 2>/dev/null || true
}

launch_flatpak_app() {
    local app_id="$1"
    flatpak kill "$app_id" 2>/dev/null || true
    sleep 1
    export DISPLAY="${DISPLAY:-:0}"
    nohup setsid flatpak run "$app_id" >/dev/null 2>&1 &
    disown -h $! 2>/dev/null || true
}

stop_flatpak_app() {
    flatpak kill "$1" 2>/dev/null || true
}

restart_flatpak_app() {
    local app_id="$1"
    flatpak kill "$app_id" 2>/dev/null || true
    sleep 1
    launch_detached flatpak run "$app_id"
}

apply_mozilla_profiles_proxy() {
    local write_fn="$1"
    shift
    local found=0
    local base profile

    for base in "$@"; do
        while IFS= read -r -d '' profile; do
            "$write_fn" "$profile"
            found=1
        done < <(find_mozilla_profiles "$base")
    done

    if [ "$found" -eq 0 ]; then
        return 1
    fi
    return 0
}
