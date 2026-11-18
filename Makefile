.PHONY: generate dev test build release

generate:
	./scripts/go-tool.sh tool templ generate

dev:
	./scripts/dev.sh

test:
	GOMAXPROCS=4 ./scripts/go-tool.sh test -race -p 2 -tags nomsgpack ./...

build:
	./scripts/build.sh

release:
	./scripts/build-release.sh
