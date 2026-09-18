## ACTIVE ➤ Commit 2.1c — Clarity signal (White River / Mud Mountain Dam; files: `api/water_report.py`, `src/app.js`). After it: 2.1d forecast scraper → 2.1e app feel → 2.1f 9-pill grid.

# Phase 2.1 — Surface real fishing intel (REPLACES the stale plan; approved 2026-09-18)

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

- [ ] `api/water_report.py` — for Puyallup sites ONLY, a 2nd USGS read of
      12098500 (White River near Buckley, 00060 streamflow) + 12098000 (Mud Mountain
      Lake, 00054 storage + 62614 elevation). Derive `clarity_outlook`:
      reservoir ELEVATION DROPPING + White FLOW RISING →
      "Dam releasing → turbidity rising downstream"; stable → "clearing".
      - Potential bugs: ONLY for sites 12101500 / 12093500 / 12094000; null-safe
        elsewhere; never invent an FNU value (AGENTS.md no fabrication).
      - Verification: confirmed these gauges report those params (00060/00054/62614
        live); API exposes `clarity_outlook` on Puyallup, absent/null elsewhere.
- [ ] `src/app.js` — inline `clarity_outlook` as a small badge in the telemetry row,
      Puyallup sites only (NOT a new section).

## Commit 2.1d — WDFW forecast hybrid scraper (`scripts/refresh_wdfw_forecast.py`, NEW)

- [ ] Fetch STABLE index `https://wdfw.wa.gov/fishing/management/north-falcon/forecasts`,
      match `<a>` text for current-year "Chinook forecasts" + "coho forecast", resolve
      the `href` (URL changes yearly; the index is stable). Download the PDF, extract
      the candidate Puyallup number, PRINT it + source for HUMAN CONFIRMATION BEFORE
      writing `src/data/wdfw_forecasts.json`.
      - Potential bugs: no pypdf / pdfminer / pdftotext installed in this repo →
        degrade to printing the resolved PDF URL + hint, and NEVER write unverified
        numbers (AGENTS.md no-fabricate). One toggle: `--confirm` writes only the
        confirmed number.
      - Verification: `python3 -m py_compile scripts/refresh_wdfw_forecast.py`; run →
        prints 2026 Chinook/Coho hrefs + candidate; no file write without `--confirm`.



## Commit 2.1e — App feel (resurrected D + E, previously dropped)

- [ ] `index.html` — persistent fixed bottom tab bar (Water Report / Gear Sim /
      Catch Log) calling the existing `switchTab`; keep the menu-drawer; add
      `role="tablist"`/`aria-selected`; body bottom padding + safe-area.
      - Potential bugs: `switchTab` toggles `.tab-active` — the bar must stay synced
        when deep links / bootstraps switch tabs.
      - Verification: sanity `switchTab` behavior; phone 1-tap switching.
- [ ] `index.html` — drop `user-scalable=no` / `maximum-scale=1.0` (restore pinch zoom).
      - Verification: sanity markup still passes; pinch-zoom works.
- [ ] `src/app.js` — tapping the date header returns to "Today" when paged forward
      (reset `activeDateOffset=0`); truncate overflowing station name with CSS.
      - Potential bugs: date text click must not conflict with prev/next buttons.
- [ ] `src/styles.css` — bottom-bar styles (fixed, safe-area inset), station-name
      ellipsis, date-tap cursor.

## Commit 2.1f — Conditions grid: 9 pills (carried over B + C)

- [ ] `api/water_report.py` — add `current=temperature_2m,wind_speed_10m,
      wind_direction_10m` to the Open-Meteo `meteo_url`; ship `air_temp_f`,
      `wind_speed_mph`, `wind_dir_compass` per day (null → `--`, never fake).
      - Potential bugs: meteo is fetched once for all 4 days — readings are "now";
        absent current → null → `--`.
      - Verification: dev-server API shows those keys.
- [ ] `src/services/water.js` — delete client-side `fetchWeatherConditions`; keep
      `window.currentWindMph`/`currentWindDir` populated FROM THE REPORT so catch-log
      env rows still get wind. Delete `compassDir`/`compassArrow` ONLY if unused
      elsewhere (grep first).
      - Potential bugs: any other caller of `fetchWeatherConditions` must be removed
        too; catch-log wind enrichment must still read `window.currentWindMph`.
      - Verification: `grep -rn fetchWeatherConditions` → no call sites; `node --check`.
- [ ] `src/app.js` — 3×3 grid: Barometer / PoP% / Precip-vol / Cloud% / Air / Wind /
      Water-temp / Moon-phase (`rep.lunar_icon`) / Solunar. Split Precip into % + volume.
      - Potential bugs: water-temp only when own gauge reports it (hidden otherwise);
        moon phase wraps at 320px.
- [ ] `src/styles.css` — delete the 6-col `@840px` `.env-stat-grid` rule (stay 3-col);
      add tabular-nums to numeric readouts; fix trigger/moon wrap on 320px.

## Verification (whole phase)
- `find src -name '*.js' -print0 | xargs -0 -n1 node --check` (+ `sw.js`, `sanity_pass.js`)
- `python3 -m py_compile api/water_report.py scripts/dev_server.py scripts/refresh_wdfw_forecast.py`
- `node sanity_pass.js` → all green (live USGS `/api/nearby_stations` flake excluded).
- Dev-server + phone pass: RUN & TIMING panel, movement index, clarity badge,
  instant wind/temp, 9-pill grid, bottom nav.
- `CHANGELOG_INTERNAL.md` entry + commit ONLY after user approves (no auto-commit).

