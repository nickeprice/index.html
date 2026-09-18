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

## Remaining (not yet executed)

- [ ] Per-species run calendar (surface server-side peak windows in the UI)
- [ ] Tide chart (visualization beyond text)
- [ ] Wind/moon columns consumed by `get_global_calibration` RPC for richer sonar
- [ ] End-to-end live Supabase insert test (needs a write to the real DB)

# Phase C — Live DB migration complete

- [x] `supabase/migrations/20260917000300_set_user_id_default.sql` — set `user_id`
      `default auth.uid()` on the live column. The Phase A migration's `create table
      if not exists` was a no-op on the pre-existing table, so the default never
      landed; this one is idempotent and fixes guest catch inserts.
      - Verification: live query `information_schema.columns` -> `column_default
        = 'auth.uid()'`, and `supabase_migrations.schema_migrations` lists all four
        migrations as applied.
- [x] Live push: `npx supabase db push --yes` applied `20260917000300` (plus the
      earlier `20260917000200` env-columns migration was already live).


