/**
 * Supabase service layer: anonymous auth, private catch writes, public reads.
 *
 * LIVE BACKEND (probed 2026-09-16 — code below matches this exactly)
 *   public.catches columns:
 *     id, user_id, created_at, angler_name, catch_time, flow, species,
 *     latitude, longitude, weight, leader_lb, leader_length, leader_material,
 *     hook_size, yarn, foam, corky_size, bead_material, bead_size,
 *     barometer, hook_location, gauge_height
 *   public.public_catch_feed columns: id, name, time, flow (NO fish column)
 *   RPC get_global_calibration(p_flow int, p_species text) -> [] (exists, empty)
 */

// --- CONFIG: paste the values from Supabase > Project Settings > API ---
const SUPABASE_URL = 'https://pztcfsqifbfkjvosygcy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_CJcIKTHTSUGSFkw6POK6XA_tNfo37Gr';

const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
const GUEST_NAME_KEY = 'angler_display_name';

var _client = null;
var _sdkPromise = null;

function isConfigured() {
    return SUPABASE_URL.indexOf('PASTE_YOUR') !== 0 && SUPABASE_ANON_KEY.indexOf('PASTE_YOUR') !== 0;
}

// The CDN bundle is normally loaded by a <script> tag in index.html. If that failed
// (offline, blocked, cached miss) inject it on demand so the app can still try to connect.
function ensureSdk() {
    if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
        return Promise.resolve(true);
    }
    if (_sdkPromise) return _sdkPromise;
    _sdkPromise = new Promise(function (resolve) {
        if (typeof document === 'undefined' || !document.head) return resolve(false);
        var tag = document.createElement('script');
        tag.src = SUPABASE_CDN;
        tag.async = true;
        tag.onload = function () { resolve(!!(window.supabase && window.supabase.createClient)); };
        tag.onerror = function () { resolve(false); };
        document.head.appendChild(tag);
        setTimeout(function () { resolve(!!(window.supabase && window.supabase.createClient)); }, 6000);
    });
    return _sdkPromise;
}

function getClient() {
    if (_client) return _client;
    if (!isConfigured()) return null;
    if (typeof window === 'undefined' || !window.supabase || !window.supabase.createClient) return null;
    try {
        _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { persistSession: true, autoRefreshToken: true, storageKey: 'puyallup_angler_auth' }
        });
    } catch (e) {
        _client = null;
    }
    return _client;
}

function rememberName(name) {
    try { localStorage.setItem(GUEST_NAME_KEY, name); } catch (e) {}
}

function recallName() {
    try { return localStorage.getItem(GUEST_NAME_KEY) || ''; } catch (e) { return ''; }
}

// ---------------------------------------------------------------- AUTH ---

/**
 * Anonymous (guest) sign in. No email or password: Supabase issues an anonymous user and
 * we stash the display name in user_metadata so the public feed can show it.
 */
async function signInGuest(name) {
    var clean = String(name || '').trim().slice(0, 24);
    if (!clean) return { ok: false, error: 'Enter a name to start fishing.' };
    rememberName(clean);

    var sdk = await ensureSdk();
    var client = sdk ? getClient() : null;
    // Local-only guest: Supabase not configured, unreachable, or anonymous
    // sign-ins disabled in the dashboard (current state) — the app still works.
    if (!client) return { ok: true, offline: true, name: clean, user: null };

    try {
        if (typeof client.auth.signInAnonymously !== 'function') {
            return { ok: true, offline: true, name: clean, user: null };
        }
        var res = await client.auth.signInAnonymously({ options: { data: { display_name: clean } } });
        if (res.error) return { ok: false, error: res.error.message, name: clean };
        return { ok: true, name: clean, user: res.data ? res.data.user : null };
    } catch (e) {
        return { ok: false, error: e.message, name: clean };
    }
}

async function signOut() {
    var client = getClient();
    try { if (client) await client.auth.signOut(); } catch (e) {}
    try { localStorage.removeItem(GUEST_NAME_KEY); } catch (e) {}
    return { ok: true };
}

/**
 * Returns { user, session, name, isGuest }. `name` falls back to the cached display name so
 * the UI still shows an identity when Supabase is unreachable.
 */
async function getSession() {
    var sdk = await ensureSdk();
    var client = sdk ? getClient() : null;
    if (!client) return { session: null, user: null, name: recallName(), isGuest: false, offline: true };
    try {
        var res = await client.auth.getSession();
        var session = (res && res.data) ? res.data.session : null;
        var user = session ? session.user : null;
        var meta = (user && user.user_metadata) ? user.user_metadata : {};
        return {
            session: session,
            user: user,
            name: meta.display_name || recallName(),
            isGuest: !!(user && !user.email)
        };
    } catch (e) {
        return { session: null, user: null, name: recallName(), isGuest: false, offline: true };
    }
}

// ------------------------------------------------------------ DATABASE ---

// Local payload -> LIVE public.catches columns. Only live columns are sent:
// name/time/flow/spc -> angler_name/catch_time/flow/species, loc -> hook_location,
// GPS "lat, lon" split -> latitude/longitude, weight -> weight,
// ldLen/ldMat/ldLb -> leader_length/leader_material/leader_lb,
// hook -> hook_size, yarn -> yarn, foam -> foam (+corky_size mirror),
// bdMat/bdSz -> bead_material/bead_size.
function toCatchRow(payload) {
    var t = payload.time ? new Date(payload.time) : new Date();
    if (isNaN(t.getTime())) t = new Date();
    var lat = null, lon = null;
    if (payload.gps && payload.gps !== 'Denied') {
        var parts = String(payload.gps).split(',');
        if (parts.length === 2) {
            lat = parseFloat(parts[0]); lon = parseFloat(parts[1]);
            if (isNaN(lat)) lat = null;
            if (isNaN(lon)) lon = null;
        }
    }
    return {
        user_id: (payload.user_id !== undefined && payload.user_id !== null) ? payload.user_id : undefined,
        angler_name: payload.name,
        catch_time: t.toISOString(),
        flow: payload.flow,
        species: payload.spc,
        hook_location: payload.loc || null,
        latitude: lat,
        longitude: lon,
        weight: (payload.weight !== undefined && payload.weight !== null) ? payload.weight : null,
        leader_length: payload.ldLen,
        leader_material: payload.ldMat || null,
        leader_lb: payload.ldLb,
        hook_size: (payload.hook !== undefined && payload.hook !== null) ? String(payload.hook) : null,
        yarn: payload.yarn,
        foam: payload.foam || null,
        corky_size: payload.foam || null,
        bead_material: payload.bdMat || null,
        bead_size: payload.bdSz,
        rod_ft: (payload.rodFt !== undefined && payload.rodFt !== null) ? payload.rodFt : null,
        cast_distance_ft: (payload.dist !== undefined && payload.dist !== null) ? payload.dist : null,
        mainline_mat: payload.mlMat || null,
        mainline_lb: (payload.mlLb !== undefined && payload.mlLb !== null) ? payload.mlLb : null,
        line_height_in: (payload.hgt !== undefined && payload.hgt !== null) ? payload.hgt : null,
        zone_min_in: (payload.zoneMin !== undefined && payload.zoneMin !== null) ? payload.zoneMin : null,
        zone_max_in: (payload.zoneMax !== undefined && payload.zoneMax !== null) ? payload.zoneMax : null,
        sim_score: (payload.score !== undefined && payload.score !== null) ? payload.score : null
    };
}

/** Private write: the full tackle profile and GPS go up, nothing comes back. */
async function insertCatch(payload) {
    var client = getClient();
    if (!client) return { ok: false, offline: true, error: 'Supabase not configured or offline' };
    try {
        var res = await client.from('catches').insert(toCatchRow(payload)).select('id');
        if (res.error) return { ok: false, error: res.error.message };
        var row = (res.data && res.data.length) ? res.data[0] : null;
        return { ok: true, id: row ? row.id : null };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/** Public read: the rebuilt view exposes name / time / flow / fish.
 * Falls back gracefully when run against the OLD view (id/name/time/flow). */
async function fetchPublicFeed(limit) {
    var client = getClient();
    if (!client) return [];
    try {
        var res = await client
            .from('public_catch_feed')
            .select('name,time,flow,fish')
            .order('time', { ascending: false })
            .limit(limit || 100);
        if (res.error) {
            // OLD view has no fish column — retry without it so the board still loads.
            var retry = await client
                .from('public_catch_feed')
                .select('name,time,flow')
                .order('time', { ascending: false })
                .limit(limit || 100);
            if (retry.error || !retry.data) return [];
            return retry.data.map(function (r) {
                return { name: r.name, time: r.time, flow: r.flow, spc: null };
            });
        }
        if (!res.data) return [];
        return res.data.map(function (r) {
            return { name: r.name, time: r.time, flow: r.flow, spc: (r.fish !== undefined) ? r.fish : null };
        });
    } catch (e) {
        return [];
    }
}

/**
 * Community telemetry for the physics engine. NOTE: the live RPC currently
 * returns [] (empty table, and its return shape is unverified), so runSim()
 * always falls back to the local buffer. The mapper below accepts both the
 * aspirational shape and any future live shape; unknown shapes pass through
 * only when they carry usable leader/flow fields.
 */
async function fetchGlobalCalibration(flow, species) {
    var client = getClient();
    if (!client) return [];
    try {
        var res = await client.rpc('get_global_calibration', { p_flow: flow, p_species: species });
        if (res.error || !res.data) return [];
        return res.data.map(function (r) {
            return {
                flow: (r.cfs !== undefined) ? r.cfs : r.flow,
                spc: (r.species !== undefined) ? r.species : (r.spc || species),
                loc: (r.hook_loc !== undefined) ? r.hook_loc : r.hook_location,
                ldLen: (r.leader_len_ft !== undefined) ? r.leader_len_ft : r.leader_length,
                ldMat: (r.leader_material !== undefined) ? r.leader_material : (r.ldMat || null),
                ldLb: (r.leader_lb !== undefined) ? r.leader_lb : null,
                mlMat: (r.mainline_mat !== undefined) ? r.mainline_mat : (r.mlMat || null),
                mlLb: (r.mainline_lb !== undefined) ? r.mainline_lb : null,
                weight: (r.lead_oz !== undefined) ? r.lead_oz : r.weight,
                hook: (r.hook_size !== undefined) ? r.hook_size : null,
                yarn: (r.yarn_in !== undefined) ? r.yarn_in : r.yarn,
                foam: r.foam,
                bdMat: (r.bead_mat !== undefined) ? r.bead_mat : r.bead_material,
                bdSz: (r.bead_size !== undefined) ? r.bead_size : null,
                rodFt: (r.rod_ft !== undefined) ? r.rod_ft : null,
                dist: (r.cast_distance_ft !== undefined) ? r.cast_distance_ft : null,
                samples: r.samples
            };
        });
    } catch (e) {
        return [];
    }
}

if (typeof window !== 'undefined') {
    window.Supa = {
        // auth
        signInGuest: signInGuest,
        signOut: signOut,
        getSession: getSession,
        // data
        insertCatch: insertCatch,
        fetchPublicFeed: fetchPublicFeed,
        fetchGlobalCalibration: fetchGlobalCalibration,
        // support
        isConfigured: isConfigured,
        ensureSdk: ensureSdk,
        toCatchRow: toCatchRow,
        SUPABASE_CDN: SUPABASE_CDN
    };
}