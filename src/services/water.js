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

// Proxy water-temp map: active river gauge ID -> trusted USGS temp-proxy gauge ID.
// Most discharge gauges do not report water temperature (00010), so we borrow it from
// a nearby spring-fed gauge in the same basin. Gauges absent from this map render "--".
const waterTempProxies = {
    '12101500': '12102078', // Puyallup River at Puyallup -> Clarks Creek (spring-fed)
    '12093500': '12102078'  // Puyallup River near Orting -> Clarks Creek (spring-fed)
};

function setWaterTempPlaceholder() {
    window.waterTempF = null;   // Gear Sim falls back to the baseline zone when temp is unknown
    document.querySelectorAll('.water-temp').forEach(function(el) {
        el.innerText = '--';
    });
}

// Resolve the active river's proxy gauge, then pull 00010 (water temp) for it.
// Rivers with no mapping fall back to "--" without throwing.
async function fetchProxyWaterTemp(activeSiteId) {
    var proxyId = activeSiteId ? waterTempProxies[String(activeSiteId)] : null;

    if (!proxyId) {
        logDebug("No water temp proxy for " + (activeSiteId || 'unknown') + " — showing --", "NET");
        setWaterTempPlaceholder();
        return;
    }

    try {
        const url = 'https://waterservices.usgs.gov/nwis/iv/?format=json&sites=' + proxyId + '&parameterCd=00010&siteStatus=all';
        const response = await fetch(url);
        const data = await response.json();
        const series = data && data.value ? data.value.timeSeries : null;
        const readings = (series && series[0] && series[0].values && series[0].values[0]) ? series[0].values[0].value : null;
        const celsius = (readings && readings.length > 0) ? parseFloat(readings[0].value) : NaN;

        if (isNaN(celsius)) {
            throw new Error("Invalid water temp from proxy " + proxyId);
        }

        const fahrenheit = Math.round((celsius * 9/5) + 32);
        window.waterTempF = fahrenheit;   // consumed by the Gear Sim strike-zone engine
        document.querySelectorAll('.water-temp').forEach(function(el) {
            el.innerText = fahrenheit;
        });
        logDebug("Water temp proxy " + proxyId + " -> " + fahrenheit + "F", "NET");
    } catch(e) {
        logDebug("Proxy water temp error: " + e.message, "ERR");
        setWaterTempPlaceholder();
    }
}

// 16-point compass label for a wind bearing in degrees (e.g. 225 -> "SW")
function compassDir(deg) {
    var dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    var idx = Math.round((((Number(deg) % 360) + 360) % 360) / 22.5) % 16;
    return dirs[idx];
}

// 8-point compass glyph for a wind bearing in degrees (e.g. 315 -> NW).
// Retained as the tactical wind-direction indicator in the Wind card.
function compassArrow(deg) {
    var arrows = ['\u2191','\u2197','\u2192','\u2198','\u2193','\u2199','\u2190','\u2196']; // N, NE, E, SE, S, SW, W, NW
    var idx = Math.round((((Number(deg) % 360) + 360) % 360) / 45) % 8;
    return arrows[idx];
}

// Live surface conditions via Open-Meteo.
// NOTE: /api/water_report only exposes pressure/rain/cloud_pct, and its Open-Meteo
// request never asks for wind or precipitation probability. So we request them here:
// temperature_2m + wind_speed_10m + wind_direction_10m are pulled from `current`,
// while `precipitation_probability` is hourly-only (per Open-Meteo docs) and is
// sampled from the hour nearest to `current.time`.
async function fetchWeatherConditions(lat, lon) {
    if (lat == null || lon == null) return;
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
        '&current=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation' +
        '&hourly=precipitation_probability,temperature_2m,wind_speed_10m,wind_direction_10m' +
        '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' +
        '&timezone=America%2FLos_Angeles&forecast_days=1';
    try {
        const response = await fetch(url, { cache: 'no-store' });
        const data = await response.json();
        const cur = (data && data.current) ? data.current : null;

        // Align the hourly precipitation-probability sample with the current observation.
        var hIdx = -1;
        if (data && data.hourly && data.hourly.time && data.hourly.time.length > 0) {
            var stamp = (cur && cur.time) ? cur.time : data.hourly.time[0];
            var refMs = new Date(stamp).getTime();
            var bestDiff = Infinity;
            for (var i = 0; i < data.hourly.time.length; i++) {
                var diff = Math.abs(new Date(data.hourly.time[i]).getTime() - refMs);
                if (diff < bestDiff) { bestDiff = diff; hIdx = i; }
            }
        }
        function hourlyVal(key) {
            if (hIdx < 0 || !data || !data.hourly || !data.hourly[key]) return null;
            var v = data.hourly[key][hIdx];
            return (v == null) ? null : v;
        }

        // 1. Air Temp -> ".air-temp" span (renders as "{temp}° Air · {waterTemp}° H₂O")
        var airTemp = (cur && cur.temperature_2m != null) ? cur.temperature_2m : hourlyVal('temperature_2m');
        if (airTemp != null) {
            airTemp = Math.round(airTemp);
            document.querySelectorAll('.air-temp').forEach(function(el) {
                el.innerText = airTemp;
            });
        }

        // 2. Wind speed + direction -> Wind card value field
        var wSpeed = (cur && cur.wind_speed_10m != null) ? cur.wind_speed_10m : hourlyVal('wind_speed_10m');
        var wDir = (cur && cur.wind_direction_10m != null) ? cur.wind_direction_10m : hourlyVal('wind_direction_10m');
        // Stash for the catch-log payload (private row enrichment).
        if (wSpeed != null) {
            window.currentWindMph = Number(wSpeed);
            window.currentWindDir = (wDir != null) ? compassDir(wDir) : null;
        }
        if (wSpeed != null) {
            var windTxt = ((wDir != null) ? compassDir(wDir) + ' ' + compassArrow(wDir) + ' ' : '') + Math.round(wSpeed) + ' mph';
            document.querySelectorAll('.wind-val').forEach(function(el) {
                el.innerText = windTxt;
            });
        }

        // 3. Precip probability + volume -> Precipitation card ("{pop}% · {volume}\"")
        var pop = hourlyVal('precipitation_probability');
        if (pop == null && cur && cur.precipitation_probability != null) pop = cur.precipitation_probability;
        var vol = (cur && cur.precipitation != null) ? cur.precipitation : hourlyVal('precipitation');
        document.querySelectorAll('.precip-pop').forEach(function(el) {
            el.innerText = (pop != null) ? Math.round(pop) : '--';
        });
        if (vol != null) {
            document.querySelectorAll('.precip-vol').forEach(function(el) {
                el.innerText = Number(vol).toFixed(2);
            });
        }

        logDebug("Weather synced: Air " + airTemp + "F, Wind " + wSpeed + " mph, PoP " + pop + "%", "NET");
    } catch(e) {
        logDebug("Weather conditions error: " + e.message, "ERR");
    }
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

// Fixed (non-collapsible) section: header + one card per life stage, on the same
// .env-stat-grid tracks and card shell as the 3x2 conditions grid above it.
function buildEscapementSection(siteId) {
    var rec = siteId ? hatcheryEscapement[String(siteId)] : null;
    var html = '<div class="esc-section">' +
        '<div class="sec-hdr">[ HATCHERY ESCAPEMENT &amp; RUN MOMENTUM ]</div>';

    if (!rec) {
        return html + '<div class="esc-empty">No hatchery escapement tracking for this river yet.</div></div>';
    }

    html += '<div class="env-stat-grid">';

    for (var s = 0; s < rec.stocks.length; s++) {
        var st = rec.stocks[s];
        var badge = escWowBadge(st.wow);
        var speciesName = String(st.name || 'Stock').replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
        html += '<div class="esc-card">' +
                '<div class="esc-card-hdr">' +
                  '<span class="esc-species">' + speciesName + '</span>' +
                  '<span class="esc-trend" style="color:' + badge.color + ';">' + badge.text + '</span>' +
                '</div>' +
                '<div class="esc-row"><span class="esc-row-lbl">Total Return</span><span class="esc-row-val">' + escNum(st.totalReturn) + '</span></div>' +
                '<div class="esc-row"><span class="esc-row-lbl">Trap Count</span><span class="esc-row-val">' + escNum(st.trapCount) + '</span></div>' +
                '<div class="esc-row"><span class="esc-row-lbl">5-Yr Avg</span><span class="esc-row-val">' + escNum(st.fiveYrAvg) + '</span></div>' +
            '</div>';
    }

    return html + '</div>' +
        '</div>';
}

// Query the Socrata dataset for EVERY facility mapped to the river (dynamic IN clause)
// and derive, per life stage:
//   Total Return = sum of adult_count in the current calendar year
//   Trap Count   = the most recent single-day count
//   5-Yr Avg     = mean of the same calendar window across the prior 5 years
//   WoW          = last 7 days vs the prior 7 days (delta + percent change)
// Adults come from adult_count; jacks are pooled from the dataset's jack_count column.
// Returns null (never throws) when the river is unmapped or the feed has no rows.
async function fetchEscapementLive(siteId) {
    var facilities = escapementFacilities[siteId ? String(siteId) : ''];
    if (!facilities || !facilities.length) return null;

    var year = new Date().getFullYear();
    var quoted = facilities.map(function(f) { return "'" + f + "'"; }).join(',');
    var where = "event='" + ESCAPEMENT_EVENT + "' AND facility in(" + quoted + ")" +
        " AND date >= '" + (year - 5) + "-01-01T00:00:00.000'";
    var url = ESCAPEMENT_SOCRATA +
        '?$select=date,species,run,sum(adult_count) AS adults,sum(jack_count) AS jacks' +
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
    for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
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
    return out;
}

// Merge live numbers onto the static registry. Species matching is exact first, then by
// base species, so a 'Chinook' card also picks up legacy 'Fall Chinook' buckets. Never
// throws - any failure leaves the existing "--" placeholders in place so the UI stays
// stable.
async function loadEscapementData(siteId) {
    var key = siteId ? String(siteId) : '';
    var rec = hatcheryEscapement[key];
    if (!rec) return null;
    try {
        var live = await fetchEscapementLive(key);
        if (live) {
            rec.stocks.forEach(function(st) {
                var want = String(st.name).toLowerCase();
                var base = want.replace(/^(fall|spring|summer|winter)\s+/, '');
                var hit = null;
                Object.keys(live).forEach(function(sp) {
                    var l = sp.toLowerCase().replace(/^(fall|spring|summer|winter)\s+/, '');
                    if (!hit && (sp.toLowerCase() === want || l === base)) hit = live[sp];
                });
                if (hit) {
                    st.totalReturn = hit.totalReturn;
                    st.trapCount = hit.trapCount;
                    st.fiveYrAvg = hit.fiveYrAvg;
                    st.wow = hit.wow;
                }
            });
            logDebug("Escapement synced for " + key, "NET");
        }
    } catch(e) {
        logDebug("Escapement feed unavailable, keeping -- placeholders: " + e.message, "ERR");
    }
    return rec;
}

// Re-paint the escapement slot once the live numbers land. Rivers with no facility
// mapping keep the static "no tracking" state that was rendered synchronously.
async function refreshEscapement(siteId) {
    var key = siteId ? String(siteId) : '';
    if (!hatcheryEscapement[key]) return;
    await loadEscapementData(key);
    document.querySelectorAll('.esc-slot').forEach(function(el) {
        if (el.getAttribute('data-site') === key) el.innerHTML = buildEscapementSection(key);
    });
}
