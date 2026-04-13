#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/itemtracker}"
BRANCH="${BRANCH:-main}"
PM2_APP_NAME="${PM2_APP_NAME:-itemtracker}"

cd "$APP_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
npm install
pm2 restart "$PM2_APP_NAME"
