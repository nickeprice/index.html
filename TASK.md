# Phase A — Correctness & Safety (P0)

Resolved in the current session. Verification: JS/Python syntax checks, node smoke tests,
then a dev-server browser pass. The two regulation engines are now unified on
`src/utils/regulations.js` (the GPS-aware engine); the legacy
`src/data/riverRegulations.js` globals are no longer loaded.

- [x] `supabase/migrations/20260917000000_init_schema.sql` — `user_id uuid not null default auth.uid()`
      - Potential bugs: a `default auth.uid()` on a table created by an earlier migration cannot
        backfill rows (idempotent `create table if not exists` skips the default); fine here
        because the live DB already has the column and client sends `user_id: undefined` so the
        DB default applies for fresh inserts.
      - Verification: `grep -n "default auth.uid()" supabase/migrations/20260917000000_init_schema.sql`.
- [x] `index.html` — remove the legacy `src/data/riverRegulations.js` script (its globals shadowed
      the new engine at runtime; the new engine is the one that reads `wdfw_rules.json`).
      - Potential bugs: dangling references to `riverRegulations` globals anywhere else in the app
        would break after removal. Grep confirmed no other call sites.
      - Verification: `grep -rn "riverRegulations" index.html src/` shows no external references.
- [x] `src/app.js` — `updateActiveDateUI()` calls `checkRiverStatus(date, gpsCoords, riverName)`
      (new engine signature) and surfaces `reason`/`ruleDetail` on the status pill.
      - Potential bugs: a station whose stored `name` is a bare USGS label ("PUYALLUP RIVER AT
        PUYALLUP, WA") — the new engine matches by subtring via `matchRiverRules`, so it resolves.
        GPS coords are only passed when the station was explicitly GPS-selected, preserving the
        per-zone GPS logic without leaking live GPS into the pill.
      - Verification: node smoke test — `checkRiverStatus(new Date(2026,8,17), {lat:47.20,lon:-122.31},
        'Puyallup River')` returns the Clark's Creek zone and open/closed state.
- [x] `src/app.js` — `loadDatabase()` renders the Brag Board with DOM APIs / `textContent` instead
      of `innerHTML` (fixes stored XSS via angler names).
- [x] `src/app.js` — `getGPS()` no longer writes raw coordinates into the debug console
      (sensitive-data exposure).
- [x] `src/services/water.js` — `fetchCFSMomentum()` sorts readings chronologically so the 4-hour
      delta is order-independent.
- [x] `src/services/water.js` — `buildEscapementSection()` escapes species names (defense in depth).
- [x] `src/services/supabase.js` — `toCatchRow()` sends `user_id: undefined` when absent so the DB
      default `auth.uid()` applies (keeps RLS "own rows" intact for every anon session).

Verification run this session:
- `find src -name '*.js' -print0 | xargs -0 -n1 node --check` → OK
- `node --check sw.js` → OK
- `python3 -m py_compile api/water_report.py scripts/dev_server.py scripts/scrape_wdfw.py` → OK
- Node smoke: `checkRiverStatus` on Puyallup/Green/Nisqually returns correct zones & open state.
- Dev-server browser pass: page loads, API returns 4 report days, catch-log tab renders.

# Phase B — Catch-write fixes + environment enrichment + feature work

- [x] `supabase/migrations/20260917000200_catch_writes_env_columns.sql` — drop redundant
      `corky_size` integer (client wrote string `'c12'` for a Cheater rig -> broke inserts);
      add `water_temp_f`, `wind_speed_mph`, `wind_dir_compass`, `moon_phase`.
      - Potential bugs: the live table already exists, so `add column if not exists` is idempotent;
        dropping `corky_size` is safe because nothing reads it and `foam` is the source of truth.
      - Verification: `python3 -m py_compile` + migration statement check (5 statements).
- [x] `src/services/supabase.js` — `toCatchRow` sends `hook_size` as a number, removes
      `corky_size`, and maps `gauge`/`barometer`/`waterTemp`/`windSpeed`/`windDir`/`moon`
      to `gauge_height`/`barometer`/`water_temp_f`/`wind_speed_mph`/`wind_dir_compass`/`moon_phase`.
      - Verification: headless node test — Cheater rig + env payload maps correctly, numeric hook,
        no `corky_size` key.
- [x] `src/services/water.js` — stash `window.currentWindMph`/`currentWindDir` so `logData` can
      enrich the private row.
- [x] `src/app.js` — `logData()` captures gauge, barometer, water temp, wind, moon at log time
      (falls back to null when the report/telemetry is unavailable).
      - Verification: node teste of `toCatchRow` with the new payload shape.
- [x] `index.html` + `src/app.js` + `src/services/supabase.js` + `src/styles.css` — **My Catches**
      panel: fetch/edit/delete own rows via `Supa.fetchMyCatches/updateMyCatch/deleteMyCatch`
      (RLS owns-row policies already permit this). Rendered with DOM APIs (no innerHTML);
      hidden until signed in.
- [x] `index.html` + `src/app.js` + `src/styles.css` — **Regulations detail panel**: `#reg-detail`
      under the status pill shows zone name, open species, and rule detail (all `textContent`).
- [x] `src/app.js` — **Rig preset persistence**: `saveRig()` on sim (localStorage), `restoreRig()`
      on boot mirrors to both Gear Sim + Catch Log controls.

Verification:
- `find src -name '*.js' -print0 | xargs -0 -n1 node --check` → OK
- `python3 -m py_compile` → OK
- Headless `toCatchRow` test → PASS
- Dev server: index / styles / supabase.js / app.js all 200; API 4 days.

# Phase D — Tide chart, species calendar, calibration enrichment

- [x] `api/water_report.py` — `build_species_calendar(target_date)` computes per-stock
      run status (pre/peak/post/off + days-to-peak); each report now includes
      `species_calendar` and `tide_curve` (tide extremes for an SVG sparkline).
      - Verification: local API returns `tide_curve` + `species_calendar`; python
        compile; dev-server 200s.
- [x] `src/app.js` — `tideCurveSvg()` renders a compact inline SVG tide line;
      `buildSpeciesCalendarHtml()` renders the per-species run calendar rows.
      Injected into each day card between the escapement block and legal-hours timeline.
      - Verification: `node --check`; dev-server serves the new card HTML.
- [x] `src/styles.css` — tide SVG (line/dot/label) + species-calendar status colors
      (peak=green, approaching=yellow, tapering=amber, off=muted).
- [x] `supabase/migrations/20260917000400_calibration_env_columns.sql` — `drop function`
      then recreate `get_global_calibration` with `water_temp_f`, `wind_speed_mph`,
      `wind_dir_compass`, `moon_phase` in the return; re-grant execute to anon/
      authenticated/service_role.
      - Potential bug: `create or replace` cannot change a function's return type
        (SQLSTATE 42P13); the migration must drop-then-create, which it now does.
      - Verification: `npx supabase db push --yes` applied; live
        `pg_get_function_result` shows the new columns; migration history lists
        `20260917000400` as applied.
- [x] `src/services/supabase.js` — `fetchGlobalCalibration()` maps the new env fields
      (`waterTempF`, `windSpeedMph`, `windDirCompass`, `moonPhase`) so future sonar
      heuristics can use them.

Verification:
- `find src -name '*.js' -print0 | xargs -0 -n1 node --check` → OK
- `node --check sw.js`, `python3 -m py_compile` → OK
- Dev server: index/app.js/styles 200; API returns tide_curve + species_calendar
- Live DB: RPC return type includes env columns; all 5 migrations applied

## Remaining ideas (future)

- [ ] Use the new env fields in the sonar zone-shift heuristic (e.g. weight samples by
      matching water temp / wind / moon)
- [ ] Live end-to-end insert test of a real catch against the migrated DB
- [ ] Mobile GPS "Use My GPS" verified on a real device (desktop tested here)

# Phase E — Environment-matched sonar weighting

- [x] `src/app.js` — `envMatchWeight(row, rep)`: scores a logged catch's recorded
      water temp / wind / moon against today's live conditions. Returns 1.0 for an
      exact match, ~0.75 for a weak match, 0.25 floor for a strong mismatch, and 1.0
      for legacy rows with no env data (never penalised).
- [x] `src/app.js` — `communitySonar()` now computes a **weighted** center (matching
      catches pull harder) and reports `matched` count + a human note ("3 of 5 matches
      today's conditions" vs "few matching today's conditions").
- [x] `src/app.js` — `computeStrikeZone()` uses the env-matched sample count for the
      zone pull (matching catches pull more), and the zone explanation now says how
      many samples matched today's conditions.
      - Verification: headless node test — exact-env weight 1.00, poor temp/wind 0.75,
        legacy 1.00; communitySonar returns weighted center + matched count.
- [x] Verified with a dev-server pass (index/app.js/styles 200, API 4 days) + JS/Python
      syntax checks.

## Remaining ideas (future, after this)

- [x] **Real-device GPS "Use My GPS" verified on Safari** — fixed + confirmed working via
      Cloudflare HTTPS tunnel (Safari requires HTTPS for geolocation). Root causes were
      (1) iOS needs HTTPS, and (2) the browser→USGS direct bbox call hits USGS NWIS
      flakiness. Now routed through a reliable server-side `/api/nearby_stations` endpoint
      with a curated WA river-gauge list + client retry. Service-worker cache bumped.


# Phase F — CI + live verification

## Step 1 — CI workflow ✅
- [x] `.github/workflows/sanity.yml` — runs `node sanity_pass.js` on push/PR to `main`
      plus manual `workflow_dispatch`, ubuntu-latest, 10-min timeout, no install step,
      and asserts the pass leaves no dev-server processes behind.
      - Verification: first run (35306760950, triggered by `dabc9e7`) completed with
        conclusion `success`; job `sanity` → `success`.
- [x] `README.md` — documented the CI workflow under Testing.

## Step 2 — Live end-to-end catch insert test ✅

- [x] Sign in as a guest in the app, run the Gear Sim, FEED DATA, and confirm the catch
      lands in `public.catches` with env columns populated (`water_temp_f`,
      `wind_speed_mph`, `wind_dir_compass`, `moon_phase`) and shows on the Brag Board.
      - Verified live (2026-09-18): new catch (Nick · Coho · 1020 CFS) landed with
        `water_temp_f=53`, `wind_speed_mph=0.5`, `wind_dir_compass=SSE`,
        `moon_phase="🌓 First Quarter"`, `barometer=29.99`, `gauge_height=10.18`,
        `foam='10'` (text), `hook_size=2` (integer), `sim_score=5`. The public feed
        view shows it at the top (`name, time, flow, fish` — no private columns).

### Analysis (2026-09-18)
- Live DB has 3 catches (all by "Nick", Coho, `foam='10'`, `sim_score=5`) — so the
  `user_id` default + Cheater-rig/`hook_size` write fixes are working.
- All env columns on those rows are `null`, but that's a **timing artifact**: the
  newest catch (2026-09-18T03:17Z ═ 09-17 20:17 PT) predates the env-enrichment commit
  `1460edb` (20:45 PT). The pre-enrichment bundle cannot capture env data.
- GitHub Pages is **not enabled** for this repo (API: `pages: NOT ENABLED`), so there
  is no deployed stale bundle — the "app" is local dev-server only.
- Source wiring is verified correct: `logData()` builds gauge/barometer/waterTemp/
  windSpeed/windDir/moon; `toCatchRow()` maps them to the live columns.
- **Remaining check**: a fresh catch logged through the CURRENT build (manual, in-app)
  should populate the env columns. Do this on the dev server with a guest session.





- [x] `supabase/migrations/20260917000300_set_user_id_default.sql` — set `user_id`
      `default auth.uid()` on the live column. The Phase A migration's `create table
      if not exists` was a no-op on the pre-existing table, so the default never
      landed; this one is idempotent and fixes guest catch inserts.
      - Verification: live query `information_schema.columns` -> `column_default
        = 'auth.uid()'`, and `supabase_migrations.schema_migrations` lists all four
        migrations as applied.
- [x] Live push: `npx supabase db push --yes` applied `20260917000300` (plus the
      earlier `20260917000200` env-columns migration was already live).


