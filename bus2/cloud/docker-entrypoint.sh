#!/bin/sh
set -e

DATA="${DATA_DIR:-/data}"
mkdir -p "$DATA" "$DATA/media"
chown -R node:node "$DATA" 2>/dev/null || true
chown -R node:node /app 2>/dev/null || true

exec su-exec node "$@"
