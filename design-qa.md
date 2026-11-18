# AMap integration QA — 2026-11-16

Reference: reference/selected-design.png. Retained the chosen top origin tabs, search row, wide map, four-mode destinations table, teal palette, typography hierarchy, and responsive layout. Replaced demo provider/status/content with real AMap integration and an empty starting state.

## Browser observations

Managed preview successfully opened at the exact CLI URL http://127.0.0.1:4173/ using CUA. Inspected the desktop screenshot, map error state, provider menu, and usage dialog. The local preview has no production credentials: controls are disabled and the connection error is explicit. Baidu and open-source providers are disabled. The usage dialog explains one active origin/shared destinations and page-only state. No raw exception text is shown after the loader fix.

Full real-map browser flow and responsive loaded-map screenshots remain unverified until an authenticated live browser can access the deployed Site. Do not claim that this local error-state check verifies real POI search, map rendering, or route interaction.

## Automated checks

- Production build and required Worker/client/manifest outputs.
- Static asset and SPA fallback behavior retained.
- Runtime JS-key-only config; security code not returned to client.
- Fixed high-trust upstream allowlist; client key/jscode overridden; no Cookie/authorization forwarded.
- Upstream failures do not echo sensitive URLs.
- SDK coordinate, actual POI, route time and path normalization for all four modes.
- Transit walking/ride segments remain separate; no invented road connections.
- Missing data yields no-route/error, never simulated times or straight-line routes.
- All four JS route services receive the chosen origin/destination; transit receives city metadata.
- Aborted queued jobs do not issue stale-origin queries.

## Production verification

Deployed owner-private to the existing Site. Verified with its already-available service access credential, retained only in session memory and sent only to this exact Site.

- `/api/maps/config`: HTTP 200, provider amap, JS key present, security code absent.
- Place search for a public Tianjin landmark: HTTP 200, high-trust provider info OK, two actual POIs returned.
- Reverse geocoding: HTTP 200, actual address returned.
- Driving: HTTP 200, provider info OK, one route with distance, duration and steps.
- Transit: HTTP 200, provider info OK, three alternatives with segments.
- Cycling: HTTP 200, provider errcode 0, route with distance, duration and steps.
- Walking: HTTP 200, provider info ok, route with distance, duration and steps.

Corrected a production-only incompatibility: Cloudflare Workers rejects Fetch redirect mode `error`; the proxy now uses `manual` and rejects redirect responses without exposing their Location. Added regression checks and a receiver-safe fetch adapter. JSONP callbacks are restricted to valid identifiers and served with JavaScript MIME type.

The CUA live Site tab reached the normal ChatGPT login gate; no cloud-browser login session was available. The existing private audience was preserved. Full browser search/route interaction and loaded-map visual comparison remain unverified. Local layout, provider availability, usage dialog, server integration, production APIs and automated adapter behavior are checked. Overall status: implementation and live APIs verified; authenticated browser QA partial.
