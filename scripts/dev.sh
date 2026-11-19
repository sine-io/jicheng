#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export GOMAXPROCS="${GOMAXPROCS:-4}"
export LISTEN_ADDR="${LISTEN_ADDR:-127.0.0.1:${PORT:-4173}}"
./scripts/go-tool.sh tool templ generate
if [ -f .env.local ]; then
 set -a
 . ./.env.local
 set +a
fi
exec ./scripts/go-tool.sh run -tags nomsgpack ./cmd/server
