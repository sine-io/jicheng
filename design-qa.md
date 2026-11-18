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

Production API verification will be recorded after deployment. Overall status: partial pending live verification.
