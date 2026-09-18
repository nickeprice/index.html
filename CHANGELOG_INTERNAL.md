# Internal Change Log

## 2026-09-17 — Phase B: catch-write fixes, environment enrichment, and feature work
Fixed the Cheater-rig insert break (dropped `corky_size`, numeric `hook_size`), captured
gauge/barometer/water-temp/wind/moon into private catch rows, and added My Catches
(edit/delete), a regulations detail panel, and rig preset persistence.
- Key files: `src/app.js`, `src/services/supabase.js`, `src/services/water.js`,
  `src/styles.css`, `index.html`, `supabase/migrations/20260917000200_catch_writes_env_columns.sql`.

## 2026-09-17 — Live DB fully migrated
Pushed all four migrations to the live Supabase project (pztcfsqifbfkjvosygcy): init_schema,
normalize_rls, catch_writes_env_columns, and set_user_id_default. Verified live: `user_id`
now defaults to `auth.uid()` (guest inserts work), `corky_size` dropped, env columns added.
- Key file: `supabase/migrations/20260917000300_set_user_id_default.sql`.

## 2026-09-17 — Phase D: tide chart, species run calendar, calibration enrichment
API now returns `tide_curve` + `species_calendar` per report day; frontend renders a
compact tide sparkline and per-species run-status rows. Recreated `get_global_calibration`
with water-temp/wind/moon in the return (drop-then-create to avoid SQLSTATE 42P13) and
applied to the live project as migration 20260917000400; client maps the new fields.
- Key files: `api/water_report.py`, `src/app.js`, `src/styles.css`,
  `src/services/supabase.js`, `supabase/migrations/20260917000400_calibration_env_columns.sql`.

## 2026-09-17 — Phase E: environment-matched community sonar
communitySonar now weights each logged catch by how well its recorded water temp / wind /
moon match today's live conditions (envMatchWeight: 1.0 exact .. 0.25 poor, legacy rows
unpenalised at 1.0); computeStrikeZone uses the env-matched sample count for the zone
pull and reports how many samples matched. Verified with a headless node test.
- Key file: `src/app.js`.

## 2026-09-18 — Phase F: sanity pass + CI + live verification
Added `sanity_pass.js` (zero-dependency 18-check runner: syntax, markup/a11y integrity,
HTTP/API shape, behavior via DOM-stubbed app.js) and `.github/workflows/sanity.yml`
(push/PR + manual). First CI run passed (run 35306760950, job success). Also fixed a
real a11y bug the pass caught (station-search input lacked an accessible name).
Verified live: 3 existing catches prove the user_id default + write fixes work; their
null env columns are a timing artifact (predate the enrichment commit). GitHub Pages
not enabled - no deployed stale bundle. Source env wiring verified; a fresh in-app
catch on the current build should populate env columns.
- Key files: `sanity_pass.js`, `.github/workflows/sanity.yml`, `index.html`, `README.md`.

## 2026-09-18 — Live end-to-end catch insert verified ✅
Logged a fresh catch through the current build (guest session + Gear Sim + FEED DATA).
Live `public.catches` new row: water_temp_f=53, wind_speed_mph=0.5,
wind_dir_compass=SSE, moon_phase="First Quarter", barometer=29.99, gauge_height=10.18,
foam text, hook_size integer, sim_score=5. `public_catch_feed` shows it at the top with
only name/time/flow/fish. Full write path + env enrichment + RLS public read confirmed.

## 2026-09-18 — Real-device GPS fixed and verified (Safari)
The "Use My GPS" flow failed on iPhone Safari for two reasons: (1) iOS requires HTTPS
for geolocation, and (2) the browser->USGS direct bbox call hit USGS NWIS flakiness
(bbox queries 503/timeout). Fixed by:
- Route the GPS station lookup through a new same-origin `/api/nearby_stations?lat=&lon=`
  endpoint that queries a curated list of 15 WA river gauges (reliable multi-site USGS
  endpoint, filtered to fresh <=24h readings, sorted by distance) instead of the flaky
  bbox query. Better: returns real river gauges, not random creeks.
- Client retries once if the endpoint returns empty (covers a cold Cloudflare edge).
- Bumped service-worker cache to v2.00.3 so phones get the new bundle.
- dev_server.py: added `--host=` option (default 127.0.0.1 unchanged) so LAN/phone
  testing is possible (`--host=0.0.0.0`).
- sanity_pass.js: now covers `/api/nearby_stations` (19 checks all green).
Verified on the phone via Cloudflare HTTPS tunnel: Safari granted location, "Found:
Puyallup River at Puyallup, WA (1.0 mi)" selected the gauge. USGS NWIS bbox remains
flaky upstream; the curated-sites endpoint is the robust path.
- Key files: `api/water_report.py`, `src/app.js`, `sw.js`, `scripts/dev_server.py`,
  `sanity_pass.js`.
