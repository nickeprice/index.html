## ACTIVE  Phase 2.4 — Compact one-screen forms, HUD cleanup, foam 1+2 (approved 2026-09-18, Act mode)

# Phase 2.4 — Fit both forms on one screen; HUD simplification; Foam 1 + Foam 2

## Locked decisions (user-confirmed)
1. Flow is DERIVED from the live report (fallback: last-known -> 1040); still recorded.
   Distance is dropped from view (writes null).
2. Per-device defaults from the user's most recent input; never-logged = blank + REQUIRED.
3. Foam 2 FEEDS THE PHYSICS (Foam 1 lift + Foam 2 lift). Both recorded.
4. Gear field ORDER IS PRESERVED (Rod/Weight -> Mainline -> Leader -> Hook/Yarn -> Foam1/Foam2 -> Beads).
5. Hero gets a label; pills even; counts fold small; bottom bar gap fixed; wind "mph" restored.
6. HUD: REMOVE stars + score-bar. Keep LINE HEIGHT + rename BED VELOCITY -> BOTTOM CURRENT.

## A. Hero (`src/app.js`, `src/styles.css`)
- [x] Add "FISHING OUTLOOK" label; 2-line clean layout.

## B. Pills (`src/styles.css`)
- [x] Even spacing: grid-auto-rows 1fr, no min-height/margin-top:auto weirdness.

## C. Wind (`src/services/water.js`)
- [x] Restore "mph" in applyReportWeather.

## D. Counts fold (`src/styles.css`)
- [x] Small chevron fold, in-family.

## E. Bottom bar (`src/styles.css`)
- [x] Fix safe-area double count.

## F. Gear fields (`index.html`, `src/app.js`, `src/services/supabase.js`)
- [x] Remove #flow/#distance/#flow-log/#distance-log from DOM.
- [x] Remove the 3 big h2 headers; keep order; full labels.
- [x] Leader Length -> number input. Foam -> Foam 1 + Foam 2.
- [x] No selected defaults; per-device prefill; blank+required (validator + toast).

## G. HUD (`index.html`, `src/app.js`)
- [x] Remove #stars + #score-bar; rename Bed Velocity -> BOTTOM CURRENT ("how hard the water pulls").

## H. Catch Log (`index.html`)
- [x] Join the Board back to TOP; remove "Angler & Location" header; Date & Time -> Catch Result.

## I. One-screen fit (`src/styles.css`)
- [x] Compact inputs/rows/labels + 2-col gear grid so each tab fits without scrolling.

## J. DB (`supabase/migrations/`, `src/services/supabase.js`)
- [x] foam_2 column migration + toCatchRow mapping (agent ran db push + verified live).

## Verify
- node --check all JS + sanity; py_compile; check.sh; sanity_pass.js (update harness);
  `npx supabase db push --yes < /dev/null`; live read-only verify; dev-server browse.

---
# ARCHIVED — Phase 2.3 (shipped)

# Phase 2.3 — Hero to top, uniform pills, compact Gear Sim, board-first Catch Log

## Locked decisions
1. DELETE only today's `Nick · Coho · flow 1050 · 2026-09-18T14:38Z` row.
   Yesterday's Nick row stays.
2. Commit a new migration: `river_name` column + `public_catch_feed` view update.
3. Sign-in moves DOWN, directly above the board (public board is the entry point);
   default scope = Everyone (Yours is secondary).

## 1. Compact hero at the top (`src/app.js`, `src/styles.css`)
- [x] Render `buildFishingHero(rep)` FIRST inside `.card`, above [ RIVER & ENVIRONMENTAL CONDITIONS ].
- [x] Halve height: single-line strip (verdict · best window · reasons joined by ·). No `<ul>` bullets.

## 2. Uniform pills (`src/styles.css`)
- [x] `.env-badge` fixed min-height + equal padding; reserve sub-line space so all 3 rows are identical height.

## 3. Remove run-meter gradient (`src/app.js`, `src/styles.css`)
- [x] Drop `.run-gradient` span + CSS; restore flat status-colored `.run-fill`.

## 4. Mobile-friendly bottom bar (`index.html`, `src/styles.css`)
- [x] Add `viewport-fit=cover` to viewport meta.
- [x] `.tab-btn` min-height 60px, font 12px, more padding.

## 5. Shrink Gear Sim top (`src/styles.css`)
- [x] Collapse `#hud` (stars ~1.2rem, tight margins), trim `#tab-gear-sim` h2/h3 spacing so the form fits one screen.

## 6. Catch Log rework (`index.html`, `src/app.js`, `src/services/supabase.js`, `src/styles.css`)
- [x] Remove GPS visual (field + 📍) from DOM; keep silent `payload.gps` capture.
- [x] Remove Hook Location select; send `loc=null`.
- [x] Move auth (sign-in/join) DOWN, directly above the board; fix clipped hint wording.
- [x] Default scope = Everyone; Everyone button first + active; headers Name/Time/River/Fish (public). Downloads Flow from public.
- [x] `normalizeFeedRow` + `loadDatabase` + `fetchPublicFeed` use `river`.
- [x] `toCatchRow` writes `river_name` (derived from active station/GPS; never raw coords).

## 7. Migration (`supabase/migrations/<ts>_add_river_name.sql`)
- [x] `alter table public.catches add column river_name text;` + rebuild `public_catch_feed` (name,time,river,fish) + re-grant.
      NOTE: DDL is repo-only (query tool is read-only) — apply via Supabase CLI/SQL editor.

## Verify
- `node --check` all JS + sanity; `python3 -m py_compile`; `bash scripts/check.sh`; `node sanity_pass.js` (update harness).
- Dev-server browse: hero on top + compact, uniform pills, no gradient, compact Gear Sim, board-first w/ sign-in above board, River column, today's Nick row gone.

---
# ARCHIVED — Phase 2.2 (shipped)


# Phase 2.2 — Conditions grid, plain-English hero, readable run cards, auto-refresh

## Locked decisions
1. Water Temp pill DROPPED from grid (stays in telemetry `°F H₂O` line).
2. Clarity ("Dam releasing…") folds into the hero WHY (no inline badge).
3. Precip % AND Precip Vol each show a live timing hint: `in {H/M}` before rain
   starts, `now for {H/M}` while raining (hourly forecast, threshold ≥30%).
4. Auto-refresh: `loadWaterReport(silent)` every 5 min (visible+online only),
   on `visibilitychange→visible`, and on `online` (re-fetch, not just a toast).
   Silent refreshes must NOT overwrite a manually typed Gear Sim CFS.

## A. Conditions grid → 9 pills (`api/water_report.py`, `src/app.js`, `src/styles.css`, `src/services/water.js`)
- [x] Backend: add `hourly=temperature_2m,precipitation` to the meteo fetch; ship
      `temp_prev_f`/`temp_delta_f` (trend arrow) and `precip_phase_pct` +
      `precip_start_text`/`precip_end_text` (`in 3H` / `now for 2H` / `--`).
- [x] Frontend: Barometer / Precip%+hint / PrecipVol+hint / Cloud / Temp+trend /
      Wind (arrow + fixed mph, FIX the `mphmph` bug) / Sunrise-Sunset split /
      Moon / Solunar. Labels: Precip %, Temp, Wind. Grid stays 3 cols.

## B. Hero replaces Movement Index + % timeline (`src/app.js`, `src/styles.css`)
- [x] Delete `computeMovementIndex()` + movement-index markup + `.run-windows`.
- [x] `buildFishingHero(rep)`: "👍 Good day" / "⚠️ Mixed" / "👎 Tough" + best
      window time + why bullets (clarity folded in). Reuses `getFMIColor`.

## C. Species calendar (`api/water_report.py`, `src/app.js`, `src/styles.css`)
- [x] `build_species_calendar`: skip Pink on even years (2026 hidden).
- [x] Counts toggle bolder/brighter; labels `Forecast`/`Returned`/`Trapped`/
      `5-Yr Avg` (Forecast first, bolded).
- [x] Run meter: full-track cool→hot→cool gradient (peak is the hot stop),
      translucent progress on top, peak tick stays.

## D. Remove hamburger nav (`index.html`, `src/app.js`, `src/styles.css`, `sanity_pass.js`)
- [x] Delete ☰ button, `#menu-drawer`, `toggleMenu()`; center station header;
      drop `toggleMenu()` from `switchTab`.
- [x] `sanity_pass.js`: remove `toggleMenu` from `need`, drop `.nav-btn` stub.

## E. Accessibility (`src/styles.css`)
- [x] Body 11px→14px; scale pill values/labels; brighten muted text; ≥44px
      tap targets; larger counts. Verify 320px reflow.

## F. Auto-refresh + cache bump (`src/app.js`, `sw.js`, `index.html`)
- [x] `loadWaterReport(silent)` guards Gear-Sim CFS overwrite; 5-min interval
      (visible+online), `visibilitychange→visible` refresh, `online` re-fetch.
- [x] Read/refresh affordance: ⟳ button + `updated_time` stamp in the header.
- [x] SW cache bump v2.00.9 → v2.00.10.

## Verify (whole phase)
- `find src -name '*.js' -print0 | xargs -0 -n1 node --check`, `node --check sw.js sanity_pass.js`
- `python3 -m py_compile api/water_report.py`
- `node sanity_pass.js` (harness updated) → all green
- Dev-server phone pass: 9 pills, hero, gradient meters, pink hidden in 2026,
  brighter counts, auto-refresh on foreground + interval, SW update toast intact.
- `CHANGELOG_INTERNAL.md` entry + commit only after user approves.

---
# ARCHIVED — Phase 2.1 (shipped)


## Context & locked decisions (READ BEFORE ANY EDIT)
- Goal: show the real run/movement story honestly. HARD RULE (AGENTS.md): never
  fabricate. The old `active_fish` ("~N entering today") is a hardcoded Gaussian
  (`peak_date` + `avg_run` × curve × 0.04) and is REMOVED permanently — never re-add.
- HERO LINE idea (old item A) — CANCELLED by user. Do NOT build a push hero strip.
- Design rules (user-approved "status stays, numbers fold"):
  1. Status / window / progress ALWAYS visible; raw counts fold behind a native
     `<details>/<summary>` tap (existing chevron pattern `.esc-section > summary::after`).
  2. One conditions grid, ever. No floating badges outside it.
  3. Collapse-by-default anything that is not "today / right now / should I go."
  4. `font-variant-numeric: tabular-nums` on every numeric readout; every value
     renders `--`/empty when absent (never fake). Use textContent/DOM for user/data
     text — no unsanitized HTML `innerHTML` interpolation.
  5. 3×3 pill grid stays 3 columns at ALL widths — DELETE the 6-col `@840px`
     `.env-stat-grid` rule in src/styles.css (~line 348) for this grid.


## Commit 2.1a — Backend accuracy (`api/water_report.py` only)

- [x] Ship the REAL `transit_state` + `transit_time`. They are computed in
      `calculate_transit_time_and_flow()` (~lines 374-393) but the payload only emits
      `push_status` (which is actually `calculate_macro_environment`'s env string —
      misnamed). Add `transit_state`/`transit_time` to the `reports.append({...})`
      dict (~lines 620-638).
      - Potential bugs: `transit_state` strings are long ("Bank Hugging / Resistance")
        — frontend must allow wrap/flex-wrap; keep `push_status` shipped for
        backward-compat but do NOT use it as the "fish moving" label.
      - Verification: `python3 -m py_compile api/water_report.py`; live API shows both keys.
- [x] Scope `NETTING_DAYS` ([6,0,1] = Sun/Mon/Tue) to Puyallup/White basin ONLY.
      In `do_GET` (~line 575) gate `is_netting_day` on site ∈
      {12101500, 12093500, 12094000}; other rivers → `is_netting_day=False` and a
      neutral `net_status`.
      - Potential bugs: off-basin rivers (Green 12113000, Nisqually 12089500,
        Skagit 12200500) must NEVER read "Nets In"; keep net_status honest there.
      - Verification: Green (12113000) API on a netting weekday → `is_netting:false`.
- [x] Delete the fake `active_fish` Gaussian in `calculate_escapement_curve()`
      (~lines 316-322: `avg_run * curve_mult * 0.04`). Do NOT replace with another
      count — the honest anchor is the WDFW forecast (Commit 2.1d) + real trap counts.
      - Potential bugs: make sure no frontend yet reads `active_fish` for counts
        (grep first). `species_calendar` (window/peak) is REAL structure — keep it.
      - Verification: `python3 -m py_compile`; `grep -n "active_fish"` shows no
        `avg_run * curve` math.
- [x] New `src/data/wdfw_forecasts.json` — curated `{ stock, year, forecast,
      source_url }` (Chinook, Coho; seed Puyallup Chinook ~34,000 / Coho ~48,000 from
      the REAL 2026 PDFs via 2.1d). Load statically (read-only); expose `wdfw_forecast`
      per stock in the report payload. Never a live/fabricated count.
      - Verification: file exists + valid JSON; `python3 -m py_compile`; app loads.
## Commit 2.1b — Consolidated RUN & TIMING panel (`src/app.js` + `src/styles.css`)

- [x] Replace the THREE separate sections
      (`[ HATCHERY ESCAPEMENT & RUN MOMENTUM ]` + `[ SPECIES RUN CALENDAR ]` +
      `[ LEGAL HOURS TIMELINE ]`) with ONE `[ RUN & TIMING ]` panel. Species rendered
      ONCE per card. Per-species card = status pill + window progress bar + peak line
      (ALWAYS visible) + counts `WDFW forecast / Return / Trap / 5-Yr Avg` (FOLDED
      behind `<details>/<summary>` per card).
      - CRITICAL: escapement counts load ASYNC via Socrata (`refreshEscapement` in
        water.js) AFTER card HTML renders. Merging means `refreshEscapement` fills the
        merged per-species cards' count cells (`data-species` + `data-count` keys on
        `.run-card`), NOT replace a whole section. `buildEscapementSection` +
        `.esc-slot` removed (dead).
      - Potential bugs: species key must match exactly between
        `buildSpeciesCalendarHtml` (lowercased `s.species`) and `hatcheryEscapement`
        stocks (lowercased `st.name`); off-track rivers → cards still render with
        `--` in the counts fold (never blank/crash).
      - Verification: `node --check`; headless render test (Chinook shows
        `12,345 / 88 / 10,000`, Coho shows `--` for nulls, counts fold present);
        `node sanity_pass.js` 28/28 green; API smoke on Puyallup 12101500 OK.
- [x] MOVEMENT INDEX (0-100) one-liner, ALWAYS visible; the WHY (`reasons[]` list)
      folds behind a `<details>`. Compute from live triggers already fetched (freshet
      delta, tide phase/arrival, moon, pressure trend, transit state, netting).
      Every point in `reasons[]` must be human-readable plain text — no magic number.
      - Potential bugs: clamp 0-100; `--` when triggers missing; never fabricate a
        trigger. textContent only.
      - Verification: headless test — `{rain:0.2, press_delta:-0.08, 2 highs,
        Bay Staging}` → `36` with 4 human reasons; clamps; sanity green.
- [x] Legal-hours windows stay INSIDE the RUN panel (same `.window-box` markup, ~app.js:754).
      - Verification: windows render inside `.run-windows` in the panel; sanity green.



## Commit 2.1c — Clarity signal (White River / Mud Mountain Dam)

- [x] `api/water_report.py` — for Puyallup sites ONLY, a 2nd USGS read of
      12098500 (White River near Buckley, 00060 streamflow) + 12098000 (Mud Mountain
      Lake, 00054 storage + 62614 elevation). Derive `clarity_outlook`:
      reservoir ELEVATION DROPPING + White FLOW RISING →
      "Dam releasing → turbidity rising downstream"; stable → "clearing".
      - Potential bugs: ONLY for sites 12101500 / 12093500 / 12094000; null-safe
        elsewhere; never invent an FNU value (AGENTS.md no fabrication).
      - NOTE: used the USGS DAILY-VALUES (dv) endpoint (14-day series) instead of
        iv — the iv feed returns only 1 record for these params (White River 00060
        is currently dormant; Mud Mountain returns a single fresh reading), so a
        real trend needs the daily series. Honest: single/dormant data → `None`.
      - Verification: `fetch_dam_clarity()` direct test →
        `'Dam releasing (reservoir dropping)'` (real 917.47 ft elevation trend);
        live API on Puyallup 12101500 → that outlook; Green 12113000 → `None`.
- [x] `src/app.js` — inline `clarity_outlook` as a small badge in the telemetry row,
      Puyallup sites only (NOT a new section).
      - Verification: badge renders in `.env-telemetry-row` (`.clarity-badge` pill)
        only when `site_id ∈ {12101500,12093500,12094000}` AND outlook present;
        sanity green.

## Commit 2.1d — WDFW forecast hybrid scraper (`scripts/refresh_wdfw_forecast.py`, NEW)

- [x] Fetch STABLE index `https://wdfw.wa.gov/fishing/management/north-falcon/forecasts`,
      match `<a>` text for current-year "Chinook forecasts" + "coho forecast", resolve
      the `href` (URL changes yearly; the index is stable). Download the PDF, extract
      the candidate Puyallup number, PRINT it + source for HUMAN CONFIRMATION BEFORE
      writing `src/data/wdfw_forecasts.json`.
      - Potential bugs: no pypdf / pdfminer / pdftotext installed in this repo →
        degrade to printing the resolved PDF URL + hint, and NEVER write unverified
        numbers (AGENTS.md no-fabricate). One toggle: `--confirm` writes only the
        confirmed number.
      - VERIFIED: resolved the real 2026 URLs (chinook `2026-2025-chinook-forecasts-03102026-revision.pdf`,
        coho `2026-coho-forecast-summary-draft-handout-02272026.pdf`). The PDFs are
        VECTOR-GRAPHIC TABLES with no text layer (stdlib zlib decompression yields
        only drawing ops) — no honest automated extraction is possible without a
        PDF lib/OCR, so the script prints the source URLs + hint and writes nothing.
      - SAFETY: `--confirm` now also requires `--yes` (double-confirm) so a
        placeholder number can never silently land in the JSON. During testing a
        careless `--confirm --chinook=34000 --coho=48000` wrote seed guesses into
        the real JSON — caught, reverted to null, and hardened with `--yes`.
      - Verification: `python3 -m py_compile`; run resolves links + prints URLs,
        writes nothing; unsafe invocations refused; JSON stays `[null, null]`.
      - NOTE: forecasts remain `null` (UI "--") until a HUMAN opens the two PDFs
        and runs `--confirm --chinook=<N> --coho=<M> --yes`. The seed guesses 34k/48k
        are NOT written (unverified).



## Commit 2.1e — App feel (resurrected D + E, previously dropped)

- [x] `index.html` — persistent fixed bottom tab bar (Water Report / Gear Sim /
      Catch Log) calling the existing `switchTab`; keep the menu-drawer; add
      `role="tablist"`/`aria-selected`; body bottom padding + safe-area.
      - Potential bugs: `switchTab` toggles `.tab-active` — the bar must stay synced
        when deep links / bootstraps switch tabs.
      - Fixed: `switchTab` now also toggles `tab-btn-active` + `aria-selected` on
        `#bottom-tab-bar .tab-btn` (deep links / `startFishing` / `stopFishing`
        all call `switchTab`, so the bar always follows). Verified headless.
      - Verification: sanity `switchTab` behavior; headless test (markup has
        `role="tablist"` + `aria-selected`; switchTab syncs the bar).
- [x] `index.html` — drop `user-scalable=no` / `maximum-scale=1.0` (restore pinch zoom).
      - Verification: viewport is now `width=device-width, initial-scale=1.0`; sanity markup passes.
- [x] `src/app.js` — tapping the date header returns to "Today" when paged forward
      (reset `activeDateOffset=0`); truncate overflowing station name with CSS.
      - Potential bugs: date text click must not conflict with prev/next buttons.
      - Fixed: `#date-nav-text` became a `<button onclick="resetToToday()">` with its
        own tap target (prev/next are separate buttons); `resetToToday()` no-ops at 0.
        `#active-station-name` gets `max-width + text-overflow: ellipsis`.
      - Verification: headless — resetToToday resets offset + re-renders, no-op at Today.
- [x] `src/styles.css` — bottom-bar styles (fixed, safe-area inset), station-name
      ellipsis, date-tap cursor.
      - Verification: `.bottom-tab-bar` fixed + `env(safe-area-inset-bottom)`; body
        padding-bottom bumped; sanity green 28/28.
- [x] `sw.js` — cache bumped to `v2.00.7` (html/styles/app changed).

## Commit 2.1f — Conditions grid: 9 pills (carried over B + C)

- [x] `api/water_report.py` — add `current=temperature_2m,wind_speed_10m,
      wind_direction_10m` to the Open-Meteo `meteo_url`; ship `air_temp_f`,
      `wind_speed_mph`, `wind_dir_compass` per day (null → `--`, never fake).
      - Potential bugs: meteo is fetched once for all 4 days — readings are "now";
        absent current → null → `--`.
      - VERIFIED: live API on 12101500 → `air_temp_f: 66.6`, `wind_speed_mph: 2.2`,
        `wind_dir_compass: SW`, `pop_pct: 0` (converted from °C/kmh/mm; hourly PoP
        sampled at the hour nearest `current.time`).
- [x] `src/services/water.js` — delete client-side `fetchWeatherConditions`; keep
      `window.currentWindMph`/`currentWindDir` populated FROM THE REPORT so catch-log
      env rows still get wind. Delete `compassDir`/`compassArrow` ONLY if unused
      elsewhere (grep first).
      - VERIFIED: `grep -rn fetchWeatherConditions|compassDir|compassArrow` → no refs.
        New `applyReportWeather(rep)` paints `.air-temp`/`.wind-val`/`.precip-pop`
        from the report + stashes wind for the catch-row (same `window.*` names).
- [x] `src/app.js` — 3×3 grid: Barometer / PoP% / Precip-vol / Cloud% / Air / Wind /
      Water-temp / Moon-phase (`rep.lunar_icon`) / Solunar. Split Precip into % + volume.
      - VERIFIED: headless test — all 9 labels present, 8 literal + 1 gated pill,
        report-driven values, water-temp `env-badge-hidden` when no own-gauge.
- [x] `src/styles.css` — delete the 6-col `@840px` `.env-stat-grid` rule (stay 3-col);
      add tabular-nums to numeric readouts; fix trigger/moon wrap on 320px.
      - VERIFIED: no 6-col rule; `tabular-nums` on `.env-badge-val`; `.moon-pill` wraps.
- [x] `sw.js` — cache bumped `v2.00.8`.

## Verification (whole phase)
- `find src -name '*.js' -print0 | xargs -0 -n1 node --check` (+ `sw.js`, `sanity_pass.js`)
- `python3 -m py_compile api/water_report.py scripts/dev_server.py scripts/refresh_wdfw_forecast.py`
- `node sanity_pass.js` → all green (live USGS `/api/nearby_stations` flake excluded).
- Dev-server + phone pass: RUN & TIMING panel, movement index, clarity badge,
  instant wind/temp, 9-pill grid, bottom nav.
- `CHANGELOG_INTERNAL.md` entry + commit ONLY after user approves (no auto-commit).

