#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export GOMAXPROCS="${GOMAXPROCS:-4}"
./scripts/go-tool.sh tool templ generate
mkdir -p bin dist/native dist/server dist/.openai
CGO_ENABLED=0 ./scripts/go-tool.sh build -p 2 -tags nomsgpack -trimpath -ldflags '-s -w' -o bin/route-workbench ./cmd/server
cp bin/route-workbench dist/native/route-workbench
cp worker/index.js dist/server/index.js
cp .openai/hosting.json dist/.openai/hosting.json
printf '%s\n' 'Built native Go application and optional Sites gateway.'
