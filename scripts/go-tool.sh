#!/bin/sh
set -eu
if [ -n "${GO_BINARY:-}" ]; then
 GO_BIN="$GO_BINARY"
elif [ -f .go-toolchain ]; then
 GO_BIN=$(cat .go-toolchain)
else
 GO_BIN=go
fi
exec "$GO_BIN" "$@"
