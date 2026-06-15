#!/bin/bash

source "$(dirname "$0")/_helpers.sh"

PROXY_SERVER="http=localhost:8081;https=localhost:8081;socks=localhost:1081"

if command -v vivaldi &> /dev/null; then
    kill_vivaldi_processes
    sleep 1
    launch_browser_with_proxy "$(command -v vivaldi)" "$PROXY_SERVER"
elif command -v vivaldi-stable &> /dev/null; then
    kill_vivaldi_processes
    sleep 1
    launch_browser_with_proxy "$(command -v vivaldi-stable)" "$PROXY_SERVER"
elif flatpak_app_installed com.vivaldi.Vivaldi; then
    launch_flatpak_with_proxy com.vivaldi.Vivaldi "$PROXY_SERVER"
else
    echo "Error: Vivaldi is not installed." >&2
    exit 1
fi
