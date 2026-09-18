# Internal Change Log

Keep this LEAN by design: a fresh chat reads only the LAST entries to restore
context. Completed-phase detail lives in `docs/ARCHIVE.md` + `git log`.

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
