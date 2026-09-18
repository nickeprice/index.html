# Puyallup River Companion Agent Guide

## Project shape

- This is a mobile-first, installable PWA for Washington river conditions and fishing logs.
- The frontend is plain HTML, CSS, and classic JavaScript. There is no package manifest, build step, bundler, framework, or module system.
- `index.html` owns markup. Scripts are loaded in dependency order and share the global scope; `src/app.js` must remain last.
- `src/app.js` owns UI state, navigation, the deterministic Gear Sim, guest auth, catch-log behavior, and bootstrap.
- `src/services/water.js` owns live telemetry reads and related DOM updates.
- `src/services/supabase.js` owns optional anonymous auth, private catch writes, public feed reads, and calibration RPC calls.
- `src/utils/regulations.js` and `src/data/` provide local WDFW regulation data and date/GPS calculations.
- `sw.js` defines the offline contract. Treat cache keys, cache strategies, and update behavior as user-visible behavior.
- `api/water_report.py` is the production-shaped Python serverless handler. `scripts/dev_server.py` serves static files and delegates `/api/*` to that handler.

## Working rules

- Read the relevant neighboring code before editing. Keep changes focused and preserve the existing classic-script architecture.
- Do not introduce npm tooling, a framework, ES modules, a bundler, or a new backend abstraction unless the task explicitly requires it.
- Preserve global function names and script load order when changing frontend behavior. Update every duplicated Gear Sim/Catch Log control when a shared field changes.
- Keep offline behavior graceful: telemetry may be unavailable, Supabase may be unreachable, and locally buffered catches must remain usable.
- Use `textContent` or DOM APIs for user/data text. Do not add unsanitized HTML interpolation.
- Treat GPS, tackle details, auth identifiers, and private catch rows as sensitive. Never expose them in the public feed, logs, debug UI, or new telemetry payloads.
- The browser key in `src/services/supabase.js` is publishable configuration; never add a service-role key, access token, or other secret to client files or committed docs.
- Database changes belong in an idempotent timestamped migration under `supabase/migrations/`. Preserve RLS on `public.catches`, the public-feed privacy boundary, and the intentional `SECURITY DEFINER` calibration RPC contract.
- If a change affects service-worker caching, update the cache version or cache logic deliberately and verify both online and offline behavior.
- Avoid broad rewrites, unrelated formatting, and speculative refactors. Do not commit or reset user changes.

## Validation

Run the narrowest relevant checks, then broaden when the change warrants it:

```bash
# JavaScript syntax
find src -name '*.js' -print0 | xargs -0 -n1 node --check
node --check sw.js

# Start the integrated local app/API server
python3 scripts/dev_server.py 8000
```

Open `http://127.0.0.1:8000/index.html` for browser checks. Exercise the affected tab or endpoint, and for service-worker or network changes check page errors, service-worker registration, cache behavior, and offline fallback.

For Python changes, use the repository interpreter and run a compile check when applicable:

```bash
python3 -m py_compile api/water_report.py scripts/dev_server.py scripts/scrape_wdfw.py
```

There is no committed test runner. The README describes the expected browser validation surface, including accessibility-label integrity, deep links, debounce behavior, toasts, and empty states.

## Data and network boundaries

- Live sources include USGS NWIS, Open-Meteo, NOAA tides, WDFW Socrata, the WDFW rules source, and Supabase.
- Third-party telemetry is intentionally network-only in the service worker unless the existing code documents otherwise.
- The water-report endpoint is slow by design because it fans out to external services; do not “fix” this by silently inventing or persisting stale live data.
- Use explicit fallback values such as `--` or an empty state when data is absent. Do not fabricate regulation, escapement, telemetry, or catch values.

## Existing workflow

`.clinerules` contains the repository’s plan/act workflow, including `TASK.md` requirements when the user asks for planning and the guard against repeated failing commands. Follow it alongside this guide.
