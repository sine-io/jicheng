# Design QA — route-query prototype

final result: blocked

## Comparison target

- Selected source: reference/selected-design.png, first displayed image in the latest generic-route ideation set.
- Source size: 1488 × 1056 pixels.
- Intended state: desktop, origin 1 selected, three shared destinations, four transport modes, Baidu label with explicit demo-data status.
- Intended desktop viewport: 1488 × 1056 CSS pixels, device scale factor 1.
- Browser implementation URL attempted: http://terminal.local:4173/
- Implementation screenshot: unavailable; no density normalization or same-state visual comparison was possible.

## Blocking finding

[P0 — verification blocker] The cloud browser cannot reach the development preview.

- The documented sites-preview command reports a running preview and relay, but the browser renders an upstream connection error before application HTML.
- Vite was independently started with the documented host and port, and an HTTP request from the same command returned 200.
- A restricted-container interface-enumeration issue was identified and given a small development-only fallback in vite.config.mjs. This permitted Vite to start, but did not restore the browser relay connection.
- Restarting the preview and starting it with a PTY did not restore the connection.
- No browser-rendered application screenshot, primary-interaction verification, responsive screenshot, or application-console check is available.
- Do not label this prototype visually verified, interaction-tested in a browser, or production ready.

## Required fidelity surfaces

- Fonts / typography: CSS targets Noto Sans CJK SC / platform Chinese fallbacks, with the hierarchy derived from the selected image. Browser verification pending.
- Layout / spacing: origin tabs, search controls, map, and full-width destination-time table implemented. Browser viewport and overflow verification pending.
- Colors / tokens: source teal, navy, white, blue/orange/green route accents implemented. Browser comparison pending.
- Image quality: generated fictional map background is in public/assets/city-map.png, 2048 × 768 pixels; inspected locally. Markers and controls use Phosphor icons; route paths are rendered by Leaflet Canvas from explicitly fictional fixtures. Screenshot comparison pending.
- Copy / content: generic origins and destinations only. Demo-data limitations are visible in header/footer, map-source menu, and explanatory dialog. No real mapping API is called. Browser verification pending.

## Completed non-browser validation

- Production build succeeded.
- Preserved Sites worker/build tests: 4 passed.
- Domain checks passed: current origin changes results; shared destination keys remain stable; initial fixtures are not mutated; open-source transit is unsupported; coincident endpoints produce zero minutes; all route endpoints are connected; copied point arrays are independent.

## Comparison history

No visual comparison iteration was possible. No full-view or focused-region screenshot comparison has been performed. Build and preview troubleshooting do not constitute design-QA evidence.

## Required next verification

1. Restore access from the cloud browser to the documented local preview.
2. Capture the implementation at the source viewport and create a side-by-side comparison input with the source image.
3. Inspect typography, geometry, map labels, and table controls at full view and focused crops.
4. Exercise origin switching, mode selection, add/edit/remove/undo, map selection, searches, empty states, unsupported transit, zoom, reset, and mobile layout.
5. Inspect the application console. Fix P0/P1/P2 findings, recapture, and compare again.
6. Change final result to passed only after evidence supports that outcome.
