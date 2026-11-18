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


## Bicycle/electric bicycle and alternative routes update

- Kept generic origin/destination layout; added explicit bicycle and electric-bicycle columns plus a compact driving-preference row.
- Driving defaults to 高德推荐 (v3 policy 10); policies 12/0/14/13 cover avoid traffic, speed priority, lower tolls and no highways.
- Retain all valid provider alternatives in provider order. The chosen option changes minutes, distance, geometry and toll data as one result. Changes to origin, destination or driving policy hide obsolete option panels and invalidate results.
- Electric-bicycle backend adapter is ready for an independent Web-service Key; no such key is configured. UI says 待接入 and issues no electric-bicycle request. No bicycle-time conversion or simulated route is used.
- Local CUA verified five table headings, availability wording, and changing the driving-preference select to 躲避拥堵.
- An ignored development-only fixture exercised the actual RouteOptions component. CUA selected option 2 and verified that selected state and displayed distance/time changed from 20 minutes / 8000 m to 19 minutes / 9500 m. This fixture is labeled as test data and is excluded from the production build.
- Automated checks passed: 13 map adapter/route data cases and 15 Worker cases, including strategy 0, malformed alternatives, full-route switching, independent electric-bicycle response normalization, missing key, fixed upstream, and server-only Web key.
- Authenticated full-page live browser QA remains limited by the existing login gate. Production multi-strategy requests are checked separately after publishing.


## Electric-bicycle activation

The independent Web-service key is now configured as a server-side Site secret. Runtime configuration reports electricBikeEnabled=true without returning the Web key or security code. The v5 electric-bicycle API returned HTTP 200, info OK and two real alternatives for the public test origin/destination.

Live response paths place total travel time in path.duration, while individual steps contain cost.duration. Updated the adapter to prefer the provider's total duration and retain support for the previously documented nested path cost form. No duration is estimated or derived from the bicycle result. Regression tests cover this exact response shape, alternative switching and the enabled browser adapter path.

The previous pending-key state in this document is superseded by this activation. Full authenticated live browser QA remains limited by the existing login gate; production API and actual response normalization are verified independently.
