#!/bin/bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCHER="$APP_DIR/scripts/launch-psiphonlinuxgui.sh"
DESKTOP_SRC="$APP_DIR/packaging/psiphonlinuxgui.desktop"
DESKTOP_DEST="$HOME/.local/share/applications/psiphonlinuxgui.desktop"
ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"
ICON_DEST="$ICON_DIR/psiphonlinuxgui.png"

chmod +x "$LAUNCHER"

mkdir -p "$HOME/.local/share/applications" "$ICON_DIR"
sed "s|__APP_DIR__|$APP_DIR|g" "$DESKTOP_SRC" > "$DESKTOP_DEST"
cp "$APP_DIR/src/assets/icons/psiphonlinuxgui.png" "$ICON_DEST"

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
fi

echo "Installed: $DESKTOP_DEST"
echo "Launch from app menu: Psiphon"
echo "Pin to panel: Menu → Psiphon → right-click → Add to panel"
