#!/bin/bash
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR" || exit 1

if [ ! -x "$APP_DIR/node_modules/.bin/electron" ]; then
    if command -v zenity >/dev/null 2>&1; then
        zenity --error --text="Electron is not installed.\nRun: cd \"$APP_DIR\" && npm install"
    else
        echo "Electron not found. Run: cd \"$APP_DIR\" && npm install" >&2
    fi
    exit 1
fi

exec "$APP_DIR/node_modules/.bin/electron" "$APP_DIR" --no-sandbox "$@"
