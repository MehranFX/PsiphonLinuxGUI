#!/bin/bash

source "$(dirname "$0")/_helpers.sh"

if command -v vivaldi &> /dev/null; then
    kill_vivaldi_processes
elif command -v vivaldi-stable &> /dev/null; then
    kill_vivaldi_processes
elif flatpak_app_installed com.vivaldi.Vivaldi; then
    stop_flatpak_app com.vivaldi.Vivaldi
else
    echo "Error: Vivaldi is not installed." >&2
    exit 1
fi
