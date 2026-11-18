.PHONY: generate dev test build

generate:
	./scripts/go-tool.sh tool templ generate

dev:
	./scripts/dev.sh

test:
	GOMAXPROCS=4 ./scripts/go-tool.sh test -race -p 2 -tags nomsgpack ./...

build:
	./scripts/build.sh
