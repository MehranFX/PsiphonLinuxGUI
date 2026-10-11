#!/usr/bin/env bash

CONFIG="$HOME/.config/psiphonlinuxgui/psiphon.config"

HTTP_PORT=$(grep -oP '"LocalHttpProxyPort"\s*:\s*\K[0-9]+' "$CONFIG")

check_port() {
    local pid process result

    # Only listeners — browsers using the proxy connect as clients and must not block startup
    pid=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)

    if [ -n "$pid" ]; then
        process=$(ps -p "$pid" -o comm= 2>/dev/null)
        echo "Port $PORT to connect to proxy server is occupied by process: $process (PID: $pid)"
        exit 1
    fi

    # Fallback: ss shows listeners only (-l)
    result=$(ss -tlnp "sport = :$PORT" 2>/dev/null | tail -n +2)

    if [ -n "$result" ]; then
        echo "Port $HTTP_PORT to connect to proxy server is occupied"
        exit 1
    fi

    echo "Port $PORT is free"
    exit 0
}

check_port
