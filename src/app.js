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
function toggleMenu() {
    var m = document.getElementById('menu-drawer');
    var open = (m.style.display !== 'block');
    m.style.display = open ? 'block' : 'none';
    // Keep the hamburger button's announced state in sync with the drawer.
    var btn = document.querySelector('.nav-btn');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('tab-active'); });
    document.getElementById(tabId).classList.add('tab-active');
    toggleMenu();
    logDebug("Switched to " + tabId, "UI");
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
        } else if (currentStats) {
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
    switchTab('tab-gear-sim');
}

async function stopFishing() {
    try { if (typeof Supa !== 'undefined') await Supa.signOut(); } catch (e) {}
    setFieldValue('auth-name', '');
    currentStats = null;
    applyAuthState(false, '');
    loadDatabase();
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

// Accepts either Supabase (angler_name/catch_time/cfs/species) or local buffer
// (name/time/flow/spc) shapes so the offline fallback renders identically.
function normalizeFeedRow(row) {
    if (!row) return null;
    return {
        name: (row.angler_name !== undefined) ? row.angler_name : row.name,
        time: (row.catch_time !== undefined) ? row.catch_time : row.time,
        flow: (row.cfs !== undefined && row.cfs !== null) ? row.cfs : row.flow,
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

function formatTideRow(tideStr) {
    if (!tideStr || tideStr.indexOf('Syncing') !== -1) {
        return '<div class="env-tide-row"><span class="tide-empty">' + (tideStr || 'Tide Data Syncing...') + '</span></div>';
    }
    var items = tideStr.split(' | ');
    var html = '<div class="env-tide-row">';
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
    var gpsCoords = (activeStation && activeStation.isGps) ? { lat: activeStation.lat, lon: activeStation.lon } : (window.userGPSCoords || null);

    // 3. Dynamic Regulations Engine Evaluation
    if (typeof checkRiverStatus === 'function') {
        var reg = checkRiverStatus(d, riverId, gpsCoords);
        var pill = document.getElementById('river-status-pill');
        if (pill) {
            pill.innerText = reg.isOpen ? '● RIVER OPEN' : '● RIVER CLOSED';
            pill.className = 'reg-status-pill ' + (reg.isOpen ? 'status-pill-open' : 'status-pill-closed');
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

async function loadWaterReport() {
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
        
        // Phase 2: hatchery escapement block (built once for the active river, injected into the card)
        var escapementHtml = '<div class="esc-slot" data-site="' + (actId || station.id) + '">' + buildEscapementSection(actId || station.id) + '</div>';

        var cardsHtml = '';

        // Automatically push Live CFS to Gear Sim (skip on USGS outage so the
        // manual CFS the angler typed is preserved instead of being blanked).
        if(reports.length > 0 && reports[0].cfs !== null && reports[0].cfs !== undefined && !reports[0].api_offline) {
            var cfsInput = document.getElementById('flow');
            cfsInput.value = reports[0].cfs;
            syncSelect('flow');
            logDebug("Auto-synced CFS to Gear Sim: " + reports[0].cfs, "STATE");
        }

        for(var i=0; i<reports.length; i++) {
            var rep = reports[i];

            var winHtml = '';
            for(var j=0; j<rep.windows.length; j++) {
                var w = rep.windows[j];
                var col = getFMIColor(w.score);
                winHtml += '<div class="window-box" style="border-left: 4px solid '+col+';">' +
                    '<div class="window-hdr"><span class="window-time">'+w.start_str+' &ndash; '+w.end_str+'</span>' +
                    '<span class="window-score" style="color: '+col+';">'+w.score+'%</span></div>' +
                    '<div class="window-triggers">&rarr; '+w.triggers+'</div></div>';
            }

            var dStyle = (i === activeDateOffset) ? "block" : "none";

            var pCol = (rep.press_delta > 0) ? 'var(--accent-green)' : ((rep.press_delta < 0) ? 'var(--accent-red)' : '#ffffff');
            // Barometric trend from the API's 6-hour pressure window: up-arrow rising, down-arrow falling, dash flat
            var pArr = (rep.press_delta > 0) ? '\u2191' : ((rep.press_delta < 0) ? '\u2193' : '\u2014');

            var cfsVal = (rep.cfs !== null && rep.cfs !== undefined) ? Number(rep.cfs).toLocaleString('en-US') + ' CFS' : '-- CFS';
            var gageVal = (rep.gage !== null && rep.gage !== undefined) ? rep.gage.toFixed(2) + ' ft Gauge Height' : '-- ft Gauge Height';
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
                // RIVER & ENVIRONMENTAL CONDITIONS (Consolidated)
                '<div class="sec-hdr">[ RIVER &amp; ENVIRONMENTAL CONDITIONS ]</div>' +
                seasonalWarn +
                '<div class="env-telemetry-row">' +
                  '<div class="telemetry-main">' +
                    '<span class="telemetry-val"><span class="cfs-val">' + cfsVal + '</span><span class="telemetry-sep">&bull;</span><span class="gage-val">' + gageVal + '</span></span>' +
                  '</div>' +
                  '<div class="telemetry-updated">' + (rep.updated_time || '') + '</div>' +
                '</div>' +
                formatTideRow(rep.tide_chart) +
                '<div class="env-weather-solunar">' +
                  '<div class="env-stat-grid">' +
                    // Row 1 (Atmospheric): BAROMETER, PRECIPITATION, CLOUD COVER
                    '<div class="env-badge">' +
                      '<div class="env-badge-val" style="color:' + pCol + ';">' + rep.pressure.toFixed(2) + ' <span style="font-size:10px; font-weight:600;">inHg</span> ' + pArr + '</div>' +
                      '<div class="env-badge-lbl">Barometer</div>' +
                    '</div>' +
                    '<div class="env-badge">' +
                      '<div class="env-badge-val"><span class="precip-pop">--</span>% &middot; <span class="precip-vol">' + (rep.rain != null ? rep.rain.toFixed(2) : '--') + '</span>"</div>' +
                      '<div class="env-badge-lbl">Precipitation</div>' +
                    '</div>' +
                    '<div class="env-badge">' +
                      '<div class="env-badge-val">' + rep.cloud_pct + '%</div>' +
                      '<div class="env-badge-lbl">Cloud Cover</div>' +
                    '</div>' +
                    // Row 2 (Tactical): TEMPERATURE, WIND, SOLUNAR
                    '<div class="env-badge">' +
                      '<div class="env-badge-val"><span class="air-temp">--</span>° Air &middot; <span class="water-temp">--</span>° H₂O</div>' +
                      '<div class="env-badge-lbl">Temperature</div>' +
                    '</div>' +
                    '<div class="env-badge">' +
                      '<div class="env-badge-val"><span class="wind-val">' + (rep.wind || '-- mph') + '</span></div>' +
                      '<div class="env-badge-lbl">Wind</div>' +
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
                
                // 5b. PHASE 2 HATCHERY ESCAPEMENT (below the 3x2 conditions grid)
                escapementHtml +

                // 6. LEGAL HOURS TIMELINE
                '<div class="sec-hdr">[ LEGAL HOURS TIMELINE ]</div>' + winHtml + '</div></div>';
        }
        document.getElementById('water-report-cards').innerHTML = cardsHtml;
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

        // Live telemetry: four fully independent reads (USGS CFS momentum, USGS
        // proxy water temp, Open-Meteo surface conditions). Each already swallows
        // its own errors, so they run concurrently and repaint as they land.
        Promise.all([
            fetchCFSMomentum(actId || station.id),
            fetchProxyWaterTemp(actId || station.id),
            fetchWeatherConditions(station.lat, station.lon)
        ]).then(function () {
            logDebug('Telemetry batch settled (CFS, water temp, weather)', 'NET');
        });
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
        Promise.all([
            fetchProxyWaterTemp(station.id),
            fetchWeatherConditions(station.lat, station.lon)
        ]);
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
            var coords = pos.coords.latitude.toFixed(4) + ", " + pos.coords.longitude.toFixed(4);
            document.getElementById('log-gps').value = coords;
            window.userGPSCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
            logDebug("GPS Lock: " + coords, "SYS");
            updateActiveDateUI();
        }, function(err){
            document.getElementById('log-gps').value = "Denied";
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
function communitySonar(dbArray, flow, species) {
    if (!dbArray || !dbArray.length) return { center: null, samples: 0, note: 'no community data yet' };
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
        if (isFinite(h) && h > 0) heights.push(h);
    }
    if (heights.length < 2) return { center: null, samples: heights.length, note: 'community sample too thin to shift the zone' };
    var sum = 0;
    for (var k = 0; k < heights.length; k++) sum += heights[k];
    var center = sum / heights.length;
    return { center: center, samples: heights.length, note: heights.length + ' recent catches holding near ' + center.toFixed(1) + '"' };
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
    if (sonar && sonar.center !== null && sonar.center !== undefined && isFinite(sonar.center) && sonar.samples >= 2) {
        var weatherCenter = (zMin + zMax) / 2;
        var halfWidth = (zMax - zMin) / 2;
        var pull = Math.min(0.5, 0.125 + (sonar.samples * 0.046875));  // 2->~0.22, 8->0.5
        var blended = weatherCenter + ((sonar.center - weatherCenter) * pull);
        zone.sonarShift = blended - weatherCenter;
        zMin = blended - halfWidth;
        zMax = blended + halfWidth;
        zone.sonar = sonar;
        zone.notes.push('Recent community catches holding near ' + sonar.center.toFixed(1) + '" (' + sonar.samples + ' fish): zone pulled ' +
            (zone.sonarShift >= 0 ? '+' : '') + zone.sonarShift.toFixed(1) + '" toward feeding fish.');
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

    // Brag Board renderer: public columns only (Name / Time / Flow / Fish). Reads the
// Supabase view first and falls back to the local buffer when offline or unconfigured.
async function loadDatabase() {
    var tbody = document.getElementById('db-body');
    if (tbody) tbody.innerHTML = '';

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
        tr.innerHTML = '<td>' + (r.name || '--') + '</td>' +
            '<td>' + formatCatchTime(r.time) + '</td>' +
            '<td>' + ((r.flow !== undefined && r.flow !== null) ? r.flow : '--') + '</td>' +
            '<td>' + (r.spc || '--') + '</td>';
        tbody.appendChild(tr);
        rendered++;
    }

    if (rendered === 0) {
        var empty = document.createElement('tr');
        empty.innerHTML = '<td colspan="4" class="empty-state">' +
            '<div class="empty-state-icon">🎣</div>' +
            '<div class="empty-state-title">No catches on the board yet</div>' +
            '<div class="empty-state-hint">' + (fromCloud
                ? 'Be the first to post — run the Gear Sim, then FEED DATA.'
                : 'You are offline or signed out, so this shows your local log only. Sign in to sync to the public board.') +
            '</div>' +
            '</td>';
        tbody.appendChild(empty);
    }

    if (typeof refreshZonePreview === 'function') refreshZonePreview();
    logDebug('Brag board: ' + rendered + ' row(s) ' + (fromCloud ? 'from Supabase' : 'from local buffer'), 'DB');
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

    var btnLog = document.getElementById('btn-log');
    if (!AuthState.signedIn) {
        btnLog.innerText = 'SIGN IN TO LOG CATCHES';
        btnLog.className = 'btn-main locked';
    } else if (blownOut) {
        btnLog.innerText = 'LOG ANYWAY (FORCE)';
        btnLog.className = 'btn-main force';
    } else {
        btnLog.innerText = 'LOG CATCH DATA';
        btnLog.className = 'btn-main ready';
    }

    var sugBox = document.getElementById('suggestions');
    sugBox.style.display = 'block';
    sugBox.innerHTML = '<span class="sug-head">Rig Adjustments</span>- ' + suggestions.join('<br>- ') +
        '<div class="sug-cond">' + zone.notes.join('<br>') + '</div>';

    if (simBtn) { simBtn.innerText = 'RUN SIMULATION'; simBtn.disabled = false; }
    logDebug('Sim: height ' + hgt.toFixed(2) + '", bed velocity ' + velocity.bottom.toFixed(2) +
        ' ft/s, zone ' + zone.min.toFixed(1) + '-' + zone.max.toFixed(1) + '", score ' + score.toFixed(2), 'SIM');
}

    // Offline-first write: buffer the catch locally, then push the full private profile
// (complete tackle + GPS) to Supabase. The public view only ever exposes 4 columns.
async function logData() {
    if (!AuthState.signedIn) {
        switchTab('tab-catch-log');
        var nameField = document.getElementById('auth-name');
        if (nameField) nameField.focus();
        showToast('Start a session first: enter your name and tap START FISHING.', 'warn', 5000);
        return;
    }
    if (!currentStats) return;

    var foamRaw = getStr('foam');
    var foamParsed = parseFoam(foamRaw);
    var payload = {
        name: AuthState.name || 'Anonymous',
        time: getStr('log-datetime'),
        gps: getStr('log-gps'),
        flow: currentStats.flow,
        spc: getStr('species'),
        loc: getStr('hook-loc'),
        ldLen: getNum('ld-len'),
        ldMat: getStr('ld-mat'),
        ldLb: getNum('ld-lb'),
        mlMat: getStr('ml-mat'),
        mlLb: getNum('ml-lb'),
        weight: getNum('weight'),
        rodFt: getRodLengthFt(),
        dist: getNum('distance'),
        hook: currentStats.hook,
        yarn: getNum('yarn'),
        foam: foamRaw,
        corky: foamParsed.size,          // legacy numeric column kept for old readers
        bdMat: getStr('bd-mat'),
        bdSz: getNum('bd-sz'),
        hgt: Number(currentStats.hgt.toFixed(2)),
        zoneMin: Number(currentStats.zoneMin.toFixed(2)),
        zoneMax: Number(currentStats.zoneMax.toFixed(2)),
        score: Number(currentStats.score.toFixed(2))
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

    document.getElementById('btn-log').innerText = 'FEED DATA (RUN SIM FIRST)';
    document.getElementById('btn-log').className = 'btn-main';
    currentStats = null;
    await loadDatabase();
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
    status.innerText = "Capturing device coordinates...";
    
    if (!navigator.geolocation) {
        status.innerText = "❌ Geolocation not supported. Falling back.";
        setTimeout(fallbackStation, 1500);
        return;
    }

    navigator.geolocation.getCurrentPosition(async function(pos) {
        var lat = pos.coords.latitude;
        var lon = pos.coords.longitude;
        status.innerText = `📍 Captured: ${lat.toFixed(4)}, ${lon.toFixed(4)}. Searching USGS...`;
        
        // Build a bounding box (approx 20-30 miles is ~0.4 degrees)
        var latDiff = 0.4;
        var lonDiff = 0.4;
        var minLat = lat - latDiff;
        var maxLat = lat + latDiff;
        var minLon = lon - lonDiff;
        var maxLon = lon + lonDiff;
        var bBox = `${minLon.toFixed(5)},${minLat.toFixed(5)},${maxLon.toFixed(5)},${maxLat.toFixed(5)}`;
        
        // ParameterCd=00060 (Discharge) or 00065 (Gage height)
        var url = `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${bBox}&parameterCd=00060,00065&siteStatus=all`;
        logDebug("Querying USGS GPS Box: " + bBox, "NET");
        
        try {
            var response = await fetch(url, { cache: "no-store" });
            var data = await response.json();
            var timeSeries = data.value.timeSeries;
            if (!timeSeries || timeSeries.length === 0) {
                status.innerText = "❌ No active USGS stations found in range. Falling back.";
                setTimeout(fallbackStation, 2000);
                return;
            }
            
            // Group by site and calculate distance
            var stationsMap = {};
            timeSeries.forEach(function(ts) {
                var sCode = ts.sourceInfo.siteCode[0].value;
                var sName = ts.sourceInfo.siteName;
                var sLoc = ts.sourceInfo.geoLocation.geogLocation;
                var sLat = sLoc.latitude;
                var sLon = sLoc.longitude;
                var paramCode = ts.variable.variableCode[0].value;
                
                try {
                    var valuesBlock = ts.values[0].value;
                    if (!valuesBlock || valuesBlock.length === 0) return;
                    
                    var latestEntry = valuesBlock[0];
                    var latestValStr = latestEntry.value;
                    var latestDtStr = latestEntry.dateTime;
                    
                    // 1. Numerical Value Check
                    var latestVal = parseFloat(latestValStr);
                    if (isNaN(latestVal)) return; // Discards null, empty, "Seasonal", "Ice", "Discontinued" etc.
                    
                    // 2. 24-Hour Freshness Check
                    var readingTime = new Date(latestDtStr).getTime();
                    var ageMs = Date.now() - readingTime;
                    if (ageMs > 24 * 3600 * 1000) return; // Discards readings older than 24 hours
                    
                    if (paramCode === "00060" || paramCode === "00065") {
                        if (!stationsMap[sCode]) {
                            var dist = calcDistance(lat, lon, sLat, sLon);
                            stationsMap[sCode] = {
                                id: sCode,
                                name: sName,
                                lat: sLat,
                                lon: sLon,
                                distance: dist
                            };
                        }
                    }
                } catch(err) {}
            });
            
            // Sort by distance and pick closest
            var stationsList = Object.values(stationsMap);
            stationsList.sort(function(a, b) { return a.distance - b.distance; });
            
            if (stationsList.length > 0) {
                var closest = stationsList[0];
                status.innerText = `📍 Found: ${closest.name} (${closest.distance.toFixed(1)} mi)`;
                setTimeout(function() {
                    selectPreset(closest.id, closest.lat, closest.lon, closest.name, true);
                }, 1500);
            } else {
                status.innerText = "❌ No active gauge stations in range. Falling back.";
                setTimeout(fallbackStation, 2000);
            }
        } catch(e) {
            status.innerText = "❌ USGS API Error. Falling back.";
            logDebug("USGS GPS box error: " + e.message, "ERR");
            setTimeout(fallbackStation, 2000);
        }
    }, function(err) {
        status.innerText = "❌ GPS Access Denied. Falling back.";
        logDebug("Geolocation error: " + err.message, "ERR");
        setTimeout(fallbackStation, 1500);
    });
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
    // on it and the offline shell can serve stale numbers.
    if ('onLine' in navigator) {
        window.addEventListener('online', function () {
            showToast('Back online - refreshing live data', 'success', 2500);
            logDebug('Network restored', 'PWA');
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
    initGearSimInputDebounce();
    applyTabDeepLink();
    registerServiceWorker();
    getGPS();
    initAuth();
    loadDatabase();
    loadWaterReport();
};
