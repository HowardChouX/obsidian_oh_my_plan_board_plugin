#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
VAULT="${1:-/Users/chou/obsidian_study_notes}"
TARGET="$VAULT/.obsidian/plugins/oh-my-plan-board"
npm run build
mkdir -p "$TARGET"
cp main.js manifest.json styles.css "$TARGET"/
printf 'installed to %s\n' "$TARGET"
