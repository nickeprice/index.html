# Puyallup River Companion

A mobile-first fishing companion for Washington's Puyallup / White / Carbon /
Green / Nisqually rivers. Three tools in one shell:

1. **Water Report** — live USGS flow, barometer, tides, solunar, hatchery
   escapement, fishing-window scoring and WDFW legal hours.
2. **Gear Sim** — a deterministic fluid-dynamics engine that solves your rig
   against today's strike zone.
3. **Catch Log** — private catch records with a four-column public Brag Board.

Installable as a PWA and usable offline from a cached app shell.

## Architecture

Plain static frontend — no build step, no bundler, no framework. All scripts are
classic (non-module) scripts sharing one global scope, loaded in dependency
order at the end of `<body>`.

```
index.html                  markup only (~265 lines)
manifest.json               PWA manifest (icons, shortcuts, theme)
sw.js                       service worker (offline + caching strategy)
icons/                      generated app icons (any + maskable)
src/
  styles.css                all styling, incl. toasts / empty states / focus rings
  app.js                    application core: UI state, navigation, guest auth,
                            fluid dynamics engine, Gear Sim, Brag Board,
                            station selector, bootstrap
  services/
    supabase.js             Supabase client: anonymous auth, catch writes,
                            public feed, calibration RPC
    water.js                telemetry data layer: USGS NWIS, Open-Meteo,
                            WDFW Socrata escapement
  utils/regulations.js      WDFW regulations engine + local NOAA/Meeus solar calc
  data/riverRegulations.js  static regulation seed data
  data/wdfw_rules.json      fetched WDFW rules cache
api/
  water_report.py           Python serverless function: /api/water_report
supabase/
  migrations/               idempotent schema + RLS migrations
  README.md                 how to link / push / verify
scripts/scrape_wdfw.py      WDFW rules scraper
```

### Script load order

`supabase-js` (CDN) → `regulations.js` → `riverRegulations.js` →
`supabase.js` → `water.js` → `app.js`.

`app.js` must load last: it calls into the other modules and wires
`window.onload`.

## Backend

`/api/water_report?site=&lat=&lon=` is a Python `BaseHTTPRequestHandler`
(`api/water_report.py`), which is the shape Vercel expects for a Python
serverless function — no `vercel.json` or adapter is required. It aggregates
USGS NWIS, Open-Meteo and NOAA tides into a 4-day forecast, typically in 4–6 s.

The database is Supabase. Schema and RLS are managed as migrations in
`supabase/` — see [`supabase/README.md`](supabase/README.md) for how to apply
them.

## Data flow

- **Live telemetry** (`water.js`) is fetched concurrently via `Promise.all()` —
  CFS momentum, proxy water temperature and surface conditions are independent
  reads.
- **Strike zone** combines weather (barometer, cloud, rain, water temp) with
  *community sonar*: anonymised tackle telemetry from logged catches near the
  current flow, pulled from the `get_global_calibration()` RPC.
- **Physics is locked** at drag coefficient 1.0. Every simulation output is a
  pure function of the form inputs plus the catch log, so identical inputs
  always return identical numbers.
- **Offline-first writes**: a logged catch is buffered in `localStorage` first,
  then pushed to Supabase. Rows that fail to reach the server are flagged
  `pendingSync` and retried on the next session.

## PWA

`sw.js` caches by request type:

| Request | Strategy |
| --- | --- |
| Navigations | network-first, falling back to the precached app shell |
| `/api/water_report` | network-first, with a **normalised cache key** (the app appends a `_t=<timestamp>` cache-buster that is stripped before caching, so offline replay hits) |
| Same-origin static assets | stale-while-revalidate |
| Supabase SDK (CDN) | stale-while-revalidate |
| USGS / Open-Meteo / Socrata | network only — live telemetry is never cached |

Updates are **tap-to-apply**, never automatic: an auto-reload would discard a
catch an angler was mid-way through logging.

## Local development

No build step.

`api/water_report.py` exposes only a `handler` class — it has no `__main__`
block, because Vercel's Python runtime supplies the server. To run the whole app
locally, use the dev server, which serves the repo statically and delegates
`/api/*` to that same handler class:

```bash
python3 scripts/dev_server.py 8000
```

Then open `http://localhost:8000/index.html`.

The dev server subclasses `api/water_report.handler` rather than constructing a
second `BaseHTTPRequestHandler`. Constructing a new handler re-runs `handle()`,
which reads a *new* request line off a socket that has already been consumed —
the request then blocks forever. Subclassing avoids that entirely.

Note that the API is genuinely slow (4–6 s): it fans out to USGS NWIS,
Open-Meteo and NOAA tides on every call. The service worker caches the result,
so repeat loads are instant.

## Testing

There is no committed test runner; the codebase is validated by:

- `node --check` on every JS file (syntax).
- `label[for]` / `aria-*` integrity checks against the markup.
- A Playwright browser pass covering: page errors, accessible-name resolution,
  service-worker registration and cache population, API cache-key
  normalisation, offline replay, debounce behaviour, toast rendering, tab
  switching, `?tab=` deep links and the empty states.
