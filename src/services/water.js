/**
 * src/services/water.js - live telemetry + escapement data layer.
 *
 * Extracted verbatim from the inline script in index.html (v2.00) so behaviour
 * is unchanged. Everything here is a network read or a pure transform of a
 * network payload: USGS NWIS (CFS momentum, proxy water temp), Open-Meteo
 * (surface conditions) and the WDFW Socrata hatchery escapement feed.
 *
 * Loaded as a classic script before src/app.js; all names are global.
 */
async function fetchCFSMomentum(siteId) {
    if (!siteId) return;
    try {
        const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${siteId}&parameterCd=00060&period=PT4H&siteStatus=all`;
        const response = await fetch(url);
        const data = await response.json();
        const series = data && data.value ? data.value.timeSeries : null;
        const readings = (series && series[0] && series[0].values && series[0].values[0]) ? series[0].values[0].value : null;
        if (!readings || readings.length < 2) return;

        // Sort chronologically so the 4-hour delta never depends on USGS return order.
        const sorted = readings.slice().sort(function (a, b) {
            return new Date(a.dateTime) - new Date(b.dateTime);
        });
        const oldest = parseFloat(sorted[0].value);
        const latest = parseFloat(sorted[sorted.length - 1].value);
        if (isNaN(oldest) || isNaN(latest)) return;
        const delta = latest - oldest;

        // Salmon fishing logic: a rise means blowout risk (red),
        // a drop means the river is clearing (green), otherwise neutral (gray).
        let trendText = "Stable";
        let trendColor = "#94a3b8";
        if (delta > 15) {
            trendText = "\u2191 Rising";
            trendColor = "#ef4444";
        } else if (delta < -15) {
            trendText = "\u2193 Dropping";
            trendColor = "#22c55e";
        }

        document.querySelectorAll('.cfs-val').forEach(function(el) {
            const existing = el.parentElement.querySelector('.cfs-trend-badge');
            if (existing) existing.remove();
            const span = document.createElement('span');
            span.className = 'cfs-trend-badge';
            span.style.color = trendColor;
            span.innerText = trendText;
            el.insertAdjacentElement('afterend', span);
        });
        logDebug("CFS momentum (" + siteId + "): " + oldest + " -> " + latest + " (delta " + delta.toFixed(0) + ") " + trendText, "NET");
    } catch(e) {
        logDebug("CFS Momentum error: " + e.message, "ERR");
    }
}

// Own-gauge water temp + turbidity. Locked decision: query ONLY the active
// station's OWN USGS gauge (00010 temp, 63680 turbidity) via the water-report
// API payload — no proxy, no cross-gauge fallback, no guessing. When the
// station does not report them, both stay hidden entirely (the card renders
// only the fields that carry a value).
function applyOwnGaugeWaterQuality(waterTempF, turbidityFnu) {
    var hasTemp = (waterTempF !== undefined && waterTempF !== null && !isNaN(waterTempF));
    window.waterTempF = hasTemp ? Number(waterTempF) : null;   // Gear Sim falls back to the baseline zone when temp is unknown
    document.querySelectorAll('.water-temp').forEach(function (el) {
        el.innerText = hasTemp ? Math.round(Number(waterTempF)) : '--';
    });
    document.querySelectorAll('.turbidity-val').forEach(function (el) {
        el.innerText = (turbidityFnu !== undefined && turbidityFnu !== null && !isNaN(turbidityFnu))
            ? Number(turbidityFnu).toFixed(1)
            : '--';
    });
}

// Surface "now" conditions painted FROM the water-report payload (since
// Commit 2.1f the backend's Open-Meteo request includes `current` readings, so
// the client no longer calls Open-Meteo directly). Also stashes the wind for
// the catch-log env enrichment (window.currentWindMph / currentWindDir) and
// paints the 6 stat-grid placeholders that are not server-rendered.
function applyReportWeather(rep) {
    if (!rep) return;
    var WIND_ARROWS = { 'N':'\u2191','NNE':'\u2197','NE':'\u2197','ENE':'\u2197','E':'\u2192','ESE':'\u2198','SE':'\u2198','SSE':'\u2198','S':'\u2193','SSW':'\u2199','SW':'\u2199','WSW':'\u2199','W':'\u2190','WNW':'\u2196','NW':'\u2196','NNW':'\u2196' };
    var airT = (rep.air_temp_f !== undefined && rep.air_temp_f !== null && !isNaN(rep.air_temp_f)) ? Math.round(Number(rep.air_temp_f)) : null;
    var wSpeed = (rep.wind_speed_mph !== undefined && rep.wind_speed_mph !== null && !isNaN(rep.wind_speed_mph)) ? Number(rep.wind_speed_mph) : null;
    var wDir = (rep.wind_dir_compass !== undefined && rep.wind_dir_compass !== null) ? rep.wind_dir_compass : null;
    var pop = (rep.pop_pct !== undefined && rep.pop_pct !== null) ? rep.pop_pct : null;

    if (wSpeed != null) {
        window.currentWindMph = wSpeed;
        window.currentWindDir = wDir;
    }

    if (airT != null) {
        document.querySelectorAll('.air-temp').forEach(function (el) { el.innerText = airT; });
    }
    if (wSpeed != null) {
        // The pill markup now renders a single "mph" unit; this just paints the
        // arrow + value (fixes the old double "mphmph" from pill + this line).
        var windTxt = (wDir ? (WIND_ARROWS[wDir] || wDir) + ' ' : '') + Math.round(wSpeed) + ' mph';
        document.querySelectorAll('.wind-val').forEach(function (el) { el.innerText = windTxt; });
    }
    document.querySelectorAll('.precip-pop').forEach(function (el) { el.innerText = (pop != null) ? pop : '--'; });

    logDebug('Weather painted from report: Air ' + (airT == null ? '--' : airT) + 'F, Wind ' + (wSpeed == null ? '--' : windTxt) + ', PoP ' + (pop == null ? '--' : pop) + '%', 'NET');
}

// --- PHASE 2: HATCHERY ESCAPEMENT TRACKING ---
// Run-return registry keyed by the active USGS river gauge ID. Metrics WDFW has not
// published are left null so the UI renders "--" instead of inventing a number.
// Rivers absent from this map degrade to a clean "not tracked" state.
var hatcheryEscapement = {
    '12101500': { system: 'Puyallup / White River', source: 'WDFW Puyallup Basin Facilities', stocks: [
        { name: 'Chinook', totalReturn: null, trapCount: null, fiveYrAvg: null },
        { name: 'Coho',         totalReturn: null, trapCount: null, fiveYrAvg: null },
        { name: 'Jacks',        totalReturn: null, trapCount: null, fiveYrAvg: null }
    ]},
    '12093500': { system: 'Puyallup / White River (Orting)', source: 'WDFW Puyallup Basin Facilities', stocks: [
        { name: 'Chinook', totalReturn: null, trapCount: null, fiveYrAvg: null },
        { name: 'Coho',         totalReturn: null, trapCount: null, fiveYrAvg: null },
        { name: 'Jacks',        totalReturn: null, trapCount: null, fiveYrAvg: null }
    ]},
    '12094000': { system: 'Puyallup / White River (Carbon)', source: 'WDFW Puyallup Basin Facilities', stocks: [
        { name: 'Chinook', totalReturn: null, trapCount: null, fiveYrAvg: null },
        { name: 'Coho',         totalReturn: null, trapCount: null, fiveYrAvg: null },
        { name: 'Jacks',        totalReturn: null, trapCount: null, fiveYrAvg: null }
    ]},
    '12113000': { system: 'Green River', source: 'WDFW Soos Creek Hatchery', stocks: [
        { name: 'Chinook', totalReturn: null, trapCount: null, fiveYrAvg: null },
        { name: 'Coho',    totalReturn: null, trapCount: null, fiveYrAvg: null },
        { name: 'Pink',    totalReturn: null, trapCount: null, fiveYrAvg: null }
    ]},
    '12200500': { system: 'Skagit River', source: 'WDFW Marblemount Hatchery', stocks: [
        { name: 'Chinook', totalReturn: null, trapCount: null, fiveYrAvg: null },
        { name: 'Coho',    totalReturn: null, trapCount: null, fiveYrAvg: null },
        { name: 'Chum',    totalReturn: null, trapCount: null, fiveYrAvg: null }
    ]}
};

// Live feed: Socrata (data.wa.gov) "WDFW-Hatchery Adult Salmon Returns". This endpoint
// is CORS-enabled, so the browser can query it directly with no proxy.
const ESCAPEMENT_SOCRATA = 'https://data.wa.gov/resource/9q4e-xhag.json';
// Only the event that represents adults physically RETURNING to the facility. The other
// events (Adult Plant / Mortality / Surplus / Parent Spawn / EggTake) re-count those very
// same fish, so summing every event would inflate the total several times over.
const ESCAPEMENT_EVENT = 'Trap Estimate';
// Shown under the counts fold whenever WDFW exposes no usable :updated_at stamp.
// Shared by app.js (first paint) and refreshEscapement (after the live fetch) so
// the UI never invents a date.
const ESCAPEMENT_UPDATED_FALLBACK = 'Hatchery data may lag WDFW reporting.';
// Active USGS river gauge ID -> WDFW `facility` string(s) exactly as spelled in the
// dataset. The whole Puyallup / White River basin is pooled into one query per gauge:
// today only VOIGHTS CR HATCHERY actively reports Trap Estimates (PUYALLUP HATCHERY's
// stopped in 2000, and CLARKS CR / WHITE RIVER / BUCKLEY TRAP / DIRU CREEK have no rows
// yet), so they ride along in the IN clause and light up automatically if WDFW adds them.
// Anything unmapped (e.g. Nisqually 12089500) renders the "no tracking" state.
var PUYALLUP_BASIN_FACILITIES = [
    'VOIGHTS CR HATCHERY', 'PUYALLUP HATCHERY', 'CLARKS CR HATCHERY',
    'WHITE RIVER HATCHERY', 'BUCKLEY TRAP', 'DIRU CREEK'
];
var escapementFacilities = {
    '12101500': PUYALLUP_BASIN_FACILITIES, // Puyallup River at Puyallup
    '12093500': PUYALLUP_BASIN_FACILITIES, // Puyallup River near Orting
    '12094000': PUYALLUP_BASIN_FACILITIES, // Carbon River (Puyallup system)
    '12113000': ['SOOS CREEK HATCHERY'],   // Green River at Auburn
    '12200500': ['MARBLEMOUNT HATCHERY']   // Skagit River
};

// Counts render as "--" until a published figure exists.
function escNum(v) {
    return (v === null || v === undefined || isNaN(v)) ? '--' : Number(v).toLocaleString('en-US');
}

// Maps a dataset row's species + run into a display bucket, e.g.
// species 'Chinook' + run 'Fall' -> 'Chinook'. Legacy 'Fall Chinook' rows
// (cached before the rename) map to the same bucket so old data never
// orphans. Jacks are pooled separately from the dataset's dedicated
// jack_count column.
function escBucketName(species, run) {
    var sp = String(species || '').trim();
    // Chinook (any run) -> 'Chinook'. Legacy 'Fall Chinook' rows map here too.
    if (sp.toLowerCase().indexOf('chinook') !== -1 || sp.toLowerCase() === 'king') return 'Chinook';
    return sp || 'Unknown';
}

// Week-over-Week (WoW) momentum badge: last 7 days of returns vs the prior 7 days.
// Green = building push, Red = slowing, Muted = flat.
function escWowBadge(wow) {
    if (!wow || (wow.cur === 0 && wow.prior === 0)) return { text: '\u2014 Stable', color: '#94a3b8' };
    if (wow.delta > 0) {
        return { text: '\u25B2 +' + wow.delta + ((wow.pct !== null) ? ' (+' + wow.pct + '%)' : ''), color: '#22c55e' };
    }
    if (wow.delta < 0) {
        return { text: '\u25BC ' + Math.abs(wow.delta) + ((wow.pct !== null) ? ' (' + wow.pct + '%)' : ''), color: '#ef4444' };
    }
    return { text: '\u2014 Stable', color: '#94a3b8' };
}

// Freshness line for the hatchery counts fold: "Last updated Sep 18, 2026 · 12:09 AM"
// in the DEVICE's local time from WDFW's own :updated_at stamp. An absent /
// unparseable stamp returns the honest fallback wording — never a fabricated date.
function formatEscapementUpdated(iso) {
    if (!iso) return ESCAPEMENT_UPDATED_FALLBACK;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return ESCAPEMENT_UPDATED_FALLBACK;
    var datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    var timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return 'Last updated ' + datePart + ' \u00B7 ' + timePart;
}

// Escapement counts now render inside the merged [ RUN & TIMING ] per-species
// cards (buildSpeciesCalendarHtml in app.js); refreshEscapement fills their
// count rows async after the card HTML renders.

// Query the Socrata dataset for EVERY facility mapped to the river (dynamic IN clause)
// and derive, per life stage:
//   Total Return = sum of adult_count in the current calendar year
//   Trap Count   = the most recent single-day count
//   5-Yr Avg     = mean of the same calendar window across the prior 5 years
//   WoW          = last 7 days vs the prior 7 days (delta + percent change)
// Adults come from adult_count; jacks are pooled from the dataset's jack_count column.
// Returns null (never throws) when the river is unmapped or the feed has no rows.
// Returns { stocks: { bucket -> counts }, lastUpdated } where lastUpdated is the
// MAX Socrata system column :updated_at across the rows (WDFW's own publish time,
// never a client guess) — null when the feed does not expose it.
async function fetchEscapementLive(siteId) {
    var facilities = escapementFacilities[siteId ? String(siteId) : ''];
    if (!facilities || !facilities.length) return null;

    var year = new Date().getFullYear();
    var quoted = facilities.map(function(f) { return "'" + f + "'"; }).join(',');
    var where = "event='" + ESCAPEMENT_EVENT + "' AND facility in(" + quoted + ")" +
        " AND date >= '" + (year - 5) + "-01-01T00:00:00.000'";
    var url = ESCAPEMENT_SOCRATA +
        '?$select=date,species,run,sum(adult_count) AS adults,sum(jack_count) AS jacks,max(:updated_at) AS lastUpdated' +
        '&$group=date,species,run' +
        '&$where=' + encodeURIComponent(where) +
        '&$order=date DESC&$limit=5000';

    var res = await fetch(url, { cache: 'no-store' });
    var rows = await res.json();
    if (!rows || !rows.length) return null;

    var today = new Date();
    var DAY = 86400000;
    var acc = {};   // display bucket -> { days: { 'YYYY-MM-DD': adultSum } }
    var jacc = {};  // pooled jacks across every species and run
    var lastUpdated = null; // MAX :updated_at across every returned row
    for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var stamp = r.lastUpdated;
        if (stamp && (!lastUpdated || String(stamp) > lastUpdated)) lastUpdated = String(stamp);
        var key = String(r.date || '').slice(0, 10);
        if (!key) continue;
        var bucket = escBucketName(r.species, r.run);
        var a = parseFloat(r.adults) || 0;
        var j = parseFloat(r.jacks) || 0;
        if (!acc[bucket]) acc[bucket] = { days: {} };
        acc[bucket].days[key] = (acc[bucket].days[key] || 0) + a;
        jacc[key] = (jacc[key] || 0) + j;
    }
    acc['Jacks'] = { days: jacc };

    var out = {};
    Object.keys(acc).forEach(function(sp) {
        var days = acc[sp].days;
        var keys = Object.keys(days);
        if (!keys.length) return;

        // Freshest trap date anchors the WoW windows so WDFW reporting lag can't skew it.
        var latestKey = keys[0];
        keys.forEach(function(k) { if (k > latestKey) latestKey = k; });
        var maxT = new Date(latestKey + 'T00:00:00').getTime();
        var anchorYear = parseInt(latestKey.slice(0, 4), 10);

        var total = 0, cur = 0, prev = 0, byYear = {};
        keys.forEach(function(k) {
            var n = days[k];
            if (parseInt(k.slice(0, 4), 10) === anchorYear) total += n;
            var t = new Date(k + 'T00:00:00').getTime();
            // Week-over-Week: [max-6 .. max] vs [max-13 .. max-7]
            if (t > maxT - 6 * DAY && t <= maxT) cur += n;
            else if (t > maxT - 13 * DAY && t <= maxT - 7 * DAY) prev += n;
            // 5-yr average over the same calendar window (month/day <= today)
            var d = new Date(k + 'T00:00:00');
            var y = d.getFullYear();
            if (y < year && y >= year - 5) {
                if (d.getMonth() < today.getMonth() ||
                    (d.getMonth() === today.getMonth() && d.getDate() <= today.getDate())) {
                    byYear[y] = (byYear[y] || 0) + n;
                }
            }
        });

        var delta = cur - prev;
        var pct = (prev > 0) ? Math.round((delta / prev) * 100) : null;
        var avg = null, ys = Object.keys(byYear);
        if (ys.length) {
            var sum = 0;
            ys.forEach(function(y) { sum += byYear[y]; });
            avg = Math.round(sum / ys.length);
        }
        out[sp] = {
            totalReturn: total,
            trapCount: days[latestKey] || 0,
            fiveYrAvg: avg,
            wow: { delta: delta, pct: pct, cur: cur, prior: prev }
        };
    });
    return { stocks: out, lastUpdated: lastUpdated };
}

// Merge live numbers onto the static registry. Species matching is exact first, then by
// base species, so a 'Chinook' card also picks up legacy 'Fall Chinook' buckets. Never
// throws - any failure leaves the existing "--" placeholders in place so the UI stays
// stable. Also stashes rec.lastUpdated (WDFW's max :updated_at) for the counts fold.
async function loadEscapementData(siteId) {
    var key = siteId ? String(siteId) : '';
    var rec = hatcheryEscapement[key];
    if (!rec) return null;
    try {
        var live = await fetchEscapementLive(key);
        if (live && live.stocks) {
            rec.stocks.forEach(function(st) {
                var want = String(st.name).toLowerCase();
                var base = want.replace(/^(fall|spring|summer|winter)\s+/, '');
                var hit = null;
                Object.keys(live.stocks).forEach(function(sp) {
                    var l = sp.toLowerCase().replace(/^(fall|spring|summer|winter)\s+/, '');
                    if (!hit && (sp.toLowerCase() === want || l === base)) hit = live.stocks[sp];
                });
                if (hit) {
                    st.totalReturn = hit.totalReturn;
                    st.trapCount = hit.trapCount;
                    st.fiveYrAvg = hit.fiveYrAvg;
                    st.wow = hit.wow;
                }
            });
            rec.lastUpdated = live.lastUpdated || null;
            logDebug("Escapement synced for " + key, "NET");
        }
    } catch(e) {
        logDebug("Escapement feed unavailable, keeping -- placeholders: " + e.message, "ERR");
    }
    return rec;
}

// WDFW annual run forecasts (src/data/wdfw_forecasts.json). Loaded statically
// and merged onto the per-species count cards exactly like the escapement feed:
// values are ONLY the human-confirmed numbers written by
// refresh_wdfw_forecast.py --confirm --chinook=/--coho= (never fabricated).
// To fetch the latest forecast JSON, use wdfw_forecasts.json directly.
// Until a real number exists the UI keeps its "--" placeholder.
async function refreshWdfwForecast() {
    var cell = document.querySelector('[data-count="wdfw"]');
    if (!cell) return;
    try {
        var res = await fetch('/src/data/wdfw_forecasts.json', { cache: 'no-store' });
        var data = await res.json();
        if (!data || !data.stocks) return;
        // Map card species (Chinook / Coho) to the registry's stock names
        // ("Puyallup Chinook" / "Puyallup Coho") by trailing species token.
        var bySp = {};
        data.stocks.forEach(function (st) {
            var name = String(st.stock || '');
            var m = name.match(/\s+(Chinook|Coho|Sockeye|Pink|Jacks)$/i);
            if (m) bySp[m[1].toLowerCase()] = st.forecast;
        });
        if (!Object.keys(bySp).length) return;
        document.querySelectorAll('.run-card[data-species]').forEach(function (card) {
            var sp = card.getAttribute('data-species');
            if (!sp) return;
            var val = bySp[sp];
            var out = (val === null || val === undefined || isNaN(val)) ? '--' : Number(val).toLocaleString('en-US');
            var target = card.querySelector('[data-count="wdfw"]');
            if (target) target.textContent = out;
        });
        logDebug('WDFW forecast applied from wdfw_forecasts.json', 'NET');
    } catch (e) {
        logDebug('WDFW forecast unavailable, keeping "--": ' + e.message, 'ERR');
    }
}

// Re-paint the escapement counts inside the merged [ RUN & TIMING ] per-species
// cards once the live numbers land. Each count row carries data-count (wdfw /
// return / trap / avg) inside a card carrying data-species, so we fill only the
// matching cells — never replace the whole section (the species/status/progress
// geometry stays put). Rivers with no facility mapping keep their "--" placeholders.
async function refreshEscapement(siteId) {
    var key = siteId ? String(siteId) : '';
    if (!hatcheryEscapement[key]) return;
    await loadEscapementData(key);
    var rec = hatcheryEscapement[key];
    document.querySelectorAll('.run-card[data-species]').forEach(function(card) {
        var sp = card.getAttribute('data-species');
        if (!sp) return;
        var hit = null;
        for (var i = 0; i < rec.stocks.length; i++) {
            if (String(rec.stocks[i].name || '').toLowerCase() === sp) { hit = rec.stocks[i]; break; }
        }
        if (!hit) return;
        var set = function(countKey, val) {
            var cell = card.querySelector('[data-count="' + countKey + '"]');
            if (cell) cell.textContent = (val === null || val === undefined || isNaN(val)) ? '--' : Number(val).toLocaleString('en-US');
        };
        set('return', hit.totalReturn);
        set('trap', hit.trapCount);
        set('avg', hit.fiveYrAvg);
    });
    // Freshness stamp under each counts fold: WDFW's max :updated_at in LOCAL time,
    // or the honest fallback wording when the feed exposed no stamp.
    document.querySelectorAll('.run-card [data-esc-updated]').forEach(function(el) {
        el.textContent = formatEscapementUpdated(rec.lastUpdated);
    });
}
