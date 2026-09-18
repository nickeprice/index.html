/**
 * sw.js - Puyallup River Companion service worker
 *
 * Caching strategy by request type:
 *
 *   navigation          network-first, falling back to the precached app shell.
 *                       The app is usable offline; the UI then renders whatever
 *                       telemetry it already has plus the local NOAA/Meeus
 *                       solar fallback in calculateSolarHours().
 *
 *   /api/water_report   network-first with a NORMALISED cache key. The app appends
 *                       a `_t=<Date.now()>` cache-buster, so caching on the raw
 *                       URL would never hit. We key on ?site=&lat=&lon= only, so
 *                       a fresh visit refreshes the payload and an offline visit
 *                       replays the last known report.
 *
 *   same-origin static  stale-while-revalidate: serve from cache immediately,
 *                       refresh the cache in the background.
 *
 *   cross-origin (CDN)  stale-while-revalidate for the Supabase SDK. Never
 *                       opaque-cache third-party telemetry APIs - those need
 *                       fresh data and must not poison storage.
 *
 *   other (USGS, Open-Meteo, Socrata)  network only. Live telemetry is only
 *                       meaningful when current, and those responses are opaque
 *                       (no CORS) so they cannot be inspected or trusted in cache.
 */

const VERSION = 'v2.00.10';
const SHELL_CACHE = 'prc-shell-' + VERSION;
const API_CACHE = 'prc-api-' + VERSION;
const ASSET_CACHE = 'prc-assets-' + VERSION;

// App shell: everything needed to render the UI with zero network.
const SHELL_FILES = [
    '/',
    '/index.html',
    '/manifest.json',
    '/src/styles.css',
    '/src/app.js',
    '/src/services/supabase.js',
    '/src/services/water.js',
    '/src/utils/regulations.js',
    '/src/data/riverRegulations.js',
    '/src/data/wdfw_rules.json',
    '/src/data/wdfw_forecasts.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/maskable-192.png',
    '/icons/maskable-512.png',
    '/icons/apple-touch-icon.png'
];

// Third-party scripts the shell depends on. Cached separately so a CDN outage
// does not blank the app.
const CDN_FILES = [
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

/**
 * Store a cross-origin, no-CORS asset.
 *
 * cache.add() CANNOT be used here: it rejects any response whose status is not
 * an ok status, and an opaque response reports status 0. It fails with
 * "TypeError: Failed to execute 'add' on 'Cache': Request failed", which is easy
 * to swallow silently. cache.put() performs no status/ok check, so fetching and
 * putting by hand works.
 */
async function precacheOpaque(cache, url) {
    var req = new Request(url, { mode: 'no-cors' });
    try {
        var res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
            await cache.put(req, res);
            return true;
        }
    } catch (err) {
        // Offline or blocked at install time: the runtime SWR path will retry.
    }
    return false;
}

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(function (cache) {
                // Cache each file independently so one 404 cannot fail the install.
                return Promise.all(SHELL_FILES.map(function (url) {
                    return cache.add(new Request(url, { cache: 'reload' }))
                        .catch(function (err) {
                            console.warn('[sw] precache skipped', url, err);
                        });
                }));
            })
            .then(function () { return caches.open(ASSET_CACHE); })
            .then(function (cache) {
                // Opaque cross-origin assets need the fetch+put path - see
                // precacheOpaque() for why cache.add() cannot be used.
                return Promise.all(CDN_FILES.map(function (url) {
                    return precacheOpaque(cache, url);
                }));
            })
            .then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (event) {
    var keep = [SHELL_CACHE, API_CACHE, ASSET_CACHE];
    event.waitUntil(
        caches.keys()
            .then(function (keys) {
                return Promise.all(keys.map(function (key) {
                    if (keep.indexOf(key) === -1) return caches.delete(key);
                    return null;
                }));
            })
            .then(function () { return self.clients.claim(); })
    );
});

/**
 * Normalise a /api/water_report URL to a stable cache key by dropping the
 * `_t` cache-buster the app adds on every call.
 */
function apiCacheKey(url) {
    var out = new URL(url.href);
    out.searchParams.delete('_t');
    // Sort so parameter order cannot create duplicate entries.
    var params = Array.from(out.searchParams.entries()).sort(function (a, b) {
        return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0);
    });
    out.search = '';
    params.forEach(function (p) { out.searchParams.append(p[0], p[1]); });
    return out.href;
}

async function networkFirstApi(request, url) {
    var key = apiCacheKey(url);
    var cache = await caches.open(API_CACHE);
    try {
        var fresh = await fetch(request);
        if (fresh.ok) cache.put(key, fresh.clone());
        return fresh;
    } catch (err) {
        var stale = await cache.match(key);
        if (stale) return stale;
        throw err;
    }
}

async function staleWhileRevalidate(request, cacheName, allowOpaque) {
    var cache = await caches.open(cacheName);
    var cached = await cache.match(request);
    var revalidate = fetch(request).then(function (response) {
        // Cache successful same-origin responses, plus opaque cross-origin CDN
        // responses when explicitly allowed. An opaque response reports status 0,
        // so an ok-only check would reject it and the asset would never cache.
        if (response && (response.ok || (allowOpaque && response.type === 'opaque'))) {
            cache.put(request, response.clone());
        }
        return response;
    }).catch(function () { return cached; });
    return cached || revalidate;
}

async function networkFirstNavigation(request) {
    try {
        var fresh = await fetch(request);
        var cache = await caches.open(SHELL_CACHE);
        cache.put('/index.html', fresh.clone());
        return fresh;
    } catch (err) {
        var shell = await caches.match('/index.html') || await caches.match('/');
        if (shell) return shell;
        throw err;
    }
}

self.addEventListener('fetch', function (event) {
    var request = event.request;
    if (request.method !== 'GET') return;

    var url = new URL(request.url);

    // Live telemetry from third parties: never cache, always fresh.
    if (url.origin !== self.location.origin) {
        if (url.hostname.indexOf('cdn.jsdelivr.net') !== -1) {
            // allowOpaque: a cross-origin <script> load yields an opaque response.
            event.respondWith(staleWhileRevalidate(request, ASSET_CACHE, true));
            return;
        }
        // USGS NWIS, Open-Meteo, data.wa.gov Socrata, Supabase REST/RPC.
        return;
    }

    // Water report API: network-first with a cache-buster-free key.
    if (url.pathname === '/api/water_report') {
        event.respondWith(networkFirstApi(request, url));
        return;
    }

    // Other API routes: pass through untouched.
    if (url.pathname.indexOf('/api/') === 0) return;

    // Navigations: network-first, offline fallback to the shell.
    if (request.mode === 'navigate') {
        event.respondWith(networkFirstNavigation(request));
        return;
    }

    // Same-origin static assets (css, js, json, icons).
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
});

// Lets the page trigger an immediate reload after a new worker activates.
self.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
