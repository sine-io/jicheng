# Route Workbench Instructions

## Selected product direction

- Source of truth: reference/selected-design.png, the first image of the latest generic-route ideation set.
- Generic places only. Do not introduce family roles, house hunting, scores, schedules, or sequential trips.
- Multiple origin tabs, exactly one active origin, shared destinations, map above transport-time table.
- AMap JS API 2.0 is connected through a same-origin Worker proxy. User-owned runtime settings are AMAP_JS_KEY and AMAP_JS_SECURITY_CODE. Never commit credential values or return the security code to the browser.
- Use real POIs, GCJ-02 geographic coordinates, and provider route times/paths. Never silently substitute fixture data or estimates.
- Baidu and open-source providers remain disabled until actually configured and implemented.
- Start with empty locations. One active origin, shared destinations, and four travel modes. No persistence was requested; locations remain in current-page memory.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and the static asset/SPA fallback contract intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build`, `npm run test:sites`, and `npm run test:maps`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
