/**
 * src/app.js - Puyallup River Companion application core.
 *
 * Extracted verbatim from the inline script in index.html (v2.00) so behaviour
 * is unchanged. Owns UI state, navigation, guest auth, the deterministic fluid
 * dynamics engine, the Gear Sim, the Brag Board and the station selector.
 *
 * Loaded as a classic script LAST: it calls into src/services/water.js and
 * src/services/supabase.js, and wires window.onload.
 */
// --- DEBUG MATRIX (Double Tap Header) ---
var lastTap = 0;
document.getElementById('top-nav').addEventListener('touchend', function(e) {
    var currentTime = new Date().getTime();
    if (currentTime - lastTap < 300) {
        document.getElementById('debug-console').classList.toggle('open');
        logDebug("Debug Matrix Toggled", "SYS");
        e.preventDefault();
    }
    lastTap = currentTime;
});

function logDebug(msg, source) {
    var con = document.getElementById('debug-console');
    var time = new Date().toISOString().split('T')[1].slice(0,-1);
    con.innerHTML += '<div class="log-entry">[' + time + '] <b>' + source + '</b>: ' + msg + '</div>';
    con.scrollTop = con.scrollHeight;
}

// --- UTILITIES: debounce + toast notifications ---

/**
 * Trailing-edge debounce. Returns a wrapper that delays invoking `fn` until
 * `wait` ms have elapsed since the last call, so a burst of rapid input events
 * collapses into a single execution.
 *
 * Used by the Gear Sim inputs, which re-derive the strike-zone preview on every
 * keystroke; without this, typing "1040" into River Flow would run the physics
 * four times (1, 10, 104, 1040) instead of once.
 */
function debounce(fn, wait) {
    var timer = null;
    var delay = (typeof wait === 'number') ? wait : 250;
    return function () {
        var args = arguments;
        var ctx = this;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
            timer = null;
            fn.apply(ctx, args);
        }, delay);
    };
}

var TOAST_KIND_CLASS = {
    info: 'toast-info',
    success: 'toast-success',
    warn: 'toast-warn',
    error: 'toast-error'
};

/**
 * Non-blocking status message. Replaces the old alert() calls, which froze the
 * UI and could not be styled, with a dismissable pill anchored above the bottom
 * of the viewport.
 *
 * @param {string} msg     plain text (assigned via textContent, so it is never
 *                         interpreted as HTML)
 * @param {string} kind    'info' | 'success' | 'warn' | 'error'
 * @param {number} ms      auto-dismiss delay; default 4000
 * @param {object} action  optional { label, onClick }. Renders a tappable
 *                         button instead of dismissing on tap, so the message
 *                         can offer a choice (used by the PWA update prompt).
 * @returns {function}     dismisses the toast immediately
 */
function showToast(msg, kind, ms, action) {
    if (typeof document === 'undefined') return;
    var stack = document.getElementById('toast-stack');
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'toast-stack';
        stack.setAttribute('role', 'status');
        stack.setAttribute('aria-live', 'polite');
        stack.setAttribute('aria-atomic', 'false');
        document.body.appendChild(stack);
    }

    var toast = document.createElement('div');
    toast.className = 'toast ' + (TOAST_KIND_CLASS[kind] || TOAST_KIND_CLASS.info);

    var text = document.createElement('span');
    text.className = 'toast-msg';
    text.textContent = String(msg == null ? '' : msg);
    toast.appendChild(text);

    if (action && action.label && typeof action.onClick === 'function') {
        // An actionable toast: a button performs the action, tapping the body
        // still dismisses it. Nothing is ever done to the page automatically.
        toast.classList.add('toast-action');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toast-btn';
        btn.textContent = action.label;
        btn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            dismiss();
            action.onClick();
        });
        toast.appendChild(btn);
    }

    stack.appendChild(toast);

    // Force a reflow so the entry animation runs on a freshly inserted node.
    void toast.offsetWidth;
    toast.classList.add('toast-show');

    var life = (typeof ms === 'number') ? ms : 4000;
    var timer = setTimeout(dismiss, life);

    function dismiss() {
        clearTimeout(timer);
        toast.classList.remove('toast-show');
        toast.classList.add('toast-hide');
        setTimeout(function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
            if (!stack.children.length && stack.parentNode) {
                stack.parentNode.removeChild(stack);
            }
        }, 260);
    }

    // Tapping a toast dismisses it immediately.
    toast.addEventListener('click', dismiss);
    return dismiss;
}

// --- NAVIGATION ---
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('tab-active'); });
    document.getElementById(tabId).classList.add('tab-active');
    // Keep the persistent bottom tab bar in sync (deep links / bootstrap call
    // switchTab too, so the aria-selected + active class must follow the tab).
    var btnMap = {
        'tab-water-report': 'tab-btn-water-report',
        'tab-gear-sim': 'tab-btn-gear-sim',
        'tab-catch-log': 'tab-btn-catch-log'
    };
    document.querySelectorAll('#bottom-tab-bar .tab-btn').forEach(function(btn) {
        var on = (btn.id === btnMap[tabId]);
        btn.classList.toggle('tab-btn-active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    logDebug("Switched to " + tabId, "UI");
}

// Tapping the date header resets paging back to "Today" (offset 0).
function resetToToday() {
    if (activeDateOffset === 0) return;
    activeDateOffset = 0;
    updateActiveDateUI();
}

// --- AUTH (anonymous guest session) ---
var AuthState = { signedIn: false, name: '', offline: false };

function applyAuthState(signedIn, name) {
    AuthState.signedIn = !!signedIn;
    AuthState.name = name || '';
    var out = document.getElementById('auth-logged-out');
    var inn = document.getElementById('auth-logged-in');
    if (out) out.style.display = signedIn ? 'none' : 'block';
    if (inn) inn.style.display = signedIn ? 'block' : 'none';
    var label = document.getElementById('auth-display-name');
    if (label) label.innerText = AuthState.name || '--';

    var btnLog = document.getElementById('btn-log');
    if (btnLog) {
        if (!signedIn) {
            btnLog.innerText = 'SIGN IN TO LOG CATCHES';
            btnLog.className = 'btn-main locked';
        } else {
            // Logging is decoupled from the Gear Sim: no runSim() required.
            btnLog.innerText = 'LOG CATCH DATA';
            btnLog.className = 'btn-main ready';
        }
    }
    logDebug('Auth: ' + (signedIn ? ('guest session for ' + AuthState.name) : 'signed out'), 'AUTH');
}

async function initAuth() {
    if (typeof Supa === 'undefined') { applyAuthState(false, ''); return; }
    try { await Supa.ensureSdk(); } catch (e) {}
    var sess = null;
    try { sess = await Supa.getSession(); } catch (e) { sess = null; }
    var name = (sess && sess.name) ? sess.name : '';
    if (name) setFieldValue('auth-name', name);
    applyAuthState(!!(sess && (sess.user || name)), name);
    if (AuthState.signedIn) syncPendingCatches();
}

async function startFishing() {
    var name = (getStr('auth-name') || '').trim();
    if (!name) { showToast('Enter a name to start fishing.', 'warn'); return; }
    var btn = document.getElementById('btn-auth-start');
    if (btn) { btn.innerText = 'CONNECTING...'; btn.disabled = true; }
    var res = null;
    try {
        res = (typeof Supa !== 'undefined') ? await Supa.signInGuest(name) : { ok: true, offline: true, name: name };
    } catch (e) {
        res = { ok: false, error: e.message };
    }
    if (btn) { btn.innerText = 'START FISHING'; btn.disabled = false; }
    if (!res || !res.ok) {
        showToast('Could not start a session: ' + ((res && res.error) || 'unknown error'), 'error', 6000);
        return;
    }
    applyAuthState(true, res.name || name);
    if (res.offline) logDebug('Local-only guest session (Supabase unreachable)', 'AUTH');
    syncPendingCatches();
    if (typeof setCatchScope === 'function') setCatchScope(CATCH_SCOPE);
    switchTab('tab-gear-sim');
}

async function stopFishing() {
    try { if (typeof Supa !== 'undefined') await Supa.signOut(); } catch (e) {}
    setFieldValue('auth-name', '');
    currentStats = null;
    applyAuthState(false, '');
    if (typeof setCatchScope === 'function') setCatchScope(CATCH_SCOPE);
    switchTab('tab-catch-log');
}

// Rows that failed to reach Supabase stay in the local buffer flagged pendingSync and are
// retried whenever a session becomes available. Seed/demo rows never carry the flag, so
// the historical sample data is never uploaded to the shared board.
async function syncPendingCatches() {
    if (typeof Supa === 'undefined') return 0;
    var db = [];
    try {
        var jStr = localStorage.getItem('catch_db');
        db = jStr ? JSON.parse(jStr) : [];
    } catch (e) { return 0; }
    var pending = db.filter(function (r) { return r && r.pendingSync; });
    if (!pending.length) return 0;

    var synced = 0;
    for (var i = 0; i < pending.length; i++) {
        var res = null;
        try { res = await Supa.insertCatch(pending[i]); } catch (e) { res = null; }
        if (res && res.ok) {
            delete pending[i].pendingSync;
            pending[i].syncedAt = new Date().toISOString();
            synced++;
        } else {
            break;   // still offline: stop here and retry next session
        }
    }
    if (synced > 0) {
        try { localStorage.setItem('catch_db', JSON.stringify(db)); } catch (e) {}
        logDebug('Flushed ' + synced + ' buffered catch(es) to Supabase', 'SYNC');
    }
    return synced;
}

// Accepts either Supabase (angler_name/catch_time/river/species) or local buffer
// (name/time/river/spc) shapes so the offline fallback renders identically.
function normalizeFeedRow(row) {
    if (!row) return null;
    return {
        name: (row.angler_name !== undefined) ? row.angler_name : row.name,
        time: (row.catch_time !== undefined) ? row.catch_time : row.time,
        river: (row.river !== undefined && row.river !== null && row.river !== '') ? row.river : '--',
        spc: (row.species !== undefined) ? row.species : row.spc
    };
}

function formatCatchTime(value) {
    if (!value) return '--';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value).slice(0, 16).replace('T', ' ');
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var h = d.getHours();
    var suffix = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    var mins = d.getMinutes(); if (mins < 10) mins = '0' + mins;
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + h12 + ':' + mins + ' ' + suffix;
}

function syncSelect(baseId, fromLog) {
    var a = document.getElementById(baseId);
    var b = document.getElementById(baseId + '-log');
    if (!a || !b) return;
    if (fromLog) a.value = b.value; else b.value = a.value;
    logDebug("Synced Field: " + baseId, "STATE");
}

// Rod length is entered as two boxes (feet + inches) so 9'8" works.
function getRodLengthFt() {
    var ft = getNum('rod-ft');
    var inch = getNum('rod-in');
    if (ft <= 0 && inch <= 0) return 9.0;
    return ft + (inch / 12);
}

function formatRodLength(totalFt) {
    var whole = Math.floor(totalFt + 0.0001);
    var inch = Math.round((totalFt - whole) * 12);
    if (inch === 12) { whole += 1; inch = 0; }
    return whole + "'" + inch + '"';
}

// Rod change re-derives the leader default (rounded up, clamped to the 6-12 selector).
function onRodChange(fromLog) {
    if (fromLog) {
        setFieldValue('rod-ft', getNum('rod-ft-log'));
        setFieldValue('rod-in', getNum('rod-in-log'));
    } else {
        setFieldValue('rod-ft-log', getNum('rod-ft'));
        setFieldValue('rod-in-log', getNum('rod-in'));
    }
    var suggested = Math.ceil(getRodLengthFt());
    if (suggested < 6) suggested = 6;
    if (suggested > 12) suggested = 12;
    setFieldValue('ld-len', String(suggested));
    setFieldValue('ld-len-log', String(suggested));
    logDebug("Rod set to " + formatRodLength(getRodLengthFt()) + " -> leader default " + suggested + " ft", "STATE");
}

function setFieldValue(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = value;
}

// Lb test ranges are fixed per material: braid is 20/30/40, mono & copoly are 10/12,
// fluoro leaders are 10/12/15/17. Fluoro is not offered as a mainline, braid not as a leader.
var LB_OPTIONS = {
    mainline: { braid: [20, 30, 40], mono: [10, 12], copoly: [10, 12] },
    leader: { mono: [10, 12], copoly: [10, 12], fluoro: [10, 12, 15, 17] }
};

function updateLbOptions(matId, lbId, isLeader) {
    var table = isLeader ? LB_OPTIONS.leader : LB_OPTIONS.mainline;
    var list = table[getStr(matId)] || table[isLeader ? 'copoly' : 'braid'];
    var sel = document.getElementById(lbId);
    if (!sel) return;
    var previous = sel.value;
    sel.innerHTML = '';
    for (var i = 0; i < list.length; i++) {
        var opt = document.createElement('option');
        opt.value = String(list[i]);
        opt.textContent = list[i] + 'lb';
        sel.appendChild(opt);
    }
    var keepPrevious = false;
    for (var j = 0; j < list.length; j++) {
        if (String(list[j]) === previous) keepPrevious = true;
    }
    sel.value = keepPrevious ? previous : String(list[Math.min(1, list.length - 1)]);
}

function onLineMatChange(baseId, fromLog) {
    var isLeader = (baseId === 'ld-mat');
    var lbBase = isLeader ? 'ld-lb' : 'ml-lb';
    syncSelect(baseId, fromLog);
    updateLbOptions(baseId, lbBase, isLeader);
    updateLbOptions(baseId + '-log', lbBase + '-log', isLeader);
    if (fromLog) setFieldValue(lbBase, getStr(lbBase + '-log'));
    else setFieldValue(lbBase + '-log', getStr(lbBase));
    logDebug("Material: " + getStr(baseId) + " -> " + getStr(lbBase) + "lb", "STATE");
}

// --- WATER REPORT LOGIC ---
function getFMIColor(score) {
    var s = Math.max(0, Math.min(100, parseFloat(score)));
    if (s <= 50) {
        var pct = s / 50.0;
        return "rgb(255, " + Math.round(69 + pct*(214-69)) + ", " + Math.round(58 + pct*(10-58)) + ")";
    } else {
        var pct = (s - 50) / 50.0;
        return "rgb(" + Math.round(255 + pct*(48-255)) + ", " + Math.round(214 + pct*(209-214)) + ", " + Math.round(10 + pct*(88-10)) + ")";
    }
}

// Parse a 12-hour display time ("4:15 AM") back into decimal hours for chart
// x-placement. Falls back to parsing "HH:MM" for defensive compatibility.
function tideHourOf(label) {
    var m = String(label || '').trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
    if (!m) return 0;
    var h = parseInt(m[1], 10) % 12;
    if (/pm/i.test(m[3] || '')) h += 12;
    return h + parseInt(m[2], 10) / 60;
}

function formatTideRow(tideStr, tideCurve, tidePoints) {
    if (!tideStr || tideStr.indexOf('Syncing') !== -1) {
        // Keep the curve beside the pills so there is never an orphaned
        // "TIDE CURVE" section anywhere else on the card.
        var curveHtml = tideCurveSvg(tidePoints, tideCurve);
        return '<div class="env-tide-row">' +
            '<span class="tide-empty">' + (tideStr || 'Tide Data Syncing...') + '</span>' +
            (curveHtml ? '<div class="tide-curve-wrap">' + curveHtml + '</div>' : '') +
            '</div>';
    }
    var items = tideStr.split(' | ');
    var html = '<div class="env-tide-row"><div class="tide-pills">';
    for (var k = 0; k < items.length; k++) {
        var item = items[k].trim();
        var match = item.match(/^(High|Low):\s*([0-9:AMP\s]+)\s*\(([0-9.-]+\s*ft)\)/i);
        if (match) {
            var type = match[1].toUpperCase();
            var time = match[2].trim();
            var height = match[3].trim();
            html += '<div class="tide-pill">' +
                '<span class="tide-type">' + type + '</span>' +
                '<span class="tide-time">' + time + '</span>' +
                '<span class="tide-level">(' + height + ')</span>' +
            '</div>';
        } else {
            html += '<div class="tide-pill"><span class="tide-time" style="color: #64d2ff;">' + item + '</span></div>';
        }
    }
    html += '</div>';
    // The tide curve rides inside the same panel, right beside the pills.
    html += '<div class="tide-curve-wrap">' + tideCurveSvg(tidePoints, tideCurve) + '</div>' +
        '</div>';
    return html;
}

// Smooth full-height tide area chart. Draws the day's REAL hourly NOAA curve
// (tidePoints) with light Catmull-Rom smoothing, fills the area under it with a
// subtle gradient, and labels ONLY the high/low extremes (tideCurve) with dots +
// compact 12-hour times. Falls back to the old 4-point zigzag if no hourly
// data arrived (e.g. offline cached payload).
function tideCurveSvg(points, extremes) {
    var smooth = points && points.length > 1;
    var src = smooth ? points : (extremes || []);
    if (!src || !src.length) return '';
    var W = 320, H = 96, padX = 12, padY = 18;
    var hrs = src.map(function (p) { return tideHourOf(p.t); });
    var hs = src.map(function (p) { return Number(p.h); });
    var minH = Math.min.apply(null, hs), maxH = Math.max.apply(null, hs);
    var spanH = (maxH - minH) || 1;
    // Pad the vertical range so labels don't clip at the top/bottom edges.
    minH -= spanH * 0.18; maxH += spanH * 0.18; spanH = (maxH - minH) || 1;

    function X(t) { return padX + (t / 23) * (W - 2 * padX); }
    function Y(h) { return H - padY - ((h - minH) / spanH) * (H - 2 * padY); }

    var lineD;
    if (smooth) {
        // Catmull-Rom -> cubic bezier path through every hourly point.
        var P = src.map(function (p, i) { return { x: X(hrs[i]), y: Y(Number(p.h)) }; });
        lineD = 'M' + P[0].x.toFixed(1) + ',' + P[0].y.toFixed(1);
        for (var i = 0; i < P.length - 1; i++) {
            var p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
            lineD += ' C' + (p1.x + (p2.x - p0.x) / 6).toFixed(1) + ',' + (p1.y + (p2.y - p0.y) / 6).toFixed(1) +
                ' ' + (p2.x - (p3.x - p1.x) / 6).toFixed(1) + ',' + (p2.y - (p3.y - p1.y) / 6).toFixed(1) +
                ' ' + p2.x.toFixed(1) + ',' + p2.y.toFixed(1);
        }
    } else {
        lineD = 'M' + src.map(function (p, i) { return X(hrs[i]).toFixed(1) + ',' + Y(Number(p.h)).toFixed(1); }).join(' L');
    }

    var areaD = lineD + ' L' + (W - padX).toFixed(1) + ',' + (H - padY).toFixed(1) +
        ' L' + padX.toFixed(1) + ',' + (H - padY).toFixed(1) + ' Z';

    // Label ONLY the extremes (highs above the dot, lows below) so the labels
    // never collide into the dense 9px mess the old version had.
    var labels = '';
    if (extremes && extremes.length) {
        for (var j = 0; j < extremes.length; j++) {
            var e = extremes[j];
            var cx = X(tideHourOf(e.t)), cy = Y(Number(e.h));
            var up = (e.type === 'H');
            labels += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="3.2" class="tide-ext-dot" />' +
                '<text x="' + cx.toFixed(1) + '" y="' + (up ? cy - 7 : cy + 14).toFixed(1) + '" text-anchor="middle" class="tide-ext-label">' +
                (e.t || '') + ' · ' + (up ? 'H' : 'L') + ' ' + Number(e.h).toFixed(1) + 'ft</text>';
        }
    }

    return '<svg viewBox="0 0 ' + W + ' ' + (H + 8) + '" class="tide-svg" role="img" aria-label="Tide curve for the day">' +
        '<defs><linearGradient id="tide-grad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#64d2ff" stop-opacity="0.45"/>' +
        '<stop offset="1" stop-color="#64d2ff" stop-opacity="0"/>' +
        '</linearGradient></defs>' +
        '<path d="' + areaD + '" class="tide-area" />' +
        '<path d="' + lineD + '" class="tide-line" fill="none" />' +
        '<line x1="' + padX + '" y1="' + (H - padY).toFixed(1) + '" x2="' + (W - padX) + '" y2="' + (H - padY).toFixed(1) + '" class="tide-baseline" />' +
        labels + '</svg>';
}

// Plain-English "hero" for the water card. Replaces the opaque 0-100 Movement
// Index + % timeline: a single-line compact strip — verdict · best window · why.
// Everything is derived from the same real triggers (rain freshet, pressure
// trend, tide highs, moon phase, transit state, netting) — never fabricated.
function buildFishingHero(rep) {
    if (!rep) return '';
    var score = 0;
    var reasons = [];
    var any = false;

    if (rep.rain !== null && rep.rain !== undefined && rep.rain > 0.05) {
        any = true; score += 12;
        reasons.push('Rain freshet (' + rep.rain.toFixed(2) + ' in)');
    }
    if (rep.press_delta !== null && rep.press_delta !== undefined && rep.press_delta < -0.04) {
        any = true; score += 10;
        reasons.push('Pressure dropping');
    } else if (rep.press_delta !== null && rep.press_delta !== undefined && rep.press_delta > 0.04) {
        any = true; score -= 6;
        reasons.push('High pressure settling in');
    }
    if (rep.tide_curve && rep.tide_curve.length) {
        var highs = rep.tide_curve.filter(function (t) { return t.type === 'H'; });
        if (highs.length) {
            any = true; score += Math.min(10, highs.length * 5);
            reasons.push(highs.length + ' high tide' + (highs.length > 1 ? 's' : '') + ' today');
        }
    }
    if (rep.lunar_icon && (rep.lunar_icon.indexOf('New') !== -1 || rep.lunar_icon.indexOf('Full') !== -1)) {
        any = true; score += 5;
        reasons.push(rep.lunar_icon.replace(/^[^\s]+\s*/, '') + ' swing');
    }
    if (rep.transit_state && rep.transit_state !== '--') {
        any = true;
        if (rep.transit_state.indexOf('High Velocity') !== -1) { score += 8; reasons.push('Water moving fast'); }
        else if (rep.transit_state.indexOf('Bay Staging') !== -1) { score += 4; reasons.push('Fish staging'); }
        else if (rep.transit_state.indexOf('CORKED') !== -1) { score -= 25; reasons.push('River corked (nets in)'); }
    }
    if (rep.is_netting) { score -= 15; reasons.push('Netting day (Sun/Mon/Tue)'); }
    if (rep.clarity_outlook) { any = true; reasons.push(rep.clarity_outlook); }

    var verdict, vColor;
    if (!any) {
        verdict = 'Live conditions unavailable';
        vColor = 'var(--text-muted)';
    } else if (score >= 20) {
        verdict = '\uD83D\uDC4D Good day to fish'; vColor = 'var(--accent-green)';
    } else if (score >= 0) {
        verdict = '\u26A0\uFE0F Mixed conditions'; vColor = 'var(--accent-yellow)';
    } else {
        verdict = '\uD83D\uDC4E Tough conditions'; vColor = 'var(--accent-red)';
    }

    // Best window: the server already computes rep.windows with start/end + trigger.
    var best = null;
    if (rep.windows && rep.windows.length) {
        for (var w = 0; w < rep.windows.length; w++) {
            if (!best || rep.windows[w].score > best.score) best = rep.windows[w];
        }
    }
    var peakTxt = '';
    if (best) {
        var pCol = getFMIColor(best.score);
        peakTxt = '<span class="hero-peak-time" style="color:' + pCol + ';">Best ' + best.start_str + ' \u2013 ' + best.end_str + '</span>';
    }

    // Join reasons into the strip (cap at 3 so it stays one compact line).
    var whyTxt = reasons.slice(0, 3).map(function (r) { return '<span class="hero-why-bit">' + r + '</span>'; }).join('<span class="hero-sep">\u00B7</span>');

    return '<div class="fishing-hero">' +
        '<span class="hero-verdict" style="color:' + vColor + ';">' + verdict + '</span>' +
        (peakTxt ? '<span class="hero-sep">\u00B7</span>' + peakTxt : '') +
        (whyTxt ? '<span class="hero-sep">\u00B7</span>' + whyTxt : '') +
        '</div>';
}

// Per-species run card in the [ RUN & TIMING ] panel: status pill + window
// progress bar + peak line ALWAYS visible; the raw counts (WDFW forecast /
// Return / Trap / 5-Yr Avg) fold behind a <details> per card so "status stays,
// numbers fold". escStocks is the water.js hatchery registry (may be absent => "--").
function buildSpeciesCalendarHtml(calendar, escStocks) {
    if (!calendar || !calendar.length) return '';
    var html = '<div class="run-timing-cards">';
    for (var i = 0; i < calendar.length; i++) {
        var s = calendar[i];
        var statusClass = 'spc-' + (s.position || 'off');
        var peakLine = (s.days_until_peak !== null && s.days_until_peak !== undefined)
            ? ((s.days_until_peak >= 0 ? 'Peak in ' + s.days_until_peak + 'd' : 'Peak was ' + Math.abs(s.days_until_peak) + 'd ago'))
            : '';
        var prog = (typeof s.progress === 'number') ? Math.max(0, Math.min(1, s.progress)) : 0;
        var peakFrac = (typeof s.peak_frac === 'number') ? Math.max(0, Math.min(1, s.peak_frac)) : 0.5;
        var fillPct = (prog * 100).toFixed(1);
        var peakLeft = (peakFrac * 100).toFixed(1);
        // Species-safe key for count folding: match hatchery registry by exact
        // species name (Chinook/Coho/Pink vs the registry's Chinook/Coho/Jacks).
        var escKey = String(s.species || '').toLowerCase();
        var esc = null;
        if (escStocks && escStocks.stocks) {
            for (var e = 0; e < escStocks.stocks.length; e++) {
                if (String(escStocks.stocks[e].name || '').toLowerCase() === escKey) { esc = escStocks.stocks[e]; break; }
            }
        }
        var wdfwForecast = null; // filled by 2.1d from src/data/wdfw_forecasts.json
        var countVal = function (v) { return (v === null || v === undefined || isNaN(v)) ? '--' : Number(v).toLocaleString('en-US'); };
        var escName = esc ? esc.name : (s.species || '');
        var escNameEsc = String(escName).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });

        html += '<div class="run-card ' + statusClass + '" data-species="' + escKey + '">' +
            '<div class="run-card-hdr">' +
                '<span class="spc-name">' + escNameEsc + '</span>' +
                '<span class="run-status-pill">' + (s.status_text || '') + '</span>' +
            '</div>' +
            '<div class="run-track" role="img" aria-label="Run window">' +
                '<span class="run-fill" style="width:' + fillPct + '%;"></span>' +
                '<span class="run-peak" style="left:' + peakLeft + '%;"></span>' +
            '</div>' +
            '<div class="run-track-lbl">' +
                '<span class="run-lbl-start">' + (s.window_start || '') + '</span>' +
                '<span class="run-lbl-peak">Peak ' + (s.peak_date || '') + '</span>' +
                '<span class="run-lbl-end">' + (s.window_end || '') + '</span>' +
            '</div>' +
            (peakLine ? '<div class="run-footer">' + peakLine + '</div>' : '') +
            '<details class="run-counts">' +
                '<summary><span class="run-counts-toggle">\uD83D\uDCCA Counts</span></summary>' +
                '<div class="run-counts-grid">' +
                    '<div class="esc-row esc-row-forecast"><span class="esc-row-lbl">Forecast</span><span class="esc-row-val" data-count="wdfw">' + countVal(wdfwForecast) + '</span></div>' +
                    '<div class="esc-row"><span class="esc-row-lbl">Returned</span><span class="esc-row-val" data-count="return">' + (esc ? countVal(esc.totalReturn) : '--') + '</span></div>' +
                    '<div class="esc-row"><span class="esc-row-lbl">Trapped</span><span class="esc-row-val" data-count="trap">' + (esc ? countVal(esc.trapCount) : '--') + '</span></div>' +
                    '<div class="esc-row"><span class="esc-row-lbl">5-Yr Avg</span><span class="esc-row-val" data-count="avg">' + (esc ? countVal(esc.fiveYrAvg) : '--') + '</span></div>' +
                '</div>' +
            '</details>' +
        '</div>';
    }
    html += '</div>';
    return html;
}

var activeDateOffset = 0;
var reportsData = [];

function stepDate(delta) {
    var newOffset = activeDateOffset + delta;
    if (newOffset < 0) return;
    var maxOffset = reportsData.length > 0 ? reportsData.length - 1 : 14;
    if (newOffset > maxOffset) return;
    activeDateOffset = newOffset;
    updateActiveDateUI();
}

function showDay(dayId) {
    var cards = document.getElementsByClassName('day-card');
    for(var i = 0; i < cards.length; i++) { cards[i].style.display = 'none'; }
    var target = document.getElementById(dayId);
    if(target) target.style.display = 'block';
}

// Legal-hours resolution: the backend Open-Meteo payload is the single source of
// truth whenever the telemetry API is reachable. The local NOAA/Meeus
// calculation is the offline fallback only, so the hero and the day cards
// can never disagree by 1-3 min on a fresh load.
function updateActiveDateUI() {
    var d = new Date();
    d.setDate(d.getDate() + activeDateOffset);

    // 1. Centered Date Display: e.g. "Monday, September 14"
    var options = { weekday: 'long', month: 'long', day: 'numeric' };
    var dateStr = d.toLocaleDateString('en-US', options);
    var dateEl = document.getElementById('date-nav-text');
    if (dateEl) dateEl.innerText = dateStr;

    // Subtle (Today) badge if matches current calendar day
    var now = new Date();
    var isToday = (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
    );
    var badgeEl = document.getElementById('date-today-badge');
    if (badgeEl) badgeEl.style.display = isToday ? 'inline' : 'none';

    // Prev/Next button states
    var prevBtn = document.getElementById('btn-prev-date');
    if (prevBtn) {
        if (activeDateOffset <= 0) {
            prevBtn.classList.add('disabled');
            prevBtn.disabled = true;
        } else {
            prevBtn.classList.remove('disabled');
            prevBtn.disabled = false;
        }
    }
    var nextBtn = document.getElementById('btn-next-date');
    if (nextBtn) {
        var maxOffset = reportsData.length > 0 ? reportsData.length - 1 : 14;
        if (activeDateOffset >= maxOffset) {
            nextBtn.classList.add('disabled');
            nextBtn.disabled = true;
        } else {
            nextBtn.classList.remove('disabled');
            nextBtn.disabled = false;
        }
    }

    // 2. Resolve Active Station & GPS
    var activeStation = null;
    try {
        var sStr = localStorage.getItem('active_station');
        if (sStr) activeStation = JSON.parse(sStr);
    } catch(e) {}
    var riverId = activeStation ? activeStation.id : "12101500";
    var riverName = (activeStation && activeStation.name) ? activeStation.name : 'Puyallup River';
    var gpsCoords = (activeStation && activeStation.isGps) ? { lat: activeStation.lat, lon: activeStation.lon } : (window.userGPSCoords || null);

    // 3. Dynamic Regulations Engine Evaluation
    if (typeof checkRiverStatus === 'function') {
        // New engine signature: checkRiverStatus(date, gpsCoords, activeRiverName) -> ruled by src/utils/regulations.js.
        var reg = checkRiverStatus(d, gpsCoords, riverName);
        var pill = document.getElementById('river-status-pill');
        if (pill) {
            // Plain pill: just OPEN / CLOSED. No reason or zone-detail text on the
            // pill itself — the title attr keeps the full rule detail for assistive tech.
            pill.innerText = (reg && reg.isOpen ? '● RIVER OPEN' : '● RIVER CLOSED');
            pill.className = 'reg-status-pill ' + (reg && reg.isOpen ? 'status-pill-open' : 'status-pill-closed');
            pill.title = (reg && reg.ruleDetail) ? String(reg.ruleDetail) : 'WDFW regulation status for ' + riverName;
        }
        var regDetail = document.getElementById('reg-detail');
        if (regDetail) {
            regDetail.innerHTML = '';
        }
    }

    // 4. Dynamic Solar / Legal Hours Calculation
    var stLat = activeStation ? activeStation.lat : 47.1950;
    var stLon = activeStation ? activeStation.lon : -122.3020;
    var rep = (activeDateOffset >= 0 && activeDateOffset < reportsData.length) ? reportsData[activeDateOffset] : null;
    var legalIn = "--:--", legalOut = "--:--";

    // Primary: backend solar times (exact Open-Meteo sunrise/sunset for this date).
    if (rep && rep.lines_in && rep.lines_out && !rep.api_offline) {
        legalIn = rep.lines_in;
        legalOut = rep.lines_out;
    } else if (typeof calculateSolarHours === 'function') {
        // Offline fallback: local approximation for the active station coords.
        var solar = calculateSolarHours(d, stLat, stLon);
        if (solar && solar.lines_in && solar.lines_out && solar.lines_in !== '--') {
            legalIn = solar.lines_in;
            legalOut = solar.lines_out;
        } else if (rep && rep.lines_in && rep.lines_out) {
            // Last resort: stale backend payload (better than "--:--").
            legalIn = rep.lines_in;
            legalOut = rep.lines_out;
        }
    } else if (rep && rep.lines_in && rep.lines_out) {
        legalIn = rep.lines_in;
        legalOut = rep.lines_out;
    }

    var heroHours = document.getElementById('hero-legal-hours');
    if (heroHours) {
        heroHours.innerText = 'Legal Hours: ' + legalIn + ' \u2013 ' + legalOut;
    }

    // 5. Toggle active day card
    var cards = document.getElementsByClassName('day-card');
    for (var i = 0; i < cards.length; i++) {
        cards[i].style.display = 'none';
    }
    if (rep) {
        var targetCard = document.getElementById(rep.id);
        if (targetCard) targetCard.style.display = 'block';
    }

    // Keep the Gear Sim strike zone in step with the day being viewed
    if (typeof refreshZonePreview === 'function') refreshZonePreview();
}

/**
 * Water Report empty / failure state. Rendered when the API returns no day
 * cards or throws, so the tab is never a blank black screen.
 *
 * @param {string} title    headline for the state
 * @param {string} hint     what the angler can do about it
 * @param {boolean} offline whether the failure was a network failure
 */
function renderWaterReportEmptyState(title, hint, offline) {
    var box = document.getElementById('water-report-cards');
    if (!box) return;
    box.innerHTML = '<div class="empty-state empty-state-panel">' +
        '<div class="empty-state-icon">' + (offline ? '📡' : '🌊') + '</div>' +
        '<div class="empty-state-title">' + title + '</div>' +
        '<div class="empty-state-hint">' + hint + '</div>' +
        '<button class="btn-main" onclick="loadWaterReport()" style="margin-top:14px;">RETRY</button>' +
        '</div>';
    logDebug('Water report empty state: ' + title, 'UI');
}

// Loads (or silently refreshes) the water report. When `silent` is true this is
// a background auto-refresh: it must NOT overwrite a Gear Sim CFS the angler
// typed by hand (the initial load + manual station change still auto-sync).
async function loadWaterReport(silent) {
    var active = localStorage.getItem('active_station');
    var station = null;
    try {
        if (active) station = JSON.parse(active);
    } catch(e) {}
    if (!station || station.id === '12096500' || !station.id) {
        station = { id: '12101500', lat: 47.1950, lon: -122.3020, name: 'Puyallup River at Puyallup, WA', isGps: false };
        localStorage.setItem('active_station', JSON.stringify(station));
    }
    
    // Update header & badge
    document.getElementById('active-station-name').innerText = station.name.toUpperCase();
    var badge = document.getElementById('active-station-badge');
    if (station.isGps) {
        badge.innerText = "📍 GPS: " + station.id;
        badge.className = "station-badge badge-gps";
    } else {
        badge.innerText = "📌 USGS: " + station.id;
        badge.className = "station-badge badge-manual";
    }
    updateActiveDateUI();

    // Regulations rules and the water report are independent network reads, so
    // start them concurrently instead of paying for the two round trips in
    // series. The promise is awaited just before the date UI evaluates river
    // status, so behaviour is identical - only the wait is shorter.
    var rulesPromise = (typeof loadRegulationsRules === 'function')
        ? Promise.resolve().then(loadRegulationsRules).catch(function (e) {
            logDebug('Regulations rules error: ' + e.message, 'ERR');
        })
        : Promise.resolve();

    logDebug("Fetching Water API for " + station.name + " (" + station.id + ")...", "NET");
    try {
        var res = await fetch('/api/water_report?site=' + station.id + '&lat=' + station.lat + '&lon=' + station.lon + '&_t=' + Date.now(), {
            cache: 'no-store'
        });
        var reports = await res.json();
        reportsData = reports;
        logDebug("Water API success. Processing " + reports.length + " days.", "NET");

        // Today's barometer / cloud / rain now feed the Gear Sim strike zone
        if (typeof refreshZonePreview === 'function') refreshZonePreview();

        if (reports.length > 0) {
            var first = reports[0];
            if (first.site_name) {
                document.getElementById('active-station-name').innerText = first.site_name.toUpperCase();
            }
            var actId = first.site_id || station.id;
            badge.innerText = (station.isGps ? "📍 GPS: " : "📌 USGS: ") + actId;
        }
        
        // Phase 2: hatchery escapement counts now live INSIDE the merged
        // [ RUN & TIMING ] per-species cards (see buildSpeciesCalendarHtml);
        // refreshEscapement fills their count rows async after card render.

        var cardsHtml = '';

        // Automatically push Live CFS to Gear Sim (skip on USGS outage so the
        // manual CFS the angler typed is preserved instead of being blanked,
        // and skip on silent auto-refresh so a background refresh never clobbers
        // a CFS the angler typed by hand).
        if(!silent && reports.length > 0 && reports[0].cfs !== null && reports[0].cfs !== undefined && !reports[0].api_offline) {
            var cfsInput = document.getElementById('flow');
            cfsInput.value = reports[0].cfs;
            syncSelect('flow');
            logDebug("Auto-synced CFS to Gear Sim: " + reports[0].cfs, "STATE");
        }

        for(var i=0; i<reports.length; i++) {
            var rep = reports[i];
            // Escapement registry for the [ RUN & TIMING ] panel.
            var escStocks = (typeof hatcheryEscapement !== 'undefined' && hatcheryEscapement[String(actId || station.id)])
                ? hatcheryEscapement[String(actId || station.id)] : null;

            var dStyle = (i === activeDateOffset) ? "block" : "none";

            var pCol = (rep.press_delta > 0) ? 'var(--accent-green)' : ((rep.press_delta < 0) ? 'var(--accent-red)' : '#ffffff');
            // Barometric trend from the API's 6-hour pressure window: up-arrow rising, down-arrow falling, dash flat
            var pArr = (rep.press_delta > 0) ? '\u2191' : ((rep.press_delta < 0) ? '\u2193' : '\u2014');
            // Temperature trend arrow + color (same barometer pattern, honest data).
            var tCol = (rep.temp_delta_f > 0.4) ? 'var(--accent-green)' : ((rep.temp_delta_f < -0.4) ? 'var(--accent-red)' : '#ffffff');
            var tArr = (rep.temp_delta_f > 0.4) ? '\u2191' : ((rep.temp_delta_f < -0.4) ? '\u2193' : '\u2014');
            // Wind: direction arrow + speed (single "mph" unit — FIXES the
            // duplicate "mphmph" text). 16-point compass -> 8-way arrow.
            var WIND_ARROWS = { 'N':'\u2191','NNE':'\u2197','NE':'\u2197','ENE':'\u2197','E':'\u2192','ESE':'\u2198','SE':'\u2198','SSE':'\u2198','S':'\u2193','SSW':'\u2199','SW':'\u2199','WSW':'\u2199','W':'\u2190','WNW':'\u2196','NW':'\u2196','NNW':'\u2196' };
            var windDisplay = (rep.wind_speed_mph != null)
                ? ((rep.wind_dir_compass ? (WIND_ARROWS[rep.wind_dir_compass] || rep.wind_dir_compass) + ' ' : '') + Math.round(rep.wind_speed_mph) + ' mph')
                : '--';

            var cfsVal = (rep.cfs !== null && rep.cfs !== undefined) ? Number(rep.cfs).toLocaleString('en-US') + ' CFS' : '-- CFS';
            var gageVal = (rep.gage !== null && rep.gage !== undefined) ? rep.gage.toFixed(2) + ' ft Gauge Height' : '-- ft Gauge Height';
            // Own-gauge water quality (locked: active station's OWN USGS 00010 /
            // 63680 only — never a proxy). Rendered ONLY when the station reports
            // them; otherwise the whole block is omitted so nothing fake shows.
            var hasWaterTemp = (rep.water_temp_f !== undefined && rep.water_temp_f !== null && !isNaN(rep.water_temp_f));
            var hasTurbidity = (rep.turbidity_fnu !== undefined && rep.turbidity_fnu !== null && !isNaN(rep.turbidity_fnu));
            var waterQualityHtml = '';
            if (hasWaterTemp || hasTurbidity) {
                waterQualityHtml = '<div class="telemetry-qualities">' +
                    (hasWaterTemp ? '<span class="telemetry-quality"><span class="water-temp">' + Math.round(Number(rep.water_temp_f)) + '</span>°F H₂O</span>' : '') +
                    (hasWaterTemp && hasTurbidity ? '<span class="telemetry-sep">&bull;</span>' : '') +
                    (hasTurbidity ? '<span class="telemetry-quality">Turbidity <span class="turbidity-val">' + Number(rep.turbidity_fnu).toFixed(1) + '</span> FNU</span>' : '') +
                '</div>';
            }
            // Clarity is folded into the fishing hero (buildFishingHero) — no
            // inline badge in the telemetry row.
            // Distinguish USGS network outages (data_dict api_offline) from a truly seasonal station
            // so a 503 / timeout no longer renders as "seasonal / not reporting".
            var seasonalWarn = '';
            if (rep.api_offline) {
                seasonalWarn = '<div class="seasonal-warning" style="background:var(--card-bg);border:1px solid var(--accent-red);color:var(--accent-red);">⚠️ USGS Telemetry API temporarily unreachable — showing last manual CFS</div>';
            } else if (!rep.is_active) {
                seasonalWarn = '<div class="seasonal-warning">⚠️ Station currently seasonal / not reporting live discharge</div>';
            }

            cardsHtml += '<div id="'+rep.id+'" class="day-card" style="display: '+dStyle+';">' +
                '<div class="card">' +
                // PLAIN-ENGLISH HERO — the first thing on the card: verdict ·
                // best window · why (one compact line, half the old height).
                buildFishingHero(rep) +
                // RIVER & ENVIRONMENTAL CONDITIONS (Consolidated)
                '<div class="sec-hdr">[ RIVER &amp; ENVIRONMENTAL CONDITIONS ]</div>' +
                seasonalWarn +
                '<div class="env-telemetry-row">' +
                  '<div class="telemetry-main">' +
                    '<span class="telemetry-val"><span class="cfs-val">' + cfsVal + '</span><span class="telemetry-sep">&bull;</span><span class="gage-val">' + gageVal + '</span></span>' +
                    waterQualityHtml +
                  '</div>' +
                  '<div class="telemetry-updated">' + (rep.updated_time || '') + '</div>' +
                '</div>' +
                formatTideRow(rep.tide_chart, rep.tide_curve, rep.tide_points) +
                '<div class="env-weather-solunar">' +
                  '<div class="env-stat-grid">' +
                    // Row 1 (Atmospheric): BAROMETER, PRECIP %, PRECIP VOL (each
                    // with a live timing hint when the forecast supports it)
                    '<div class="env-badge">' +
                      '<div class="env-badge-val" style="color:' + pCol + ';">' + rep.pressure.toFixed(2) + ' <span style="font-size:10px; font-weight:600;">inHg</span> ' + pArr + '</div>' +
                      '<div class="env-badge-lbl">Barometer</div>' +
                    '</div>' +
                    '<div class="env-badge">' +
                      '<div class="env-badge-val"><span class="precip-pop">' + (rep.pop_pct != null ? rep.pop_pct : '--') + '</span>%</div>' +
                      '<div class="env-badge-sub">' + (rep.precip_start_text || rep.precip_end_text || '') + '</div>' +
                      '<div class="env-badge-lbl">Precip %</div>' +
                    '</div>' +
                    '<div class="env-badge">' +
                      '<div class="env-badge-val"><span class="precip-vol">' + (rep.rain != null ? rep.rain.toFixed(2) : '--') + '</span>"</div>' +
                      '<div class="env-badge-sub">' + (rep.precip_start_text || rep.precip_end_text || '') + '</div>' +
                      '<div class="env-badge-lbl">Precip Vol</div>' +
                    '</div>' +
                    // Row 2: CLOUD%, TEMP (trend arrow), WIND (direction arrow)
                    '<div class="env-badge">' +
                      '<div class="env-badge-val">' + rep.cloud_pct + '%</div>' +
                      '<div class="env-badge-lbl">Cloud Cover</div>' +
                    '</div>' +
                    '<div class="env-badge">' +
                      '<div class="env-badge-val" style="color:' + tCol + ';"><span class="air-temp">' + (rep.air_temp_f != null ? Math.round(rep.air_temp_f) : '--') + '</span>° ' + tArr + '</div>' +
                      '<div class="env-badge-lbl">Temp</div>' +
                    '</div>' +
                    '<div class="env-badge">' +
                      '<div class="env-badge-val"><span class="wind-val">' + windDisplay + '</span></div>' +
                      '<div class="env-badge-lbl">Wind</div>' +
                    '</div>' +
                    // Row 3: SUNRISE/SUNSET (split), MOON PHASE, SOLUNAR
                    '<div class="env-badge">' +
                      '<div class="env-badge-val solunar-split">' +
                        '<div class="solunar-half">' +
                          '<span class="solunar-val" style="color:#fbbf24;">\u2191 ' + (rep.sunrise || '--:--') + '</span>' +
                          '<span class="solunar-sublbl">Sunrise</span>' +
                        '</div>' +
                        '<div class="solunar-half">' +
                          '<span class="solunar-val" style="color:#64d2ff;">\u2193 ' + (rep.sunset || '--:--') + '</span>' +
                          '<span class="solunar-sublbl">Sunset</span>' +
                        '</div>' +
                      '</div>' +
                      '<div class="env-badge-lbl">Sun / Set</div>' +
                    '</div>' +
                    '<div class="env-badge">' +
                      '<div class="env-badge-val moon-pill">' + (rep.lunar_icon || '🌑') + '</div>' +
                      '<div class="env-badge-lbl">Moon Phase</div>' +
                    '</div>' +
                    '<div class="env-badge">' +
                      '<div class="env-badge-val solunar-split">' +
                        '<div class="solunar-half">' +
                          '<span class="solunar-val" style="color:#ffd60a;">' + rep.moon_upper + '</span>' +
                          '<span class="solunar-sublbl">Overhead</span>' +
                        '</div>' +
                        '<div class="solunar-half">' +
                          '<span class="solunar-val" style="color:#64d2ff;">' + rep.moon_lower + '</span>' +
                          '<span class="solunar-sublbl">Underfoot</span>' +
                        '</div>' +
                      '</div>' +
                      '<div class="env-badge-lbl">Solunar</div>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
                // 5b. ONE [ RUN & TIMING ] panel: per-species run cards
                // (status/progress/peak visible, counts folded).
                '<div class="run-timing">' +
                  '<div class="sec-hdr">[ RUN &amp; TIMING ]</div>' +
                  buildSpeciesCalendarHtml(rep.species_calendar, escStocks) +
                '</div>' + '</div></div>';
        }
        document.getElementById('water-report-cards').innerHTML = cardsHtml;
        // Paint the own-gauge water temp/turbidity into the telemetry area
        // (already server-rendered in the card HTML) and sync window.waterTempF
        // for the Gear Sim.
        var firstRep = reports[0];
        if (typeof applyOwnGaugeWaterQuality === 'function') {
            applyOwnGaugeWaterQuality(
                (firstRep && firstRep.water_temp_f !== undefined) ? firstRep.water_temp_f : null,
                (firstRep && firstRep.turbidity_fnu !== undefined) ? firstRep.turbidity_fnu : null
            );
        }
        // An empty payload would otherwise leave the tab as a blank black screen.
        if (!reports || reports.length === 0) {
            renderWaterReportEmptyState(
                'No river data returned',
                'USGS did not report any forecast days for this station. Try another station, or check back when the gauge is back online.',
                false
            );
        }
        // Ensure the WDFW rules are in place before the date UI evaluates river
        // status (checkRiverStatus reads them). They were fetched in parallel
        // with the water report above, so this normally resolves immediately.
        await rulesPromise;
        updateActiveDateUI();
        // Phase 2: refresh escapement figures from the live Socrata feed (graceful -- on failure)
        refreshEscapement(actId || station.id);
        // Phase 2.1: apply the human-confirmed WDFW annual forecast (static JSON,
        // graceful -- if absent). Same "fill only matching count cell" contract.
        refreshWdfwForecast();

        // Live telemetry: two independent reads (USGS CFS momentum, Open-Meteo
        // surface conditions). Water temp + turbidity no longer need their own
        // call — they ride in the water-report payload from the active station's
        // OWN gauge (00010 / 63680) and are painted straight from the card HTML.
        Promise.all([
            fetchCFSMomentum(actId || station.id)
        ]).then(function () {
            logDebug('Telemetry batch settled (CFS momentum)', 'NET');
        });
        // "Now" surface conditions (air/wind/precip) are painted FROM the first
        // report day (backend Open-Meteo `current`) — no client-side Open-Meteo call.
        if (reports && reports[0] && typeof applyReportWeather === 'function') {
            applyReportWeather(reports[0]);
        }
    } catch(e) {
        logDebug("API Error: " + e.message, "ERR");
        await rulesPromise;
        updateActiveDateUI();
        // Only replace the container when there is nothing to show; a previously
        // rendered report is more useful than an error panel.
        var existing = document.getElementById('water-report-cards');
        if (existing && !existing.children.length) {
            renderWaterReportEmptyState(
                navigator.onLine === false ? 'Offline — no cached report yet' : 'Water report unavailable',
                navigator.onLine === false
                    ? 'This station has not been cached on this device. Reconnect to fetch it, or pick a station you have already loaded.'
                    : 'The telemetry service did not respond. Legal hours still compute locally, and the Gear Sim works on the flow you enter.',
                navigator.onLine === false
            );
        }
        // Catch path: still paint weather from whatever report may be cached.
        if (typeof applyReportWeather === 'function' && reportsData && reportsData[0]) {
            applyReportWeather(reportsData[0]);
        }
    }
}



// --- GEAR SIM: DETERMINISTIC FLUID DYNAMICS ENGINE ---
// Pure boundary-layer physics. Every output is a pure function of the form inputs plus
// the stored catch log, so identical inputs always return identical numbers.
// The old KNN loop (processAiStrikeZone) and calcHistoricHeight() drift model are gone.
var currentStats = null;

var BASE_ZONE_MIN = 4.0;     // inches - baseline strike zone floor
var BASE_ZONE_MAX = 12.0;    // inches - baseline strike zone ceiling

// Calibration constants. Tuned so a reference rig (1040 CFS, 12 lb leader, 1/2 oz lead,
// 10 ft leader, Corky 10 + 1" yarn) lands in the middle of the baseline zone.
// Physics is LOCKED: drag coefficient is always 1.0. Community catches never bend
// the physics - they act as sonar that shifts WHERE the fish are (the zone).
var DRAG_REF = 7.5;          // drag units per foot of leader at the reference conditions
var REF_VELOCITY = 2.45;     // ft/s bed velocity produced by 1040 CFS
var REF_LB_TEST = 12;        // reference leader diameter for those conditions

function getNum(id) {
    var el = document.getElementById(id);
    if (!el) return 0;
    var val = parseFloat(el.value);
    return isNaN(val) ? 0 : val;
}
function getStr(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
}

function getGPS() {
    if("geolocation" in navigator) {
        logDebug("Requesting GPS...", "SYS");
        navigator.geolocation.getCurrentPosition(function(pos){
            // GPS is captured SILENTLY (no visible field on the form) but still
            // stored so logData() can include it in the private catch row.
            window.userGPSCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
            logDebug("GPS Lock acquired (coords held privately for the catch row)", "SYS");
            updateActiveDateUI();
        }, function(err){
            window.userGPSCoords = null;
            logDebug("GPS Error: " + err.message, "ERR");
            updateActiveDateUI();
        });
    }
}

// ==================================================================================
// PURE FLUID DYNAMICS CORE - every helper below is a deterministic pure function
// ==================================================================================

// Buoyant lift by foam type. Bigger corky = more lift; cheater sits between 12 and 10.
var FOAM_TABLE = {
    '0':   { lift: 0.00, label: 'None' },
    '14':  { lift: 0.30, label: 'Corky - Size 14 (6mm)' },
    '12':  { lift: 0.60, label: 'Corky - Size 12 (8mm)' },
    '10':  { lift: 0.90, label: 'Corky - Size 10 (10mm)' },
    'c12': { lift: 0.70, label: 'Cheater - Size 12' }
};

function parseFoam(rawValue) {
    var key = (rawValue === undefined || rawValue === null) ? '0' : String(rawValue);
    if (key === 'c12') return { key: 'c12', size: 12, lift: FOAM_TABLE.c12.lift, label: FOAM_TABLE.c12.label };
    var size = parseFloat(key);
    if (!size) return { key: '0', size: 0, lift: 0, label: 'None' };
    var entry = FOAM_TABLE[String(size)] || { lift: 0.6 };
    return { key: String(size), size: size, lift: entry.lift, label: entry.label || ('Corky - Size ' + size) };
}

// Backwards compatible with records that only stored a numeric `corky` value.
function foamLabelFromRecord(row) {
    if (!row) return '--';
    var raw = (row.foam !== undefined && row.foam !== null) ? row.foam : row.corky;
    return parseFoam(raw).label;
}

function hookLabel(hook) {
    if (hook === -1) return '2/0';
    if (hook === 0) return '1/0';
    if (hook === 2) return 'Size 2';
    if (hook === 1) return 'Size 1';
    return 'Sz ' + hook;
}

// Heavier hooks are more anchor weight, so they subtract from the net lift.
function hookSink(hook) {
    if (hook === -1) return 0.35;   // 2/0
    if (hook === 0) return 0.28;    // 1/0
    if (hook === 1) return 0.20;    // size 1
    return 0.12;                    // size 2 (and legacy size 3)
}

// Hydraulic geometry for a PNW gravel-bed river. We only know discharge (CFS), so
// estimate mean velocity, then step down to the bed with the 1/6th power law.
function hydraulicVelocity(flow) {
    var meanVelocity = 0.25 * Math.pow(Math.max(flow, 1), 0.4);      // ft/s
    var bottomVelocity = meanVelocity * Math.pow(0.05, 1 / 6);       // 1/6th power law
    return { mean: meanVelocity, bottom: bottomVelocity };
}

// Net upward lift = foam buoyancy + yarn buoyancy - hook anchor weight - bead sink.
// beadSink is subtracted because every bead has mass; denser materials sink more.
function rigLift(foamLift, yarnInches, hook, bdMat, bdSz) {
    return Math.max(0.02, foamLift + (yarnInches * 0.15) - hookSink(hook) - beadSink(bdMat, bdSz));
}

// --- COMPONENT PHYSICS: every tackle item maps to area (drag) and volume (lift/sink).
// Line diameter grows with the square root of lb test (strength ~ cross-section
// area, diameter ~ sqrt(area)), times a material factor: fluoro runs thinner than
// mono/copoly at the same lb test, braid far thinner still. So 15lb fluoro drags
// slightly MORE than 12lb mono (thicker in absolute terms), exactly as on the water.
var LINE_DIA_FACTOR = { mono: 1.0, copoly: 0.95, fluoro: 0.88, braid: 0.50 };

function lineDiameterScale(lbTest, mat) {
    var f = LINE_DIA_FACTOR[mat] || 1.0;
    return Math.sqrt(Math.max(lbTest, 1) / REF_LB_TEST) * f;
}

// Bead: a sphere. Cross-section (drag) scales with radius^2, volume (sink) with
// radius^3 times material density. Calibrated so a 4mm hard bead matches the
// legacy 0.08 drag units; an 8mm then pulls ~4x harder, as a sphere must.
// bdMat comes straight from the #bd-mat dropdown: 'hard' (plastic) or 'soft'.
// Soft (lower density) sinks less but its skirt wobbles and catches more water.
var BEAD_DENSITY = { hard: 1.0, soft: 0.55 };

function beadDrag(bdMat, bdSz) {
    if (!bdMat || bdMat === 'none' || !bdSz) return 0;
    var flexFactor = (bdMat === 'soft') ? 1.15 : 1.0;
    return 0.005 * bdSz * bdSz * flexFactor;
}

function beadSink(bdMat, bdSz) {
    if (!bdMat || bdMat === 'none' || !bdSz) return 0;
    var density = BEAD_DENSITY[bdMat] || 1.0;
    return 0.0004 * bdSz * bdSz * bdSz * density;
}

// Hook: solid wire, so mass (sink) dominates; the gap/eye adds a small point drag.
// hookSink() above already orders mass 2/0 > 1/0 > 1 > 2.
var HOOK_DRAG = { '2': 0.02, '1': 0.03, '0': 0.04, '-1': 0.05 };

function hookDrag(hook) {
    return HOOK_DRAG[String(hook)] || 0.02;
}

// Yarn skirt: mostly lift, but the fibers catch water too.
function yarnDrag(yarnInches) {
    return Math.max(0, yarnInches) * 0.02;
}

// Mainline rides upstream of the sliding weight; only a fraction of its drag
// couples through into the leader system. Braid cuts water, mono sails.
var MAINLINE_COUPLING = 0.25;

function mainlineDragPerFt(bottomVelocity, mlLb, mlMat) {
    if (!mlLb) return 0;
    var velocityScale = bottomVelocity / REF_VELOCITY;
    return DRAG_REF * velocityScale * lineDiameterScale(mlLb, mlMat || 'braid') * MAINLINE_COUPLING;
}

// Hydrodynamic drag per foot of leader. Scales with bed velocity, true line
// diameter (sqrt of lb test x material factor) and how hard the lead pins the
// leader down. Heavier lead sweeps the leader flatter, so height falls.
function leaderDragPerFt(bottomVelocity, lbTest, weightOz, dragCoeff, ldMat) {
    var velocityScale = bottomVelocity / REF_VELOCITY;
    var diameterScale = lineDiameterScale(lbTest, ldMat || 'copoly');
    var anchorScale = 0.7 + (0.6 * weightOz);   // heavier lead sweeps the leader flatter
    var drag = DRAG_REF * velocityScale * diameterScale * anchorScale * dragCoeff;
    return Math.max(0.05, drag);
}

// Total system drag in equivalent per-foot units: leader + coupled mainline +
// bead sphere + hook gap + yarn skirt. Used by runSim, the solver, and sonar
// alike so all three always agree.
function totalDragPerFt(bottomVelocity, ldLb, ldMat, mlLb, mlMat, weightOz, hook, yarnInches, bdMat, bdSz) {
    return leaderDragPerFt(bottomVelocity, ldLb, weightOz, 1.0, ldMat)
        + mainlineDragPerFt(bottomVelocity, mlLb, mlMat)
        + beadDrag(bdMat, bdSz) + hookDrag(hook) + yarnDrag(yarnInches);
}

// Catenary rise of a flexible leader: uniform downstream drag (w per ft) acting on a
// line that carries a point lift (F) at the tag end.
//   h = (F / w) * asinh(w * L / F)
// Limits check out: h -> 0 as drag dominates, h -> L as drag vanishes, and h <= L always.
function presentationHeightInches(lift, leaderFt, dragPerFt) {
    if (leaderFt <= 0 || lift <= 0 || dragPerFt <= 0) return 0;
    var x = (dragPerFt * leaderFt) / lift;
    var riseFt = (lift / dragPerFt) * Math.asinh(x);
    if (!isFinite(riseFt) || riseFt < 0) return 0;
    return Math.min(riseFt * 12, leaderFt * 12);
}

// ==================================================================================
// COMMUNITY SONAR - physics stays LOCKED at drag coefficient 1.0; community catches
// shift WHERE the fish are (the strike zone), never how water works. Each logged
// catch is run through the pure physics engine to find the line height that fish
// bit at; the average becomes the community center, blended with the weather zone.
// ==================================================================================
// --- COMMUNITY SONAR ENVIRONMENT MATCH WEIGHTING ---
// Each logged catch records the water temp / wind / moon at hookup time. When the
// current live conditions resemble a catch's conditions, that catch is a better
// predictor of where fish are RIGHT NOW, so it should pull the zone harder.
function envMatchWeight(row, rep) {
    var score = 0, dims = 0;

    // Water temperature: within 5F of today's is a strong match.
    var nowTemp = (typeof getWaterTempF === 'function') ? getWaterTempF() : null;
    var rowTemp = (row.waterTempF !== undefined && row.waterTempF !== null) ? Number(row.waterTempF) : null;
    if (nowTemp !== null && rowTemp !== null) {
        dims++;
        var diff = Math.abs(nowTemp - rowTemp);
        if (diff <= 5) { score += 1; }
        else if (diff <= 10) { score += 0.5; }
    }

    // Wind speed: within 5 mph of today's is a match.
    var nowWind = (typeof window.currentWindMph !== 'undefined' && window.currentWindMph != null) ? Number(window.currentWindMph) : null;
    var rowWind = (row.windSpeedMph !== undefined && row.windSpeedMph !== null) ? Number(row.windSpeedMph) : null;
    if (nowWind !== null && rowWind !== null) {
        dims++;
        var wdiff = Math.abs(nowWind - rowWind);
        if (wdiff <= 5) { score += 1; }
        else if (wdiff <= 10) { score += 0.5; }
    }

    // Moon phase: same phase bucket is a match (new/small waxing/first-quarter/gibbous/full...).
    var nowMoon = (rep && rep.lunar_icon) ? String(rep.lunar_icon).trim() : '';
    var rowMoon = (row.moonPhase !== undefined && row.moonPhase !== null) ? String(row.moonPhase).trim() : '';
    if (nowMoon && rowMoon) {
        dims++;
        if (nowMoon === rowMoon) { score += 1; }
        else {
            // Fuzzy: both contain a shared meaningful token (e.g. "Full", "New", "Waxing").
            var nowTokens = nowMoon.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean);
            var rowTokens = rowMoon.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean);
            var shared = nowTokens.some(function (t) { return rowTokens.indexOf(t) !== -1; });
            if (shared) score += 0.5;
        }
    }

    if (dims === 0) return 1;   // no env data on either side: don't penalise legacy rows
    return 0.25 + ((score / dims) * 0.75);   // 0.25 (poor) .. 1.0 (exact)
}

function communitySonar(dbArray, flow, species) {
    if (!dbArray || !dbArray.length) return { center: null, samples: 0, note: 'no community data yet' };
    var rep = getActiveReport();
    // Deterministic: newest catches first, so the 8-sample window is stable
    // run-to-run regardless of Supabase/localStorage return order.
    var sorted = dbArray.slice().sort(function(a, b) {
        var ta = 0, tb = 0;
        try {
            if (a && a.time) ta = new Date(a.time).getTime() || 0;
            else if (a && a.catch_time) ta = new Date(a.catch_time).getTime() || 0;
            if (b && b.time) tb = new Date(b.time).getTime() || 0;
            else if (b && b.catch_time) tb = new Date(b.catch_time).getTime() || 0;
        } catch (e) {}
        return tb - ta;
    });
    var heights = [];
    var weights = [];
    for (var i = 0; i < sorted.length && heights.length < 8; i++) {
        var row = sorted[i];
        if (!row || row.loc !== 'Fair') continue;                     // mouth-hooked fish only
        if (species && row.spc && row.spc !== species) continue;
        if (!row.flow || Math.abs(row.flow - flow) > 300) continue;    // same river stage
        if (!row.ldLen) continue;
        // Pure physics snapshot of where THIS fish was feeding: coeff locked at 1.0.
        // Full component model: line diameters, mainline coupling, bead sphere +
        // material sink, hook gap/mass, yarn skirt. Missing fields fall back to the
        // reference defaults so legacy rows still solve.
        var foam = parseFoam(row.foam !== undefined ? row.foam : row.corky);
        var bdMat = (row.bdMat !== undefined) ? row.bdMat : row.bead_material;
        var bdSzRaw = (row.bdSz !== undefined && row.bdSz !== null) ? row.bdSz : row.bead_size;
        // RPC returns hook_size as text ("2","0","-1"); hookSink uses strict
        // equality, so coerce to a number or cloud rows misread the hook.
        var hookNum = (row.hook !== undefined && row.hook !== null && row.hook !== '') ? Number(row.hook) : 2;
        if (isNaN(hookNum)) hookNum = 2;
        var lift = rigLift(foam.lift, row.yarn || 0, hookNum, bdMat, bdSzRaw);
        var bedVel = hydraulicVelocity(row.flow).bottom;
        var lb = row.ldLb || row.leader_lb || REF_LB_TEST;
        var ldMat = row.ldMat || row.leader_material || 'copoly';
        var wt = (row.weight !== undefined && row.weight !== null) ? row.weight : 0.5;
        var mlLb = row.mlLb || row.mainline_lb || 0;
        var mlMat = row.mlMat || row.mainline_mat || 'braid';
        var drag = totalDragPerFt(bedVel, lb, ldMat, mlLb, mlMat, wt, hookNum, row.yarn || 0, bdMat, bdSzRaw);
        var h = presentationHeightInches(lift, row.ldLen, drag);
        if (isFinite(h) && h > 0) {
            heights.push(h);
            weights.push(envMatchWeight(row, rep));
        }
    }
    if (heights.length < 2) return { center: null, samples: heights.length, note: 'community sample too thin to shift the zone' };
    var sum = 0, wsum = 0, matched = 0;
    for (var k = 0; k < heights.length; k++) {
        sum += heights[k] * weights[k];
        wsum += weights[k];
        if (weights[k] >= 0.75) matched++;
    }
    var center = sum / wsum;
    var matchNote = (matched >= 2)
        ? matched + ' of ' + heights.length + ' matches today\u2019s conditions'
        : heights.length + ' recent catches, few matching today\u2019s conditions';
    return { center: center, samples: heights.length, matched: matched, note: matchNote };
}

// ==================================================================================
// ENVIRONMENT - where the fish are holding today
// Today's water report shifts the 4"-12" baseline into the zone the fish are using.
// ==================================================================================
function getActiveReport() {
    if (typeof reportsData !== 'undefined' && typeof activeDateOffset !== 'undefined' &&
        activeDateOffset >= 0 && activeDateOffset < reportsData.length) {
        return reportsData[activeDateOffset];
    }
    return null;
}

function getWaterTempF() {
    if (window.waterTempF !== undefined && window.waterTempF !== null && !isNaN(window.waterTempF)) {
        return Number(window.waterTempF);
    }
    var el = document.querySelector('.water-temp');
    if (el) {
        var parsed = parseFloat(String(el.innerText).replace(/[^0-9.\-]/g, ''));
        if (!isNaN(parsed) && parsed > 25 && parsed < 90) return parsed;
    }
    return null;
}

function computeStrikeZone(sonar) {
    // sonar (optional): { center, samples } from communitySonar(). Weather sets the
    // baseline expectation; community catches act as live sonar that pulls the zone
    // toward where fish are actually feeding. Omitting sonar gives the weather-only
    // preview used by refreshZonePreview().
    var zone = { min: BASE_ZONE_MIN, max: BASE_ZONE_MAX, shift: 0, sonarShift: 0, notes: [], report: null, sonar: null };
    var rep = getActiveReport();
    if (!rep) {
        zone.notes.push('No water report loaded: using the baseline 4.0" - 12.0" strike zone.');
    } else {
    zone.report = rep;

    // Barometric trend drives the swim bladder: falling = suspend, rising = pin down.
    var pressureDelta = Number(rep.press_delta);
    if (!isNaN(pressureDelta)) {
        if (pressureDelta <= -0.03) {
            zone.shift += 3.5;
            zone.notes.push('Barometer falling ' + pressureDelta.toFixed(2) + ' inHg: bladders expand, fish ride higher.');
        } else if (pressureDelta >= 0.03) {
            zone.shift -= 3.0;
            zone.notes.push('Barometer rising ' + pressureDelta.toFixed(2) + ' inHg: fish pin down (lockjaw).');
        }
    }

    // Cloud cover = light penetration: bright sun sends them deep, overcast lifts them.
    var cloud = Number(rep.cloud_pct);
    if (!isNaN(cloud)) {
        if (cloud >= 70) {
            zone.shift += 1.5;
            zone.notes.push('Heavy cloud cover (' + cloud + '%): fish feel safe riding higher.');
        } else if (cloud <= 30) {
            zone.shift -= 1.5;
            zone.notes.push('Bright sun (' + cloud + '% cloud): fish hold deep and tight.');
        }
    }

    // Rain = colour and flow: bigger profile works, and it usually lifts the zone.
    var rain = Number(rep.rain);
    if (!isNaN(rain) && rain > 0.25) {
        zone.shift += 1.0;
        zone.notes.push('Rain freshet (' + rain.toFixed(2) + '"): coloured water, run a bigger profile.');
    }

    // Water temperature = metabolism: cold fish sulk on the bottom, warm fish rise.
    var temp = getWaterTempF();
    if (temp !== null) {
        if (temp < 46) {
            zone.shift -= 1.0;
            zone.notes.push('Cold water (' + temp.toFixed(0) + 'F): lethargic fish sit tight to the bottom.');
        } else if (temp >= 55) {
            zone.shift += 1.0;
            zone.notes.push('Warm water (' + temp.toFixed(0) + 'F): active fish, willing to rise.');
        }
    }

    } // end else (water report loaded) - sonar below runs with or without a report

    var zMin = BASE_ZONE_MIN + zone.shift;
    var zMax = BASE_ZONE_MAX + zone.shift;
    // Community sonar: pull the weather zone toward where fish are actually biting.
    // Weight grows with sample count (2 catches = 25% pull, 8+ catches = 50% pull),
    // so a single lucky catch can't yank the zone but a real pattern moves it.
    // Samples that match today's environmental conditions (water temp / wind / moon)
    // pull harder than stale ones, so the zone reacts to conditions, not just history.
    if (sonar && sonar.center !== null && sonar.center !== undefined && isFinite(sonar.center) && sonar.samples >= 2) {
        var weatherCenter = (zMin + zMax) / 2;
        var halfWidth = (zMax - zMin) / 2;
        var effective = (sonar.matched && sonar.matched >= 2) ? sonar.matched : sonar.samples;
        var pull = Math.min(0.5, 0.125 + (effective * 0.046875));  // 2->~0.22, 8->0.5
        var blended = weatherCenter + ((sonar.center - weatherCenter) * pull);
        zone.sonarShift = blended - weatherCenter;
        zMin = blended - halfWidth;
        zMax = blended + halfWidth;
        zone.sonar = sonar;
        zone.notes.push('Recent community catches holding near ' + sonar.center.toFixed(1) + '" (' +
            (sonar.matched && sonar.matched >= 2 ? sonar.matched + ' env-matched' : sonar.samples) + ' fish): zone pulled ' +
            (zone.sonarShift >= 0 ? '+' : '') + zone.sonarShift.toFixed(1) + '" toward feeding fish. ' +
            sonar.note);
    }
    if (zMin < 1.0) zMin = 1.0;
    if (zMax > 24.0) zMax = 24.0;
    if (zMax - zMin < 4.0) zMax = zMin + 4.0;
    zone.min = zMin;
    zone.max = zMax;
    zone.notes.unshift('Strike zone shifted ' + (zone.shift >= 0 ? '+' : '') + zone.shift.toFixed(1) +
        '" to ' + zMin.toFixed(1) + '" - ' + zMax.toFixed(1) + '".');
    return zone;
}

// Keeps the HUD strike-zone label live: fires on date switches and when the water
// report lands, so the zone is correct before the angler presses RUN SIMULATION.
function refreshZonePreview() {
    var label = document.getElementById('target-hgt');
    if (!label) return;
    var zone = computeStrikeZone();
    label.innerText = 'Zone: ' + zone.min.toFixed(1) + '" - ' + zone.max.toFixed(1) + '"';
}

// ==================================================================================
// GEAR SOLVER - deterministic sweep of the tackle box for the rig that lands closest
// to the middle of today's zone. Ties favour the rig the angler already has tied on.
// ==================================================================================
var WEIGHT_OPTIONS = [0.25, 0.375, 0.5, 0.625, 0.75, 1];
var LEADER_LENGTH_OPTIONS = [6, 7, 8, 9, 10, 11, 12];
var FOAM_KEYS = ['0', '14', '12', 'c12', '10'];

function bestZoneRig(zone, bottomVelocity, lbTest, ldMat, mlLb, mlMat, foamKey, weightOz, leaderFt, yarnInches, hook, bdMat, bdSz) {
    // Physics is locked: drag coefficient is always 1.0. Full component model,
    // same as runSim: bead/hook/yarn/line materials all count.
    var target = (zone.min + zone.max) / 2;
    var best = null;
    for (var f = 0; f < FOAM_KEYS.length; f++) {
        var foam = parseFoam(FOAM_KEYS[f]);
        var lift = rigLift(foam.lift, yarnInches, hook, bdMat, bdSz);
        for (var w = 0; w < WEIGHT_OPTIONS.length; w++) {
            var wt = WEIGHT_OPTIONS[w];
            var drag = totalDragPerFt(bottomVelocity, lbTest, ldMat, mlLb, mlMat, wt, hook, yarnInches, bdMat, bdSz);
            for (var l = 0; l < LEADER_LENGTH_OPTIONS.length; l++) {
                var len = LEADER_LENGTH_OPTIONS[l];
                var h = presentationHeightInches(lift, len, drag);
                var cost = Math.abs(h - target);
                if (wt !== weightOz) cost += 0.06;      // prefer minimal change to the current rig
                if (len !== leaderFt) cost += 0.06;
                if (FOAM_KEYS[f] !== foamKey) cost += 0.03;
                if (!best || cost < best.cost) {
                    best = { cost: cost, foam: foam, weight: wt, leader: len, hgt: h };
                }
            }
        }
    }
    return best;
}

    // Catch Log renderer — merged single list with a "yours / everyone" toggle.
// The ONE list shows either the signed-in angler's private rows (with Edit/Delete)
// or the public board (Name / Time / Flow / Fish). The active scope is tracked in
// CATCH_SCOPE so sign-in/sign-out and new logs re-render the right side.
var CATCH_SCOPE = 'everyone';   // 'yours' | 'everyone' (default = the public board)

function setCatchScope(scope) {
    CATCH_SCOPE = (scope === 'everyone') ? 'everyone' : 'yours';
    var yoursBtn = document.getElementById('scope-yours');
    var everyoneBtn = document.getElementById('scope-everyone');
    var note = document.getElementById('catch-scope-note');
    if (yoursBtn) yoursBtn.classList.toggle('scope-active', CATCH_SCOPE === 'yours');
    if (everyoneBtn) everyoneBtn.classList.toggle('scope-active', CATCH_SCOPE === 'everyone');
    if (note) {
        note.textContent = (CATCH_SCOPE === 'yours')
            ? 'Your private catch log — only you can see it. Edit or delete from here.'
            : 'Public feed — name, time, river and fish only. Gear profiles and GPS stay private.';
    }
    // Swap the table headers to match the active scope, then render.
    var head = document.getElementById('catch-log-head');
    if (head) {
        head.innerHTML = (CATCH_SCOPE === 'yours')
            ? '<tr><th>Species</th><th>Time</th><th>Flow</th><th>Score</th><th></th></tr>'
            : '<tr><th>Name</th><th>Time</th><th>River</th><th>Fish</th></tr>';
    }
    if (CATCH_SCOPE === 'yours') {
        if (typeof renderMyCatches === 'function') renderMyCatches();
    } else {
        loadDatabase();
    }
}

// Public board renderer (the "everyone" scope of the merged list): only
// Name / Time / Flow / Fish. Reads the Supabase view first and falls back to
// the local buffer when offline or unconfigured.
async function loadDatabase() {
    var tbody = document.getElementById('catch-log-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    var rows = [];
    var fromCloud = false;
    if (typeof Supa !== 'undefined') {
        try {
            rows = await Supa.fetchPublicFeed(100);
            fromCloud = rows.length > 0;
        } catch (e) { rows = []; }
    }

    if (!fromCloud) {
        var local = [];
        try {
            var jStr = localStorage.getItem('catch_db');
            local = jStr ? JSON.parse(jStr) : [];
        } catch (e) { local = []; }
        rows = local.slice().reverse();
        logDebug('Brag board falling back to ' + rows.length + ' buffered row(s)', 'DB');
    }

    var rendered = 0;
    for (var i = 0; i < rows.length; i++) {
        var r = normalizeFeedRow(rows[i]);
        if (!r) continue;
        var tr = document.createElement('tr');
        var tdName = document.createElement('td');
        tdName.textContent = (r.name !== undefined && r.name !== null && r.name !== '') ? String(r.name) : '--';
        var tdTime = document.createElement('td');
        tdTime.textContent = formatCatchTime(r.time);
        var tdRiver = document.createElement('td');
        tdRiver.textContent = (r.river !== undefined && r.river !== null && r.river !== '') ? String(r.river) : '--';
        var tdSpc = document.createElement('td');
        tdSpc.textContent = (r.spc !== undefined && r.spc !== null && r.spc !== '') ? String(r.spc) : '--';
        tr.appendChild(tdName);
        tr.appendChild(tdTime);
        tr.appendChild(tdRiver);
        tr.appendChild(tdSpc);
        tbody.appendChild(tr);
        rendered++;
    }

    if (rendered === 0) {
        var empty = document.createElement('tr');
        empty.innerHTML = '<td colspan="4" class="empty-state">' +
            '<div class="empty-state-icon">\ud83c\udfa3</div>' +
            '<div class="empty-state-title">No catches on the board yet</div>' +
            '<div class="empty-state-hint">' + (fromCloud
                ? 'Be the first to post — log a catch from the form above and it lands here.'
                : 'You are offline or signed out, so this shows your local log only. Sign in to sync to the public board.') +
            '</div>' +
            '</td>';
        tbody.appendChild(empty);
    }

    if (typeof refreshZonePreview === 'function') refreshZonePreview();
    logDebug('Catch log (everyone): ' + rendered + ' row(s) ' + (fromCloud ? 'from Supabase' : 'from local buffer'), 'DB');
}

// --- YOUR CATCHES (private log: list, edit, delete) — the "yours" scope ---
var _myCatches = [];

async function renderMyCatches() {
    var tbody = document.getElementById('catch-log-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Show an empty/disabled state until a session exists.
    var signedIn = AuthState && AuthState.signedIn;
    if (!signedIn || typeof Supa === 'undefined') {
        var signInEmpty = document.createElement('tr');
        signInEmpty.innerHTML = '<td colspan="5" class="empty-state">' +
            '<div class="empty-state-title">Join the board to see your catches</div>' +
            '<div class="empty-state-hint">Enter your name below and tap JOIN THE BOARD, then log your first catch.</div></td>';
        tbody.appendChild(signInEmpty);
        return;
    }

    var rows = null;
    try { rows = await Supa.fetchMyCatches(); } catch (e) { rows = []; }
    _myCatches = rows || [];

    if (!_myCatches.length) {
        var empty = document.createElement('tr');
        empty.innerHTML = '<td colspan="5" class="empty-state">' +
            '<div class="empty-state-title">No logged catches yet</div>' +
            '<div class="empty-state-hint">Fill in the form above and tap LOG CATCH DATA — no Gear Sim needed.</div></td>';
        tbody.appendChild(empty);
        return;
    }

    for (var i = 0; i < _myCatches.length; i++) {
        var c = _myCatches[i];
        var tr = document.createElement('tr');

        var tdSpc = document.createElement('td');
        tdSpc.textContent = c.species || '--';
        var tdTime = document.createElement('td');
        tdTime.textContent = formatCatchTime(c.catch_time);
        var tdFlow = document.createElement('td');
        tdFlow.textContent = (c.flow != null) ? c.flow : '--';
        var tdScore = document.createElement('td');
        tdScore.textContent = (c.sim_score != null) ? Number(c.sim_score).toFixed(1) : '--';
        tr.appendChild(tdSpc);
        tr.appendChild(tdTime);
        tr.appendChild(tdFlow);
        tr.appendChild(tdScore);

        var tdAct = document.createElement('td');
        var editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'mini-btn';
        editBtn.textContent = 'Edit';
        editBtn.onclick = (function (row) { return function () { editMyCatch(row); }; })(c);
        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'mini-btn mini-btn-danger';
        delBtn.textContent = 'Delete';
        delBtn.onclick = (function (id) { return function () { deleteMyCatch(id); }; })(c.id);
        tdAct.appendChild(editBtn);
        tdAct.appendChild(delBtn);
        tr.appendChild(tdAct);

        tbody.appendChild(tr);
    }
}

// Inline edit: prompt for the most useful private fields and update the row.
async function editMyCatch(row) {
    var species = prompt('Species', row.species || '');
    if (species == null) return;
    var flow = prompt('River flow (CFS)', row.flow != null ? String(row.flow) : '');
    if (flow == null) return;
    var patch = { species: species.trim() || row.species, flow: parseInt(flow, 10) || row.flow };
    var res = null;
    try { res = await Supa.updateMyCatch(row.id, patch); } catch (e) { res = null; }
    if (res && res.ok) {
        showToast('Catch updated', 'success', 2500);
        renderMyCatches();
    } else {
        showToast('Could not update: ' + ((res && res.error) || 'unknown error'), 'error', 5000);
    }
}

async function deleteMyCatch(id) {
    if (!window.confirm('Delete this catch? This cannot be undone.')) return;
    var res = null;
    try { res = await Supa.deleteMyCatch(id); } catch (e) { res = null; }
    if (res && res.ok) {
        showToast('Catch deleted', 'success', 2500);
        renderMyCatches();
        loadDatabase();   // the public board may have shrunk
    } else {
        showToast('Could not delete: ' + ((res && res.error) || 'unknown error'), 'error', 5000);
    }
}

// --- RIG PRESET PERSISTENCE ---
var RIG_STORE_KEY = 'puyallup_last_rig';

function saveRig() {
    try {
        var rig = {
            flow: getNum('flow'),
            distance: getNum('distance'),
            rodFt: getNum('rod-ft'),
            rodIn: getNum('rod-in'),
            mlMat: getStr('ml-mat'),
            mlLb: getStr('ml-lb'),
            ldLen: getStr('ld-len'),
            ldMat: getStr('ld-mat'),
            ldLb: getStr('ld-lb'),
            weight: getStr('weight'),
            hook: getStr('hook'),
            yarn: getStr('yarn'),
            foam: getStr('foam'),
            bdMat: getStr('bd-mat'),
            bdSz: getStr('bd-sz')
        };
        localStorage.setItem(RIG_STORE_KEY, JSON.stringify(rig));
    } catch (e) {}
}

function restoreRig() {
    var raw = null;
    try { raw = localStorage.getItem(RIG_STORE_KEY); } catch (e) { return; }
    if (!raw) return;
    var rig = null;
    try { rig = JSON.parse(raw); } catch (e) { return; }
    if (!rig) return;

    function set(id, val) {
        var el = document.getElementById(id);
        if (el && val !== undefined && val !== null && val !== '') el.value = String(val);
    }
    set('flow', rig.flow); set('distance', rig.distance);
    set('rod-ft', rig.rodFt); set('rod-in', rig.rodIn);
    set('ml-mat', rig.mlMat); set('ml-lb', rig.mlLb);
    set('ld-len', rig.ldLen); set('ld-mat', rig.ldMat); set('ld-lb', rig.ldLb);
    set('weight', rig.weight); set('hook', rig.hook); set('yarn', rig.yarn);
    set('foam', rig.foam); set('bd-mat', rig.bdMat); set('bd-sz', rig.bdSz);
    // Mirror to the Catch Log duplicated controls.
    set('flow-log', rig.flow); set('distance-log', rig.distance);
    set('rod-ft-log', rig.rodFt); set('rod-in-log', rig.rodIn);
    set('ml-mat-log', rig.mlMat); set('ml-lb-log', rig.mlLb);
    set('ld-len-log', rig.ldLen); set('ld-mat-log', rig.ldMat); set('ld-lb-log', rig.ldLb);
    set('weight-log', rig.weight); set('hook-log', rig.hook); set('yarn-log', rig.yarn);
    set('foam-log', rig.foam); set('bd-mat-log', rig.bdMat); set('bd-sz-log', rig.bdSz);
}

async function runSim() {
    var simBtn = document.getElementById('btn-sim');
    if (simBtn) { simBtn.innerText = 'CALCULATING...'; simBtn.disabled = true; }

    // 1. Read the rig off the form -------------------------------------------------
    var flow = getNum('flow');
    var dist = getNum('distance');
    var weightOz = getNum('weight');
    var rodFt = getRodLengthFt();
    var ldLen = getNum('ld-len');
    var ldMat = getStr('ld-mat');
    var ldLb = getNum('ld-lb') || REF_LB_TEST;
    var mlMat = getStr('ml-mat');
    var mlLb = getNum('ml-lb');
    var hookRaw = parseFloat(getStr('hook'));
    var hook = isNaN(hookRaw) ? 2 : hookRaw;        // 0 = 1/0, -1 = 2/0
    var yarn = getNum('yarn');
    var foam = parseFoam(getStr('foam'));
    var bdMat = getStr('bd-mat');
    var bdSz = getNum('bd-sz');
    var species = getStr('species');

    // Community sonar: anonymised full tackle telemetry from every angler who has
    // logged a catch at this flow and species. Physics stays locked - this data only
    // moves the strike zone toward where fish are actually feeding. Falls back to
    // the local buffer offline.
    var dbArray = [];
    if (typeof Supa !== 'undefined') {
        try { dbArray = await Supa.fetchGlobalCalibration(flow, species); } catch (e) { dbArray = []; }
    }
    if (!dbArray.length) {
        try {
            var jStr = localStorage.getItem('catch_db');
            dbArray = jStr ? JSON.parse(jStr) : [];
        } catch (e) { dbArray = []; }
    }

    // 2. Fluid dynamics (LOCKED: drag coefficient is always 1.0) -----------------------
    // Every component counts: leader diameter (sqrt lb x material), coupled
    // mainline, bead sphere + material sink, hook mass/gap, yarn skirt.
    var velocity = hydraulicVelocity(flow);
    var dragPerFt = totalDragPerFt(velocity.bottom, ldLb, ldMat, mlLb, mlMat, weightOz, hook, yarn, bdMat, bdSz);
    var lift = rigLift(foam.lift, yarn, hook, bdMat, bdSz);
    var hgt = presentationHeightInches(lift, ldLen, dragPerFt);
    var blownOut = (velocity.bottom > 3.5 && weightOz < 0.5);

    // 3. Where the fish are today, then score the presentation ------------------------
    var sonar = communitySonar(dbArray, flow, species);
    var zone = computeStrikeZone(sonar);
    var score = 5.0;
    if (blownOut) {
        score = 0.0;
    } else {
        if (hgt < zone.min) score -= Math.min(3.0, (zone.min - hgt) * 0.45);
        if (hgt > zone.max) score -= Math.min(3.0, (hgt - zone.max) * 0.45);
    }
    if (score < 0) score = 0;
    if (score > 5) score = 5;
    var roundedScore = Math.round(score);

    // 4. Build the suggestions: what to change to get into the zone -------------------
    // Rig Adjustments only: your current state + the exact gear to tie on. No
    // calibration meta-talk - the community data already moved the zone above.
    var suggestions = [];
    var best = bestZoneRig(zone, velocity.bottom, ldLb, ldMat, mlLb, mlMat, foam.key, weightOz, ldLen, yarn, hook, bdMat, bdSz);

    if (blownOut) {
        suggestions.push('BLOWN OUT: the bed is running ' + velocity.bottom.toFixed(1) + ' ft/s with only ' + weightOz + ' oz of lead. Step up to 3/4 oz or 1 oz, or fish a slower seam.');
    } else if (hgt < zone.min) {
        var lowWhy = (sonar && sonar.center !== null && sonar.center > (zone.min + zone.max) / 2)
            ? 'Weather and recent catches show fish holding higher in the column'
            : 'Fish are holding off the bottom';
        suggestions.push('Presentation pinned at ' + hgt.toFixed(1) + '" (zone ' + zone.min.toFixed(1) + '" - ' + zone.max.toFixed(1) + '"). ' + lowWhy + '. Add buoyancy: bigger Corky, more yarn, or a longer leader.');
    } else if (hgt > zone.max) {
        var highWhy = (sonar && sonar.center !== null && sonar.center < (zone.min + zone.max) / 2)
            ? 'Weather and recent catches show fish pinned tight to the bottom'
            : 'Fish are holding tight to the bottom';
        suggestions.push('Floating over fish at ' + hgt.toFixed(1) + '" (zone ' + zone.min.toFixed(1) + '" - ' + zone.max.toFixed(1) + '"). ' + highWhy + '. Cut lift: smaller Corky, less yarn, heavier lead, or a shorter leader.');
    } else {
        suggestions.push('On target: ' + hgt.toFixed(1) + '" sits inside today\'s ' + zone.min.toFixed(1) + '" - ' + zone.max.toFixed(1) + '" strike zone.');
    }

    if (best && !blownOut && score < 5.0) {
        suggestions.push('Try this: ' + best.foam.label + ' + ' + best.leader + ' ft leader + ' + best.weight + ' oz lead -> projects ' + best.hgt.toFixed(1) + '" of line height.');
    }
    if (species && species !== 'None') {
        suggestions.push('Targeting ' + species + ' at ' + flow + ' CFS on a ' + formatRodLength(rodFt) + ' rod with a ' + ldMat + ' ' + ldLb + 'lb leader.');
    }
// 5. Paint the HUD ---------------------------------------------------------------
    currentStats = {
        flow: flow,
        distance: dist,
        rodFt: rodFt,
        weight: weightOz,
        ldLen: ldLen,
        ldMat: ldMat,
        ldLb: ldLb,
        mlMat: mlMat,
        mlLb: mlLb,
        hook: hook,
        yarn: yarn,
        foam: foam.key,
        bdMat: bdMat,
        bdSz: bdSz,
        hgt: hgt,
        zoneMin: zone.min,
        zoneMax: zone.max,
        score: score,
        bottomVelocity: velocity.bottom,
        meanVelocity: velocity.mean,
        dragCoeff: 1.0,
        blownOut: blownOut
    };
    saveRig();

    var color = 'var(--accent-green)';
    if (score < 4.0) color = 'var(--accent-yellow)';
    if (score < 2.5) color = 'var(--accent-red)';

    var eHgt = document.getElementById('hud-hgt');
    eHgt.innerText = hgt.toFixed(1) + '"';
    eHgt.style.color = color;

    var eVel = document.getElementById('hud-vel');
    eVel.innerText = velocity.bottom.toFixed(1);
    eVel.style.color = blownOut ? 'var(--accent-red)' : color;

    document.getElementById('target-hgt').innerText = 'Zone: ' + zone.min.toFixed(1) + '" - ' + zone.max.toFixed(1) + '"';
    document.getElementById('vel-target').innerText = blownOut ? 'BLOWN OUT' : 'Target: < 3.5 ft/s';

    var stars = '';
    for (var s = 0; s < 5; s++) stars += (s < roundedScore) ? '★' : '☆';
    document.getElementById('stars').innerText = stars;

    var msg = blownOut ? 'BLOWN OUT - no presentation control'
        : ((hgt >= zone.min && hgt <= zone.max) ? 'Inside the strike zone' : 'Outside the strike zone');
    document.getElementById('hud-msg').innerText = msg + '  •  Score ' + score.toFixed(1) + ' / 5.0';

    var sBar = document.getElementById('score-bar');
    sBar.style.backgroundColor = color;
    sBar.style.width = Math.max(6, (score / 5) * 90) + '%';

    // Logging is decoupled from the Gear Sim — the catch-log button keeps its
    // own label/state (set by applyAuthState) and is never gated on the sim.

    var sugBox = document.getElementById('suggestions');
    sugBox.style.display = 'block';
    sugBox.innerHTML = '<span class="sug-head">Rig Adjustments</span>- ' + suggestions.join('<br>- ') +
        '<div class="sug-cond">' + zone.notes.join('<br>') + '</div>';

    if (simBtn) { simBtn.innerText = 'RUN SIMULATION'; simBtn.disabled = false; }
    logDebug('Sim: height ' + hgt.toFixed(2) + '", bed velocity ' + velocity.bottom.toFixed(2) +
        ' ft/s, zone ' + zone.min.toFixed(1) + '-' + zone.max.toFixed(1) + '", score ' + score.toFixed(2), 'SIM');
}

// Derive a coarse river name from the active station (e.g. "Puyallup River",
// "Carbon River", "Green River", "Nisqually River", "White River"). Falls back
// to '--'. Never exposes exact coordinates on the public board.
function deriveRiverName() {
    try {
        var active = JSON.parse(localStorage.getItem('active_station') || 'null');
        var nm = (active && active.name) ? String(active.name) : '';
        var m = nm.match(/([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(?:River|Creek|Ck)/i);
        if (m) return m[1].replace(/\s+/g, ' ').trim() + ' River';
        // Fall back to a known station-id map.
        if (active && active.id) {
            if (active.id === '12101500') return 'Puyallup River';
            if (active.id === '12093500') return 'White River';
            if (active.id === '12094000') return 'Carbon River';
            if (active.id === '12113000') return 'Green River';
            if (active.id === '12089500') return 'Nisqually River';
        }
    } catch (e) {}
    return '--';
}

    // Offline-first write: buffer the catch locally, then push the full private profile
// (complete tackle + GPS) to Supabase. The public view only ever exposes 4 columns.
async function logData() {
    if (!AuthState.signedIn) {
        switchTab('tab-catch-log');
        var nameField = document.getElementById('auth-name');
        if (nameField) nameField.focus();
        showToast('Join the board first: enter your name and tap JOIN THE BOARD.', 'warn', 5000);
        return;
    }
    var foamRaw = getStr('foam');
    var activeRep = getActiveReport();
    // Decoupled from the Gear Sim: logging works straight from the form. When a
    // sim HAS been run we still carry its solved geometry (hook/height/zone) so
    // logs keep the rich private columns, but nothing here requires runSim().
    var simFlow = (currentStats && currentStats.flow != null) ? currentStats.flow : null;
    var liveFlow = getNum('flow') || (activeRep && activeRep.cfs != null ? activeRep.cfs : 0);
    var flowValue = (simFlow != null) ? simFlow : (liveFlow || 1040);
    var hookValue = (currentStats && currentStats.hook != null) ? currentStats.hook : (parseFloat(getStr('hook')) || 2);
    var payload = {
        name: AuthState.name || 'Anonymous',
        time: getStr('log-datetime'),
        gps: (window.userGPSCoords && window.userGPSCoords.lat != null && window.userGPSCoords.lon != null)
            ? window.userGPSCoords.lat + ',' + window.userGPSCoords.lon
            : null,
        river: deriveRiverName(),
        flow: flowValue,
        spc: getStr('species'),
        ldLen: getNum('ld-len'),
        ldMat: getStr('ld-mat'),
        ldLb: getNum('ld-lb'),
        mlMat: getStr('ml-mat'),
        mlLb: getNum('ml-lb'),
        weight: getNum('weight'),
        rodFt: getRodLengthFt(),
        dist: getNum('distance'),
        hook: hookValue,
        yarn: getNum('yarn'),
        foam: foamRaw,
        bdMat: getStr('bd-mat'),
        bdSz: getNum('bd-sz'),
        // Environmental context captured at log time (private row enrichment).
        // Falls back to null when the report/telemetry is unavailable.
        gauge: (activeRep && activeRep.gage != null) ? activeRep.gage : null,
        barometer: (activeRep && activeRep.pressure != null) ? activeRep.pressure : null,
        waterTemp: getWaterTempF(),
        windSpeed: (typeof window.currentWindMph !== 'undefined' && window.currentWindMph != null) ? window.currentWindMph : null,
        windDir: (typeof window.currentWindDir !== 'undefined' && window.currentWindDir != null) ? window.currentWindDir : null,
        moon: (activeRep && activeRep.lunar_icon != null) ? activeRep.lunar_icon : null,
        hgt: (currentStats && currentStats.hgt != null) ? Number(currentStats.hgt.toFixed(2)) : null,
        zoneMin: (currentStats && currentStats.zoneMin != null) ? Number(currentStats.zoneMin.toFixed(2)) : null,
        zoneMax: (currentStats && currentStats.zoneMax != null) ? Number(currentStats.zoneMax.toFixed(2)) : null,
        score: (currentStats && currentStats.score != null) ? Number(currentStats.score.toFixed(2)) : null
    };

    // 1. Offline buffer first, so a logged catch is never lost.
    var db = [];
    try {
        var jStr = localStorage.getItem('catch_db');
        db = jStr ? JSON.parse(jStr) : [];
    } catch (e) { db = []; }
    var idx = db.push(payload) - 1;
    try { localStorage.setItem('catch_db', JSON.stringify(db)); } catch (e) {}
    logDebug('Catch buffered locally', 'DB');

    // 2. Async push of the private record to Supabase.
    var res = null;
    if (typeof Supa !== 'undefined') {
        try { res = await Supa.insertCatch(payload); } catch (e) { res = null; }
    }
    if (res && res.ok) {
        db[idx].syncedAt = new Date().toISOString();
        try { localStorage.setItem('catch_db', JSON.stringify(db)); } catch (e) {}
        logDebug('Catch synced to Supabase', 'SYNC');
    } else {
        db[idx].pendingSync = true;
        try { localStorage.setItem('catch_db', JSON.stringify(db)); } catch (e) {}
        logDebug('Queued for retry: ' + ((res && res.error) || 'offline'), 'SYNC');
    }

    document.getElementById('btn-log').innerText = 'LOG CATCH DATA';
    document.getElementById('btn-log').className = 'btn-main';
    currentStats = null;
    if (typeof setCatchScope === 'function') setCatchScope(CATCH_SCOPE);
    switchTab('tab-catch-log');
}

// --- STATION SELECTOR MODAL & GPS FUNCTIONS ---
function openStationModal() {
    document.getElementById('station-modal').style.display = 'block';
    document.getElementById('gps-status').innerText = '';
    document.getElementById('search-results').style.display = 'none';
    document.getElementById('station-search').value = '';
}

function closeStationModal() {
    document.getElementById('station-modal').style.display = 'none';
}

function selectPreset(id, lat, lon, name, isGps) {
    activeDateOffset = 0;
    var station = { id: id, lat: lat, lon: lon, name: name, isGps: !!isGps };
    localStorage.setItem('active_station', JSON.stringify(station));
    logDebug("Selected Station: " + name + " (" + id + ")", "STATE");
    closeStationModal();
    loadWaterReport();
}

// Haversine distance in miles
function calcDistance(lat1, lon1, lat2, lon2) {
    var R = 3958.8; // Radius of Earth in miles
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function fallbackStation() {
    selectPreset('12101500', 47.1950, -122.3020, 'Puyallup River at Puyallup, WA', false);
}

function useGPS() {
    var status = document.getElementById('gps-status');
    status.innerText = "Waiting for GPS (grant the location prompt)...";
    if (!navigator.geolocation) {
        status.innerText = "Geolocation not supported. Falling back.";
        setTimeout(fallbackStation, 1500);
        return;
    }
    var settled = false;
    var watchdog = setTimeout(function () {
        if (settled) return;
        settled = true;
        status.innerText = "GPS took too long. Falling back.";
        logDebug("GPS location timed out - falling back to default station", "ERR");
        fallbackStation();
    }, 15000);
    navigator.geolocation.getCurrentPosition(async function(pos) {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        var lat = pos.coords.latitude;
        var lon = pos.coords.longitude;
        status.innerText = "Captured position. Searching nearby USGS gauges...";
        var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var fetchTimer = setTimeout(function () { if (controller) controller.abort(); }, 10000);
        try {
            // Same-origin server-side USGS lookup (reliable on mobile). Retry once
            // if the first response is empty (a cold Cloudflare tunnel connection can
            // return an aborted body on the very first request).
            var timeSeries = null;
            for (var attempt = 0; attempt < 2; attempt++) {
                var response = await fetch('/api/nearby_stations?lat=' + lat + '&lon=' + lon, { cache: "no-store", signal: controller ? controller.signal : undefined });
                var data = await response.json();
                timeSeries = (data && data.stations) ? data.stations : [];
                if (timeSeries && timeSeries.length > 0) break;
                if (attempt === 0) await new Promise(function (r) { setTimeout(r, 700); });
            }
            if (!timeSeries || timeSeries.length === 0) {
                status.innerText = "No USGS stations found in range. Falling back.";
                setTimeout(fallbackStation, 2000);
                return;
            }
            var stationsMap = {};
            timeSeries.forEach(function(ts) {
                var sCode = ts.id;
                var sName = ts.name;
                var sLat = ts.lat;
                var sLon = ts.lon;
                var sDist = ts.distance_mi;
                if (!stationsMap[sCode]) {
                    stationsMap[sCode] = {
                        id: sCode,
                        name: sName,
                        lat: sLat,
                        lon: sLon,
                        distance: (sDist !== undefined && sDist != null) ? sDist : calcDistance(lat, lon, sLat, sLon)
                    };
                }
            });
            var stationsList = Object.values(stationsMap);
            stationsList.sort(function(a, b) { return a.distance - b.distance; });
            if (stationsList.length > 0) {
                var closest = stationsList[0];
                status.innerText = "Found: " + closest.name + " (" + closest.distance.toFixed(1) + " mi)";
                setTimeout(function() { selectPreset(closest.id, closest.lat, closest.lon, closest.name, true); }, 1500);
            } else {
                status.innerText = "No active gauge stations in range. Falling back.";
                setTimeout(fallbackStation, 2000);
            }
        } catch(e) {
            status.innerText = "USGS search failed. Falling back.";
            logDebug("USGS GPS box error: " + e.message, "ERR");
            setTimeout(fallbackStation, 2000);
        } finally {
            clearTimeout(fetchTimer);
        }
    }, function(err) {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        status.innerText = (err && err.code === 3) ? "GPS timed out. Falling back." : "GPS Access Denied. Falling back.";
        logDebug("Geolocation error: " + (err ? err.message : "unknown"), "ERR");
        setTimeout(fallbackStation, 1500);
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
}

async function searchStation() {
    var term = document.getElementById('station-search').value.trim();
    var resultsBox = document.getElementById('search-results');
    
    if (!term) return;
    resultsBox.style.display = 'block';
    resultsBox.innerHTML = '<div style="color:var(--accent-yellow); font-weight:bold; padding:8px;">Searching...</div>';
    
    // If exact 8 digit gauge ID
    if (term.match(/^\d{8}$/)) {
        resultsBox.innerHTML = '<div style="color:var(--accent-yellow); font-weight:bold; padding:8px;">Fetching metadata...</div>';
        var url = 'https://waterservices.usgs.gov/nwis/iv/?format=json&sites=' + term + '&parameterCd=00060,00065&siteStatus=all';
        try {
            var response = await fetch(url);
            var data = await response.json();
            var timeSeries = data.value.timeSeries;
            if (timeSeries && timeSeries.length > 0) {
                var info = timeSeries[0].sourceInfo;
                var name = info.siteName;
                var sLoc = info.geoLocation.geogLocation;
                var lat = sLoc.latitude;
                var lon = sLoc.longitude;
                
                resultsBox.innerHTML = '<button class="preset-btn" onclick="selectPreset(\''+term+'\', '+lat+', '+lon+', \''+name.replace(/'/g, "\\'")+'\')" style="margin:5px 0;">' +
                    '<span>'+name+'</span> <span class="preset-id">'+term+'</span></button>';
            } else {
                resultsBox.innerHTML = '<div style="color:var(--accent-red); font-weight:bold; padding:8px;">❌ USGS Station ID not found or inactive.</div>';
            }
        } catch(e) {
            resultsBox.innerHTML = '<div style="color:var(--accent-red); font-weight:bold; padding:8px;">❌ Search Error.</div>';
            logDebug("USGS Search error: " + e.message, "ERR");
        }
        return;
    }

    // Search by river name in Washington State (stateCd=wa)
    resultsBox.innerHTML = '<div style="color:var(--accent-yellow); font-weight:bold; padding:8px;">Searching Washington rivers...</div>';
    var url = 'https://waterservices.usgs.gov/nwis/iv/?format=json&stateCd=wa&parameterCd=00060,00065&siteStatus=all';
    try {
        var response = await fetch(url);
        var data = await response.json();
        var timeSeries = data.value.timeSeries;
        if (!timeSeries || timeSeries.length === 0) {
            resultsBox.innerHTML = '<div style="color:var(--accent-red); font-weight:bold; padding:8px;">❌ No active stations found.</div>';
            return;
        }
        
        var stationsMap = {};
        var searchTermLower = term.toLowerCase();
        timeSeries.forEach(function(ts) {
            var sCode = ts.sourceInfo.siteCode[0].value;
            var sName = ts.sourceInfo.siteName;
            var sLoc = ts.sourceInfo.geoLocation.geogLocation;
            var sLat = sLoc.latitude;
            var sLon = sLoc.longitude;
            
            if (sName.toLowerCase().indexOf(searchTermLower) !== -1) {
                stationsMap[sCode] = {
                    id: sCode,
                    name: sName,
                    lat: sLat,
                    lon: sLon
                };
            }
        });
        
        var results = Object.values(stationsMap);
        if (results.length === 0) {
            resultsBox.innerHTML = '<div style="color:var(--accent-red); font-weight:bold; padding:8px;">❌ No matching active stations found.</div>';
        } else {
            resultsBox.innerHTML = '<div style="color:var(--text-muted); font-size:10px; padding:4px;">Showing top ' + Math.min(10, results.length) + ' matches:</div>';
            // Show up to 10 results
            results.slice(0, 10).forEach(function(s) {
                var safeName = s.name.replace(/'/g, "\\'");
                resultsBox.innerHTML += '<button class="preset-btn" onclick="selectPreset(\''+s.id+'\', '+s.lat+', '+s.lon+', \''+safeName+'\')" style="margin:5px 0;">' +
                    '<span>'+s.name+'</span> <span class="preset-id">'+s.id+'</span></button>';
            });
        }
    } catch(e) {
        resultsBox.innerHTML = '<div style="color:var(--accent-red); font-weight:bold; padding:8px;">❌ Search Error.</div>';
        logDebug("USGS search error: " + e.message, "ERR");
    }
}

// --- GEAR SIM INPUT DEBOUNCING ---
// The numeric gear inputs feed the deterministic physics engine. Recomputing on
// every keystroke would run the solver for each partial value ("1", "10", "104",
// "1040"), so the live zone preview is debounced to a single trailing pass.
// Selects and the rod boxes keep their existing synchronous onchange sync.
function initGearSimInputDebounce() {
    var ids = ['flow', 'distance', 'rod-ft', 'rod-in'];
    var debounced = debounce(function () {
        if (typeof refreshZonePreview === 'function') refreshZonePreview();
    }, 250);

    ids.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('input', debounced);
    });
    logDebug('Gear Sim inputs debounced (' + ids.length + ' fields, 250ms trailing)', 'UI');
}

// --- AUTO-REFRESH ---
// A homescreen PWA has no pull-to-refresh, so the live telemetry is re-fetched
// on its own: every 5 minutes while visible+online, the moment the app comes
// back to the foreground, and when connectivity returns. All three routes call
// loadWaterReport(true) — a "silent" refresh that updates the whole report +
// hero but never overwrites a Gear Sim CFS the angler typed by hand.
var AUTO_REFRESH_MS = 5 * 60 * 1000;
var autoRefreshTimer = null;

function silenceableRefresh() {
    if (document.visibilityState === 'visible' && navigator.onLine !== false) {
        loadWaterReport(true);
    }
}

function startAutoRefresh() {
    if (autoRefreshTimer) return;
    // Periodic: keep the data fresh while the app sits open.
    autoRefreshTimer = setInterval(silenceableRefresh, AUTO_REFRESH_MS);
    // Foregrounding: the classic "I picked up my phone" moment.
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') silenceableRefresh();
    });
    logDebug('Auto-refresh armed (every ' + (AUTO_REFRESH_MS / 60000) + ' min + on foreground)', 'PWA');
}

// Manual refresh affordance (header ⟳) for a standalone PWA.
function refreshNow() {
    loadWaterReport(true);
    showToast('Refreshing live data\u2026', 'info', 2000);
}

// --- PWA: SERVICE WORKER REGISTRATION ---
// Called from window.onload, so the document is already fully loaded and the
// worker install will not compete with first paint. Failures are non-fatal: the
// app works exactly as before without a worker.
//
// NOTE: this must NOT wrap registration in another 'load' listener. window.onload
// runs *during* the load event's dispatch, and the DOM copies the listener list
// before invoking it, so a listener added here would never fire.
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        logDebug('Service worker unsupported - PWA caching disabled', 'PWA');
        return;
    }

    navigator.serviceWorker.register('/sw.js').then(function (reg) {
        logDebug('Service worker registered (scope ' + reg.scope + ')', 'PWA');

        reg.addEventListener('updatefound', function () {
            var installing = reg.installing;
            if (!installing) return;
            installing.addEventListener('statechange', function () {
                if (installing.state !== 'installed') return;
                if (navigator.serviceWorker.controller) {
                    // A new version finished caching. Do NOT reload automatically:
                    // an angler mid-way through a catch log would lose typed data.
                    // Offer the update instead and let them choose when to apply.
                    logDebug('New app version cached - awaiting user approval', 'PWA');
                    showToast('Update ready for the next launch', 'info', 8000, {
                        label: 'UPDATE NOW',
                        onClick: function () {
                            installing.postMessage({ type: 'SKIP_WAITING' });
                            // Give the new worker a moment to claim clients first.
                            setTimeout(function () { window.location.reload(); }, 400);
                        }
                    });
                } else {
                    logDebug('App shell cached for offline use', 'PWA');
                    showToast('Offline mode ready', 'success', 2500);
                }
            });
        });
    }).catch(function (err) {
        logDebug('Service worker registration failed: ' + err.message, 'PWA');
    });

    // Tell the angler when connectivity changes, since the water report depends
    // on it and the offline shell can serve stale numbers. On reconnect, actually
    // re-fetch so a homescreen install self-heals without a manual refresh.
    if ('onLine' in navigator) {
        window.addEventListener('online', function () {
            showToast('Back online - refreshing live data', 'success', 2500);
            logDebug('Network restored', 'PWA');
            silenceableRefresh();
        });
        window.addEventListener('offline', function () {
            showToast('Offline - showing cached river data', 'warn', 4000);
            logDebug('Network lost - offline shell active', 'PWA');
        });
    }
}

// Apply a ?tab= deep link so the PWA manifest shortcuts land on the right tool.
function applyTabDeepLink() {
    try {
        var params = new URLSearchParams(window.location.search);
        var tab = params.get('tab');
        if (!tab) return false;
        if (!document.getElementById(tab)) return false;
        document.querySelectorAll('.tab-content').forEach(function (el) {
            el.classList.remove('tab-active');
        });
        document.getElementById(tab).classList.add('tab-active');
        logDebug('Deep link opened ' + tab, 'UI');
        return true;
    } catch (e) {
        return false;
    }
}

// --- BOOTSTRAP ---
window.onload = function() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    document.getElementById('log-datetime').value = d.toISOString().slice(0,16);
    restoreRig();
    initGearSimInputDebounce();
    applyTabDeepLink();
    registerServiceWorker();
    startAutoRefresh();
    getGPS();
    initAuth();
    if (typeof setCatchScope === 'function') setCatchScope(CATCH_SCOPE);
    loadWaterReport();
};
