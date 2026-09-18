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

## Next (planned but not yet executed)

- [ ] Align `hook_size`/`corky_size`/`yarn` column types to `text` (Cheater `"c12"` rows)
- [ ] Wire `barometer`, `gauge_height`, `water_temp_f` into catch writes
- [ ] "My Catches" edit/delete UI
- [ ] Regulations detail panel (zone, species, closures, season dates)
- [ ] Rig preset persistence + tide chart + per-species run calendar
