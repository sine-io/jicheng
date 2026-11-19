# 几程 (Jicheng) Project Instructions

## Product decisions

- Product name: **几程** (Jicheng). Page title: **几程 · 多起点多终点地图**. Use `jicheng` for the Go module, binary and release directory. The name is a creative naming choice, not a verbatim quotation from Nalan Xingde.

- Current visual reference: `reference/cal-light-design.png`. Keep the layout established in `reference/map-first-sketch.png`: full viewport map, one floating bottom search, and a collapsible route panel. Use white and gray surfaces, near-black type and Phosphor icons. Keep map and route colors for geographic and destination information. `reference/selected-design.png` is a historical reference only.
- Search and direct map clicks preview a place; only explicit “设为起点” / “设为终点” saves it. Adding an origin appends and activates it, never silently replaces the previous origin. Shared destinations are independent trips, not waypoints. Duplicate assignment in the same list reuses the existing place.
- Generic origins/destinations only. No family roles, house hunting, scores, schedules or sequential trips.
- Multiple origin tabs, exactly one active origin, shared destinations. Begin with empty locations. Refresh creates a new page workspace; persistence was not requested.
- Only AMap is implemented. Keep Baidu, Tencent, Tianditu and self-hosted map options disabled until genuinely integrated.
- Use real POIs, GCJ-02 coordinates, provider durations and paths. No simulated times, speed conversions or straight-line substitutes.
- Bicycle and electric bicycle use independent APIs. Keep every usable provider alternative in provider order. Update duration, distance, geometry and toll data together.
- Driving defaults to v3 strategy 10; named choices 12/0/14/13 remain available.

## Required stack

- The user explicitly selected **Go + Gin + templ + htmx**. Do not restore React/Vite or switch frameworks.
- Initial page is server-rendered. All business actions use htmx 2.x XMLHttpRequest and targeted HTML fragments, without replacing the whole document or the `#route-map` node.
- Go owns location, query and selected-route state. Plain JavaScript owns only map rendering and UI glue. Keep a single AMap instance across partial updates.
- `internal/ui/page.templ` is the source; regenerate and commit `page_templ.go` together. Keep version-pinned `go tool templ` in go.mod.
- Cancel outdated queries and guard revisions. Initialize all destination result rows before concurrent writes; run the race detector for changes to query/state code.
- Each page workspace belongs to its HttpOnly browser session and requires its CSRF token for writes. Keep user-provided text escaped in HTML and map labels.
- Read AMap keys only from runtime environment or the ignored `.env` file. Only direct loopback access to a loopback listener may save keys through the CSRF-protected settings form. JS security code and Web-service Key must never appear in frontend config, source, test snapshots, request logs or error URLs.

## Runtime and hosting

- Build an actual native Go server with embedded assets. Go 1.26+, Gin 1.12.0, templ 0.3.1118, vendored htmx 2.0.11.
- `make dev` starts the native app. In this workspace use the Sites managed preview CLI and its exact URL; do not start a second competing dev server.
- `package.json` is only managed-preview orchestration, not a frontend build dependency. `worker/index.js` is only an optional gateway to an independently hosted Go process.
- The existing Sites runtime cannot directly execute Go. Do not publish the gateway until `GO_APP_ORIGIN` and `GO_PROXY_TOKEN` are configured and verified. Preserve `.openai/hosting.json` project identity and existing Site audience.
- Source migration and production deployment are distinct. Report actual deployment status; do not imply that a saved source version is already running online.

## Checks

- `go tool templ generate`
- `GOMAXPROCS=4 go test -race -p 2 -tags nomsgpack ./...`
- `go vet -tags nomsgpack ./...`
- `node --test tests/gateway.test.mjs`
- `make build`

`scripts/go-tool.sh` resolves Go via `GO_BINARY`, ignored `.go-toolchain`, or PATH. Use it when the environment's `go` command is not the Go language SDK. Keep development secrets, binaries, dist, SDKs and transient browser artifacts out of Git and source archives. `reference/native-go-preview.jpg` is an intentional verification snapshot. Validate real map/search/query behavior in the browser when runtime credentials are available and record evidence and limits in `design-qa.md`.
