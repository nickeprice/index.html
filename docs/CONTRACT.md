# API Contract — `/api/water_report`

Canonical field map for the per-day report object (one per forecast day, 4 days).
Read this instead of re-grepping `api/water_report.py` when wiring the frontend.
Verify against live output with `scripts/smoke.sh`.

## Per-day object keys

| key | type | meaning | consumer (frontend) |
|---|---|---|---|
| `id`, `title`, `tag` | string | day slug / header / TODAY-TOMORROW-… | `app.js` card header |
| `peak` | number 0-100 | best window score this day | card peak display |
| `cfs` | int\|null | discharge (00060), null when absent | telemetry + catch log |
| `gage` | float\|null | gage height (00065) | telemetry |
| `water_temp_f` | float\|null | own-gauge 00010 only (deg F) | `.water-temp`; hidden when null |
| `turbidity_fnu` | float\|null | own-gauge 63680 only; NEVER invented | `.turbidity-val` |
| `flow_idx` | int 1-100 | speed index from `calculate_transit_time_and_flow` | env scoring |
| `pressure` | float\|null | current baro inHg | barometer pill + catch env |
| `press_delta` | float | current − 6h prior (inHg) | pressure-trend trigger |
| `rain` | float\|null | precip in inches (24h) | freshet trigger |
| `lunar_icon` | string\|null | emoji + phase name | moon pill + catch env |
| `cloud_pct` | number\|null | daily mean cloud % | twilight UV/overcast |
| `sunrise`/`sunset` | string | 12h display | twilight calc |
| `civil_in`/`civil_out` | string | ±35 min | (legacy) |
| `lines_in`/`lines_out` | string | ±1h legal lines | `build_dynamic_timeline` |
| `moon_upper`/`moon_lower` | string\|"--" | tidal moon times | solunar |
| `net_status` | string | "NETS IN…" / "River Open…" — Puyallup/White/Carbon only | status display |
| `is_netting` | bool | `weekday ∈ NETTING_DAYS && site ∈ NETTING_SITES` | gates transit "BLOCKED" |
| `angler_desc` | string | High (Weekend)/Low (Weekday) | not used in 2.1 |
| `push_status` | string | macro-env string (pressure/rain/lunar) — **NOT a fish-moving label** | keep for back-compat only |
| `transit_state` | string | "High Velocity Push"/"Steady Migration"/"Bay Staging…"/"Bank Hugging…"/"RIVER CORKED" | MOVEMENT INDEX (2.1b) |
| `transit_time` | string\|"BLOCKED" | "15 to 17 hrs" etc (6.0 mi at modeled speed) | MOVEMENT INDEX (2.1b) |
| `tide_chart` | string | "High: 4:15 AM (11.2 ft) | Low: …" | tide pills fallback |
| `tide_curve` | array | extremes `{t, h, type:H|L}` (12h times) | `tideCurveSvg` labels |
| `tide_points` | array | ~240 hourly NOAA points `{t, h}` for THIS day | `tideCurveSvg` area curve |
| `species_calendar` | array | per-stock `{species, window_start, window_end, peak_date, days_until_peak, position(pre/peak/post/off), status_text, progress 0-1, peak_frac 0-1}` | run cards (2.1b) |
| `windows` | array | `{start, end, score, triggers, start_str, end_str}` | legal-hours timeline |
| `api_offline` | bool | USGS unreachable vs seasonal | empty-state |
| `is_active` | bool | fresh 00060/00065 <=24h | station active badge |
| `site_name`/`site_id` | string | station identity | header + GPS flow |

## Removed (do not resurrect)
- `active_fish` — fake Gaussian count; deleted in 2.1a. NEVER re-add (AGENTS.md no-fabricate).

## Constants worth remembering
- `NETTING_DAYS = [6,0,1]` (Sun/Mon/Tue); `NETTING_SITES = {12101500, 12093500, 12094000}`
- Curated WA gauges: `nearbyStationIds` in `api/water_report.py` (~line 147)
- Defaults: `USGS_SITE=12101500`, `NOAA_STATION=9446484`, `LAT/LON = 47.1950/-122.3020`
