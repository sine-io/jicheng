#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export GOMAXPROCS="${GOMAXPROCS:-4}"
./scripts/go-tool.sh tool templ generate
for platform in linux windows; do
  executable=jicheng
  if [ "$platform" = windows ]; then executable=jicheng.exe; fi
  mkdir -p "bin/$platform-amd64"
  GOOS="$platform" GOARCH=amd64 CGO_ENABLED=0 ./scripts/go-tool.sh build -p 2 -tags nomsgpack -trimpath -ldflags '-s -w' -o "bin/$platform-amd64/$executable" ./cmd/server
done
printf '%s\n' 'Built Jicheng for Linux x64 and Windows x64.'
