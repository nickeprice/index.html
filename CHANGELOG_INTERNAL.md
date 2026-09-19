# Internal Change Log

Keep this LEAN by design: a fresh chat reads only the LAST entries to restore
context. Completed-phase detail lives in `docs/ARCHIVE.md` + `git log`.

## 2026-09-18 — Phase 2.4.1 complete ✅ (timezone + scroll/bar + hero/pills/gear rows)
TIMEZONE: `api/water_report.py` now derives `now` from
`ZoneInfo('America/Los_Angeles')` (Vercel runs UTC), so the 4 cards, the TODAY tag
and the Sun/Mon/Tue netting check all agree with Pacific — verified live: day 0 =
`Friday, Sep 18`, `Sunday=NETS Monday=NETS`. SCROLL: dropped `height:100%` on
`html,body` (body was a nested scroller) and set body padding-bottom to
`calc(56px + env(safe-area-inset-bottom))`. BAR: safe-area inset moved back onto
`.bottom-tab-bar`; `.tab-btn` is a fixed 56px centred button. HERO: real
`[ FISHING OUTLOOK ]` `.sec-hdr` above a single centred line (reasons capped at 2),
in-pill `hero-lbl` gone. PILLS: `.env-badge` centres value+label with a reserved
sub-line slot on all 9 cells. COUNTS: fold renamed `▸ Forecast & Hatchery Report`,
`fetchEscapementLive` now also returns `max(:updated_at) AS lastUpdated`
(live `2026-09-18T07:09:37.303Z`) rendered as `Last updated Sep 18, 2026 · 12:09 AM`
local, else `Hatchery data may lag WDFW reporting.` RUN CARDS: peak day-counter +
`.run-footer` removed (peak date label kept). GEAR: both forms use 6 explicit
`.gear-row`s (leader row is 3-up), replacing the 2-col auto-flow grid.
- Key files: `api/water_report.py`, `index.html`, `src/app.js`,
  `src/services/water.js`, `src/styles.css`, `sw.js` (v2.00.12), `sanity_pass.js`
  (45 checks), `TASK.md`. NO DB migration. Not committed yet (awaiting approval).

## 2026-09-18 — HANDOFF: Phase 2.4.1 planned, NOT started (new chat starts here)
Phase 2.4 shipped as `b7b8f1d` (tree clean). The next batch is fully specified in
`TASK.md` -> ACTIVE Phase 2.4.1 with `- [ ]` boxes; read that file first.
Scope: (1) TIMEZONE BUG — `api/water_report.py` uses `datetime.now()` (server UTC)
so forecast days / TODAY tag / `dt.weekday()` netting drift from the Pacific
calendar ("nets in the river" showed on a Saturday); fix with
`ZoneInfo('America/Los_Angeles')`. (2) Scroll can't reach the bottom — drop
`html,body{height:100%}` and match body padding-bottom to the bar height.
(3) Bottom bar gap — safe-area inset belongs on `.bottom-tab-bar`, not the buttons.
(4) "FISHING OUTLOOK" becomes a real `.sec-hdr`; hero body is ONE centred line.
(5) Pills — centre value+label (drop `space-between`/`min-height:76px`).
(6) Counts fold -> "Forecast & Hatchery Report" + `:updated_at` MAX from Socrata
as a real "Last updated" line (verified live `max(:updated_at)`).
(7) Remove the "Peak in/was N d" footer from run cards. (8) Gear Sim/Catch Log gear
fields -> resting rows, one group per line, order preserved.
No DB migration needed this phase.

## 2026-09-18 — Phase 2.4 complete ✅ (one-screen forms, HUD cleanup, Foam 1+2)
Hero is now a labelled two-line "FISHING OUTLOOK" card. Conditions pills go
uniform (grid-auto-rows 1fr). Wind shows "mph" again. Counts fold is a small
in-family chevron (not a blue pill). Bottom tab bar safe-area inset applied ONCE
(fixes the gap above the home indicator). Gear Sim: stars + score-bar REMOVED —
HUD is LINE HEIGHT + BOTTOM CURRENT ("how hard the water pulls"); bed-velocity
renamed/explained. FLOW + DISTANCE inputs removed from BOTH tabs — flow is now
DERIVED from the live report (fallback last-known -> 1040) and still recorded;
cast_distance_ft writes null. All gear dropdowns lost their defaults: values
pre-fill per-device from the user's own last input (localStorage) and otherwise
stay blank + required (validator toasts "Fill in: …"). Leader Length is a number
input. Foam split into Foam 1 + Foam 2, both FEEDING the buoyancy model (verified
6.56" -> 11.37" for a second corky). Gear fields re-laid into a compact 2-column
grid (same order preserved) so both tabs fit one screen. Catch Log: Join the
Board back at the TOP, "Angler & Location" header removed, Date & Time moved to
Catch Result. Migration 20260918000400 adds foam_2 (agent applied + verified).
SW cache v2.00.11. Sanity 35/35 green.
- Key files: `index.html`, `src/app.js`, `src/services/water.js`,
  `src/services/supabase.js`, `src/styles.css`, `sw.js`, `sanity_pass.js`,
  `supabase/migrations/20260918000400_foam2.sql`.

## 2026-09-18 — Phase 2.3 complete ✅ (board-first catch log, compact hero, mobile polish)
Hero moved to the TOP of the water card, now a single compact line (verdict ·
best window · why) — half the old height. Conditions 3×3 pills given equal
min-heights so all rows are uniform. Run-meter gradient REMOVED (back to flat
status-colored fill + peak tick). Bottom tab bar: `viewport-fit=cover` added to
the meta (fixes rounded/notched phone safe-areas), tabs taller (60px, 12px).
Gear Sim HUD + headings compacted so the whole form fits on one screen. Catch
Log is now BOARD-FIRST: default scope = Everyone (columns Name/Time/River/Fish,
Flow dropped from public), sign-in moved DOWN above the board as "Join the
Board", GPS field + 📍 visual and Hook Location select removed (GPS still
captured silently; `river_name` derived from active station). New migration
`20260918000200_add_river_name_drop_today.sql` adds `river_name`, rebuilds
`public_catch_feed` (name/time/river/fish), and DELETES today's stray
`Nick · Coho · 1050 · 14:38Z` row. Sanity: 31/31 green.
Migrations applied to the live DB by the agent (`npx supabase db push`):
`20260918000200` (river_name + view + today-row delete) and `20260918000300`
(backfill the surviving 09-17 catch to `river_name='Puyallup River'`). Standing
convention persisted to `.clinerules`: always author DB changes as idempotent
timestamped migrations AND apply them via `db push` (never hand it to the user).
- Key files: `src/app.js`, `src/services/supabase.js`, `src/styles.css`,
  `index.html`, `sanity_pass.js`, `supabase/migrations/20260918000200_*.sql`,
  `supabase/migrations/20260918000300_*.sql`, `.clinerules`, `.gitignore`.

## 2026-09-18 — Phase 2.2 complete ✅ (UI honesty + readability + auto-refresh)
9-pill conditions grid rebuilt (Barometer / Precip% + in_NH-now-for hint /
PrecipVol + hint / Cloud / Temp + trend arrow / Wind + direction arrow, FIXED
double-"mph" / Sunrise-Sunset split / Moon / Solunar; Water Temp pill dropped,
it stays in the telemetry line). Backend now ships `temp_delta_f` +
`precip_phase/start/end` (hourly Open-Meteo `temperature_2m,precipitation`).
Mystery "Movement Index" + %-timeline REMOVED → `buildFishingHero()`: plain-
English verdict (Good/Mixed/Tough) + best window + why bullets (clarity "Dam
releasing…" folded in). Species calendar: Pink hidden on even years (2026),
counts toggle is a bright button (Forecast/Returned/Trapped/5-Yr Avg), run
meter is a cool→hot→cool gradient. Hamburger + drawer deleted (bottom tab bar
owns nav; center station header). Accessibility: body 11→14px, bigger labels,
brighter muted text. AUTO-REFRESH: `loadWaterReport(true)` every 5 min (visible
+ online), on foreground, on reconnect — never overwrites a typed Gear Sim CFS;
header ⟳ button added. SW cache v2.00.10. Sanity 28/28 green.
- Key files: `api/water_report.py`, `src/app.js`, `src/services/water.js`,
  `src/styles.css`, `index.html`, `sw.js`, `sanity_pass.js`, `TASK.md`.

## 2026-09-18 — 2.1d CONFIRMED write shipped (real numbers in the UI)
Human opened the real 2026 WDFW PDFs and confirmed: Puyallup Chinook 18,890 /
Puyallup Coho 53,588. `refresh_wdfw_forecast.py --confirm --chinook=18890
--coho=53588 --yes` wrote them into `src/data/wdfw_forecasts.json` (forecast
`null → 18890 / 53588`, year 2026, real source URLs). Fixed the frontend so the
confirmed numbers actually SURFACE: `refreshWdfwForecast()` added to
`src/services/water.js` (mirrors the escapement honest-data fill-only-matching-
cell pattern; fetches the static JSON, maps species, keeps "--" on failure);
called from `src/app.js` after `refreshEscapement`. Previously `wdfwForecast`
was hardcoded `null` in the renderer so the JSON could never display. SW cache
bumped to v2.00.9 so existing installs precache the confirmed numbers. Sanity
28/28 green.
- Key files: `src/data/wdfw_forecasts.json`, `src/services/water.js`,
  `src/app.js`, `sw.js`.

## 2026-09-18 — Phase 2.1 COMPLETE ✅ (a–f all shipped)
2.1a real transit data + netting scoped; 2.1b RUN & TIMING panel + movement
index; 2.1c clarity badge (Mud Mountain dam, Puyallup-only); 2.1d WDFW forecast
scraper (honest degrade — PDFs are vector graphics); 2.1e bottom tab bar +
pinch zoom + date-tap; 2.1f 9-pill conditions grid (backend `current` readings,
client `fetchWeatherConditions` deleted). Real fishing intel, no fabricated
counts. Sanity 28/28 green throughout.
- Key files: `api/water_report.py`, `src/app.js`, `src/services/water.js`,
  `src/styles.css`, `index.html`, `sw.js`, `scripts/refresh_wdfw_forecast.py`.

## 2026-09-18 — Phase 2.1e done: app feel (bottom tab bar, pinch zoom, date-tap)
Persistent fixed bottom tab bar (Water Report / Gear Sim / Catch Log) with
`role="tablist"` + `aria-selected`; `switchTab` now syncs the bar so deep links /
bootstrap keep it accurate. Viewport zoom restrictions dropped (pinch zoom back).
Date header is now a `<button onclick="resetToToday()">` (returns to Today when
paged forward, no-op at 0); long station names ellipsize. Body bottom padding +
safe-area for the fixed bar. SW cache v2.00.7.
- Key files: `index.html`, `src/app.js`, `src/styles.css`, `sw.js`.

## 2026-09-18 — Phase 2.1d done: WDFW forecast hybrid scraper
`scripts/refresh_wdfw_forecast.py` resolves the STABLE WDFW index → real 2026
Chinook/Coho PDF URLs, downloads, attempts stdlib zlib text extraction. The PDFs
are vector-graphic tables (no text layer) → honest degrade: prints URLs + hint,
writes nothing. `--confirm` now requires `--yes` double-confirm (safety, after a
careless test wrote 34k/48k seed guesses — caught + reverted to null). Forecasts
stay null (UI "--") until a HUMAN opens the PDFs and confirms real numbers.
check.sh + sanity compile-list now include the new script.
- Key files: `scripts/refresh_wdfw_forecast.py`, `src/data/wdfw_forecasts.json`,
  `scripts/check.sh`, `sanity_pass.js`.

## 2026-09-18 — Phase 2.1c done: clarity signal (White River / Mud Mountain Dam)
`fetch_dam_clarity()` reads USGS DAILY-VALUES (14-day series, 12098500 00060 +
12098000 62614) and derives an honest `clarity_outlook` — Puyallup sites only
(live: "Dam releasing (reservoir dropping)" on 12101500, `None` on Green).
Frontend renders a small `.clarity-badge` pill inline in the telemetry row,
gated on site_id ∈ Puyallup basin. NOTE: iv feed only returns single/dormant
records, so dv was the right honest trend source (never fabricates FNU).
- Key files: `api/water_report.py`, `src/app.js`, `src/styles.css`.

## 2026-09-18 — Phase 2.1b done: consolidated RUN & TIMING panel
Merged `[ HATCHERY ESCAPEMENT ]` + `[ SPECIES RUN CALENDAR ]` + `[ LEGAL HOURS
TIMELINE ]` into ONE `[ RUN & TIMING ]` panel: always-visible MOVEMENT INDEX
(0-100, human `reasons[]` behind `<details>`), per-species run cards (status
pill + progress bar + peak line always visible; `WDFW forecast / Return / Trap /
5-Yr Avg` counts folded per card), legal-hours windows kept inside.
`refreshEscapement` now fills count cells by `data-species`/`data-count` instead
of replacing a section; dead `buildEscapementSection` + `.esc-slot` removed.
- Key files: `src/app.js`, `src/services/water.js`, `src/styles.css`.

## 2026-09-18 — Phase 2.1a done; token-reduction pass applied
Backend accuracy shipped: real `transit_state`/`transit_time`, netting scoped to
Puyallup/White/Carbon (`NETTING_SITES`), fake `active_fish` Gaussian deleted,
`src/data/wdfw_forecasts.json` schema added (+ precache). Then cut full-history
docs (TASK.md 429->158, CHANGELOG pruned), added `docs/CONTRACT.md`,
`scripts/check.sh`/`scripts/smoke.sh`, `sanity_pass.js --quiet`, and lean
`.clinerules`.
- Key files: `api/water_report.py`, `src/data/wdfw_forecasts.json`, `sw.js`,
  `TASK.md`, `.clinerules`, `docs/ARCHIVE.md`, `docs/CONTRACT.md`,
  `scripts/check.sh`, `scripts/smoke.sh`, `sanity_pass.js`, `CHANGELOG_INTERNAL.md`.

## 2026-09-18 — Phase 2.1 plan persisted (handoff for a fresh Act chat)
Approved plan: surface REAL fishing intel, no fabrication. Removed the fake
`active_fish` Gaussian + cancelled hero line; netting scoped to Puyallup/White;
consolidate escapement+calendar+windows into one RUN & TIMING panel ("status
stays, numbers fold" via <details>); add movement index, clarity signal
(White River/Mud Mountain dam), WDFW forecast hybrid scraper, 9-pill grid, and
resurrected bottom-nav/pinch-zoom app feel.
- Key files: `TASK.md`, `.clinerules`, `CHANGELOG_INTERNAL.md`.

## 2026-09-18 — Phase G–H + real-device GPS shipped
Phase G: own-gauge water quality, merged My Catches + Brag Board, centered
station button, plain OPEN/CLOSED reg pill. GPS: Safari HTTPS + reliable
`/api/nearby_stations` + retry. Phase H: smooth tide area chart + species run
cards. Sanity pass 29 checks, live env verified.
- Key files: `api/water_report.py`, `src/app.js`, `src/services/water.js`,
  `src/styles.css`, `index.html`, `sw.js`, `sanity_pass.js`.

## Archive (older phases, one-liners)
- 2026-09-17 Phase E: env-matched community sonar weighting — `src/app.js`.
- 2026-09-17 Phase D: tide chart + species calendar + calibration env RPC — API/app/styles/migration.
- 2026-09-17 Phase B: catch-write fixes (Cheater rig, hook_size int) + env columns + My Catches.
- 2026-09-17 Phase A: correctness/safety — unified regs engine, XSS fixes, GPS hygiene.
- 2026-09-17 Live DB fully migrated (init_schema, normalize_rls, catch_writes, set_user_id_default).
