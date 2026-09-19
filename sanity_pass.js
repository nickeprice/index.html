#!/usr/bin/env node
/**
 * sanity_pass.js — zero-dependency sanity pass for the Puyallup River Companion.
 *
 * The repo has no test runner and deliberately avoids npm tooling. This script:
 *   1. Builds/starts the dev server (scripts/dev_server.py) on a free port.
 *   2. STATIC INTEGRITY: every label[for] resolves to an id, every input/select
 *      has an accessible name, and the classic script load order ends with app.js.
 *   3. HTTP/API: static 200s + water report shape (4 days, tide_curve, species_calendar).
 *   4. BEHAVIOR: load real app.js functions in a DOM-stubbed Node context and
 *      exercise debounce, toasts, deep links, tab switching, and the empty state.
 *
 * Exit 0 on full pass, 1 on any failure.
 */

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname);
let PORT = 0;   // resolved to a free port in main()
let failures = [];
let passes = 0;
// --quiet: print only failures + the PASSED/FAILED summary (token-lean CI/local use).
// Default (no flag / --verbose): full per-check listing.
let QUIET = process.argv.includes('--quiet');

function ok(name, detail) { passes++; if (!QUIET) console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
function fail(name, detail) { failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
function describe(name) { if (!QUIET) console.log('\n## ' + name); }

// Start the dev server
function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['scripts/dev_server.py', String(PORT)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('server start timeout: ' + out)); } }, 8000);
    function probe() {
      http.get(`http://127.0.0.1:${PORT}/index.html`, (res) => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(child); }
        res.resume();
      }).on('error', () => { if (!settled) setTimeout(probe, 250); });
    }
    probe();
  });
}
function stopServer(child) {
  if (!child || child.killed) return;
  try { child.kill('SIGTERM'); } catch (e) {}
  // Give it a moment to exit; escalate to SIGKILL if it lingers (e.g. python may
  // not exit immediately on SIGTERM once it has served).
  setTimeout(() => {
    try {
      if (!child.killed) { process.kill(child.pid, 'SIGKILL'); }
    } catch (e) {}
  }, 500);
}

function httpGet(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: pathname }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body }));
    }).on('error', reject);
  });
}

// Static integrity: label[for], accessible names, script order
function staticIntegrity() {
  describe('Markup integrity');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const forAttrs = [...html.matchAll(/\bfor="([^"]+)"/g)].map((m) => m[1]);
  const broken = forAttrs.filter((f) => !ids.has(f));
  broken.length ? fail('label[for] resolves', broken.join(', ')) : ok('label[for] resolves', `${forAttrs.length} labels → present ids`);

  const controls = [...html.matchAll(/<(input|select)[^>]*>/g)].map((m) => m[0]);
  const unnamed = [];
  for (const c of controls) {
    const idMatch = c.match(/\bid="([^"]+)"/);
    const id = idMatch ? idMatch[1] : null;
    const hasAria = /\b(aria-label|aria-labelledby)="/.test(c);
    const labelMatch = id ? html.match(new RegExp('<label[^>]*\\bfor="' + id + '"')) : null;
    if (!hasAria && !labelMatch) unnamed.push(id || '(no id)');
  }
  unnamed.length ? fail('controls have accessible names', unnamed.join(', ')) : ok('controls have accessible names', `${controls.length} inputs/selects named`);

  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  scripts.length && scripts[scripts.length - 1].includes('app.js')
    ? ok('script load order ends with app.js', scripts.join(' → '))
    : fail('script load order ends with app.js', scripts.join(' → '));

  // Catch Log merge: ONE list with a yours/everyone toggle; default = Everyone
  const merged = html.includes('id="catch-log-table"') && html.includes('id="catch-log-body"') &&
    html.includes('id="scope-yours"') && html.includes('id="scope-everyone"') &&
    html.includes('onclick="setCatchScope');
  merged ? ok('catch log merged into one list + yours/everyone toggle', 'catch-log-body + scope buttons')
    : fail('catch log merged into one list + yours/everyone toggle', '');
  (!html.includes('id="my-catches-table"') && !html.includes('id="db-table"'))
    ? ok('split My Catches / Brag Board tables removed', 'single merged table only')
    : fail('split My Catches / Brag Board tables removed', 'stale tables found');

  // Phase 2.3: default scope is Everyone (board-first), board columns Name/Time/
  // River/Fish, and the GPS field + hook-location select are gone from the DOM.
  const scopeDefault = /id="scope-everyone" class="scope-btn scope-active"/.test(html);
  scopeDefault ? ok('catch log default scope is Everyone', 'scope-everyone active in markup')
    : fail('catch log default scope is Everyone', 'expected scope-everyone.scope-active');

  const boardHead = html.includes('<tr><th>Name</th><th>Time</th><th>River</th><th>Fish</th></tr>');
  boardHead ? ok('public board columns = Name/Time/River/Fish', 'no Flow column')
    : fail('public board columns = Name/Time/River/Fish', 'expected River header');

  (!html.includes('id="log-gps"') && !html.includes('id="hook-loc"'))
    ? ok('GPS field + hook-location removed from catch form', 'silent GPS, no hook-loc')
    : fail('GPS field + hook-location removed from catch form', 'stale controls found');

  // Phase 2.4: flow + distance inputs removed (flow is derived), Foam 1 + Foam 2
  // exist on both tabs, and the Gear Sim HUD stars/score-bar are gone.
  (!html.includes('id="flow"') && !html.includes('id="distance"') &&
   !html.includes('id="flow-log"') && !html.includes('id="distance-log"'))
    ? ok('flow + distance inputs removed from both forms', 'flow derived from the live report')
    : fail('flow + distance inputs removed from both forms', 'stale flow/distance inputs');

  (html.includes('id="foam"') && html.includes('id="foam2"') &&
   html.includes('id="foam-log"') && html.includes('id="foam2-log"'))
    ? ok('Foam 1 + Foam 2 present on both tabs', 'two-corky rig supported')
    : fail('Foam 1 + Foam 2 present on both tabs', 'missing Foam 2 control');

  (!html.includes('id="stars"') && !html.includes('id="score-bar"'))
    ? ok('Gear Sim stars + score bar removed', 'line height + bottom current only')
    : fail('Gear Sim stars + score bar removed', 'stale stars/score-bar markup');

  const cssSrc = fs.readFileSync(path.join(ROOT, 'src', 'styles.css'), 'utf8');
  // Phase 2.4.1: gear fields rest in explicit per-line rows (.gear-row) with a
  // 3-up leader row, replacing the auto-flow 2-column grid.
  (cssSrc.includes('.gear-row {') && cssSrc.includes('.gear-row-3 {'))
    ? ok('resting gear rows present (.gear-row + .gear-row-3)', 'one gear group per line')
    : fail('resting gear rows present (.gear-row + .gear-row-3)', 'missing .gear-row rules');
  (!cssSrc.includes('gear-grid') && !cssSrc.includes('.run-footer'))
    ? ok('dead .gear-grid / .run-footer rules removed', 'no stale layout rules')
    : fail('dead .gear-grid / .run-footer rules removed', 'stale CSS found');
  // Scroll/bar geometry: no body-as-scroll-container, and the body padding must
  // clear the REAL 56px bar + safe-area inset.
  (/html, body \{[^}]*height: 100%/.test(cssSrc) === false)
    ? ok('document-level scrolling (no body height:100%)', 'body is not a nested scroller')
    : fail('document-level scrolling (no body height:100%)', 'height:100% still set');
  (cssSrc.includes('padding-bottom: calc(56px + env(safe-area-inset-bottom))'))
    ? ok('body bottom padding clears the 56px tab bar + inset', 'last line not hidden')
    : fail('body bottom padding clears the 56px tab bar + inset', 'expected calc(56px + env(safe-area-inset-bottom))');

  // Header: station opens the modal only from a centered <button> (no full-width flex:1 div)
  /<button id="station-header"/.test(html)
    ? ok('station header is a centered button', 'no full-width click target')
    : fail('station header is a centered button', 'expected <button id="station-header">');

  // Water temp/turbidity: ONLY the active station's own gauge — proxy map must be gone
  const waterSrc = fs.readFileSync(path.join(ROOT, 'src', 'services', 'water.js'), 'utf8');
  (!waterSrc.includes('waterTempProxies') && !waterSrc.includes('fetchProxyWaterTemp'))
    ? ok('no cross-gauge water-temp proxy in water.js', 'own-gauge payload only')
    : fail('no cross-gauge water-temp proxy in water.js', 'proxy remnants found');

  // Phase 2.4.1: the hatchery freshness stamp rides on WDFW's own :updated_at
  // system column (never a fabricated date), and both forms rest in 6 rows.
  (waterSrc.includes('max(:updated_at) AS lastUpdated') && waterSrc.includes('formatEscapementUpdated'))
    ? ok('escapement feed requests + formats max(:updated_at)', 'real WDFW publish time')
    : fail('escapement feed requests + formats max(:updated_at)', 'missing :updated_at wiring');
  (waterSrc.includes('Hatchery data may lag WDFW reporting.'))
    ? ok('honest fallback when no :updated_at stamp exists', 'never a fake date')
    : fail('honest fallback when no :updated_at stamp exists', 'fallback wording missing');

  const appSrc = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
  (!appSrc.includes('hero-lbl') && appSrc.includes('[ FISHING OUTLOOK ]') &&
   appSrc.includes('Forecast &amp; Hatchery Report') && appSrc.includes('data-esc-updated'))
    ? ok('hero uses a real section header + renamed counts fold', 'no in-pill label')
    : fail('hero uses a real section header + renamed counts fold', 'stale hero-lbl / fold label');
  (!appSrc.includes('peakLine') && !appSrc.includes('run-footer'))
    ? ok('run cards carry no peak day-counter', 'peak date label only')
    : fail('run cards carry no peak day-counter', 'peakLine / .run-footer remnants');

  const gearRows = (html.match(/class="gear-row(?:[" ])/g) || []).length;
  (gearRows === 12 && !html.includes('gear-grid'))
    ? ok('both gear forms use 6 resting rows each', `${gearRows} rows total`)
    : fail('both gear forms use 6 resting rows each', `${gearRows} rows found`);
}

// HTTP and API checks
async function httpChecks() {
  describe('HTTP + API');
  for (const [p, wantType] of [
    ['/index.html', 'text/html'],
    ['/manifest.json', 'application/json'],
    ['/src/styles.css', 'text/css'],
    ['/src/app.js', 'text/javascript'],
    ['/src/services/supabase.js', 'text/javascript'],
    ['/src/services/water.js', 'text/javascript']
  ]) {
    const r = await httpGet(p);
    r.status === 200 ? ok(`GET ${p} → 200`, r.type) : fail(`GET ${p} → 200`, `got ${r.status}`);
  }

  const api = await httpGet('/api/water_report?site=12101500&lat=47.195&lon=-122.302');
  api.status === 200 ? ok('GET /api/water_report → 200', api.type) : fail('GET /api/water_report → 200', `got ${api.status}`);
  let reports = null;
  try { reports = JSON.parse(api.body); } catch (e) {}
  if (!reports || !reports.length) {
    fail('API returns 4 report days', JSON.stringify(reports));
  } else {
    const day0 = reports[0];
    (reports.length === 4 && day0.tide_curve && day0.species_calendar)
      ? ok('API returns 4 report days with tide_curve + species_calendar', `days=${reports.length}`)
      : fail('API returns 4 report days with tide_curve + species_calendar', `days=${reports.length}`);
    // Own-gauge water quality: the report exposes water_temp_f + turbidity_fnu
    // (may be null when the station doesn't report them — the UI hides then).
    ('water_temp_f' in day0 && 'turbidity_fnu' in day0)
      ? ok('API exposes own-gauge water_temp_f + turbidity_fnu', `temp=${day0.water_temp_f} turb=${day0.turbidity_fnu}`)
      : fail('API exposes own-gauge water_temp_f + turbidity_fnu', 'missing keys in report');
    // Phase H: the real hourly tide curve (tide_points) with 12-hour times feeds
    // the smooth area chart; species run cards need progress/peak_frac geometry.
    const tpts = day0.tide_points || [];
    (tpts.length > 1 && /([AP]M)$/.test((tpts[0] || {}).t || ''))
      ? ok('API returns real hourly tide_points with 12-hour times', `${tpts.length} points, e.g. ${(tpts[0] || {}).t}`)
      : fail('API returns real hourly tide_points with 12-hour times', `points=${tpts.length}`);
    const firstSpc = (day0.species_calendar || [])[0] || {};
    (firstSpc.progress !== undefined && firstSpc.peak_frac !== undefined)
      ? ok('species calendar carries run progress + peak geometry', `progress=${firstSpc.progress} peak_frac=${firstSpc.peak_frac}`)
      : fail('species calendar carries run progress + peak geometry', 'progress/peak_frac missing');

    // Phase 2.4.1 — TIMEZONE: `now` is Pacific wall-clock (ZoneInfo), so day 0 must
    // BE Pacific today and each card's netting flag must match the weekday of its
    // OWN title. The old server-local (UTC on Vercel) `now` drifted a day apart.
    const pacToday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', weekday: 'long', month: 'short', day: 'numeric'
    }).format(new Date());
    (day0.tag === 'TODAY' && String(day0.title) === pacToday)
      ? ok('day 0 card is TODAY in Pacific time', `${day0.title} == ${pacToday}`)
      : fail('day 0 card is TODAY in Pacific time', `title=${day0.title} pacificToday=${pacToday}`);
    const NET_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday']; // NETTING_DAYS = [6, 0, 1]
    const netBad = reports.filter((d) => {
      const wd = String(d.title || '').split(',')[0];
      const nets = /NETS IN/.test(String(d.net_status || ''));
      return nets !== (NET_WEEKDAYS.indexOf(wd) !== -1) || nets !== !!d.is_netting;
    });
    netBad.length === 0
      ? ok('netting matches each day\'s own Pacific weekday',
          reports.map((d) => String(d.title).split(',')[0] + (d.is_netting ? '=NETS' : '=open')).join(' '))
      : fail('netting matches each day\'s own Pacific weekday',
          netBad.map((d) => `${d.title} / ${d.net_status}`).join(' '));
  }

  // /api/nearby_stations — the server-side USGS lookup for the GPS flow.
  const near = await httpGet('/api/nearby_stations?lat=47.2&lon=-122.31');
  if (near.status === 200) {
    let stations = [];
    try { stations = JSON.parse(near.body).stations || []; } catch (e) {}
    stations.length >= 1
      ? ok('GET /api/nearby_stations returns nearest gauges', `${stations.length} station(s), closest=${stations[0] && stations[0].id}`)
      : fail('GET /api/nearby_stations returns nearest gauges', '0 stations');
  } else {
    fail('GET /api/nearby_stations → 200', `got ${near.status}`);
  }
}

// Behavior checks via a DOM-stubbed context (done() resolves when async settles)
function behaviorChecks(done) {
  describe('Behavior (DOM-stubbed app.js)');
  const elements = {};
  const classes = {};

  function el(id) {
    if (!elements[id]) {
      elements[id] = {
        innerText: '', textContent: '', innerHTML: '', value: '', style: {},
        className: '', classList: {
          add: (c) => { (classes[id] = classes[id] || new Set()).add(c); },
          remove: (c) => { if (classes[id]) classes[id].delete(c); },
          toggle: (c, force) => { (classes[id] = classes[id] || new Set()); force === undefined ? (classes[id].has(c) ? classes[id].delete(c) : classes[id].add(c)) : (force ? classes[id].add(c) : classes[id].delete(c)); },
          has: (c) => !!(classes[id] && classes[id].has(c))
        },
        setAttribute: () => {}, appendChild: () => {}, removeChild: () => {},
        addEventListener: () => {}, focus: () => {}
      };
    }
    return elements[id];
  }
  global.document = {
    getElementById: el,
    querySelector: () => null,
    querySelectorAll: (sel) => {
      if (sel === '.tab-content') {
        return ['tab-water-report', 'tab-gear-sim', 'tab-catch-log'].map((id) => {
          const e = el(id);
          e.classList.value = classes[id] || new Set();
          return e;
        });
      }
      return [];
    },
    createElement: () => el('__dyn_' + Math.random()),
    body: { appendChild: () => {} }
  };
  global.window = global;
  global.localStorage = { getItem: () => null, setItem: () => {} };
  global.logDebug = () => {};

  // Extract just the functions we exercise from the real app.js
  const src = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
  function extract(fnName) {
    const idx = src.indexOf('function ' + fnName + '(');
    if (idx === -1) return null;
    let depth = 0, end = idx;
    for (let i = idx; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    return depth === 0 ? src.slice(idx, end) : null;
  }
  const need = ['debounce', 'showToast', 'switchTab', 'applyTabDeepLink', 'renderWaterReportEmptyState', 'setCatchScope'];
  let code = '';
  // Bring in the top-level var showToast depends on
  {
    const m = src.match(/var TOAST_KIND_CLASS = \{[\s\S]*?\};/);
    if (m) code += m[0] + '\n';
  // CATCH_SCOPE state + stubs for the renderers setCatchScope invokes
  {
    const m = src.match(/var CATCH_SCOPE = 'yours';/);
    if (m) code += m[0] + '\n';
    code += 'function renderMyCatches() { return Promise.resolve(); }\n';
    code += 'function loadDatabase() { return Promise.resolve(); }\n';
  }

  }
  for (const n of need) {
    const e = extract(n);
    if (!e) { fail('extract ' + n, 'function not found'); return; }
    code += e + '\n';
  }
  eval(code);

  // --- debounce ---
  let calls = 0;
  const db = debounce(() => { calls++; }, 30);
  db(); db(); db();
  setTimeout(() => {
    calls === 1
      ? ok('debounce collapses burst (trailing)', `3 calls → ${calls} execution`)
      : fail('debounce collapses burst (trailing)', `${calls} executions`);

    // --- toast ---
    showToast('hello', 'info', 300);
    elements['toast-stack'] || (document.body.lastChild && document.body.lastChild.id === 'toast-stack')
      ? ok('toast renders in a role=status stack', 'toast-stack present')
      : fail('toast renders in a role=status stack', '');

    // --- deep link ---
    // applyTabDeepLink() reads window.location.search then new URLSearchParams(...).
    global.window.location = { search: '?tab=tab-gear-sim' };
    const okLink = applyTabDeepLink();
    okLink
      ? ok('?tab= deep link activates the target tab', 'tab-gear-sim')
      : fail('?tab= deep link activates the target tab', '');

    // --- switchTab ---
    switchTab('tab-catch-log');
    elements['tab-catch-log'].classList.has('tab-active')
      ? ok('switchTab adds tab-active to target', 'tab-catch-log')
      : fail('switchTab adds tab-active to target', '');

    // --- empty state ---
    renderWaterReportEmptyState('No river data', 'Try another station.', false);
    const box = elements['water-report-cards'];
    (box.innerHTML.indexOf('No river data') !== -1 && box.innerHTML.indexOf('empty-state') !== -1)
      ? ok('water report empty state renders', 'empty-state + title')
      : fail('water report empty state renders', box.innerHTML);

    // --- catch log yours/everyone toggle ---
    setCatchScope('yours');
    const yoursActive = elements['scope-yours'].classList.has('scope-active');
    const headYours = elements['catch-log-head'].innerHTML.indexOf('Species') !== -1;
    setCatchScope('everyone');
    const everyoneActive = elements['scope-everyone'].classList.has('scope-active');
    const headEveryone = elements['catch-log-head'].innerHTML.indexOf('Name') !== -1;
    (yoursActive && everyoneActive && headYours && headEveryone)
      ? ok('catch log yours/everyone toggle switches scope + headers', 'yours→Species, everyone→Name')
      : fail('catch log yours/everyone toggle switches scope + headers', '');

    // --- logData decoupled from the Gear Sim ---
    // logData() must not bail when currentStats is null (no runSim required).
    const logFn = src.slice(src.indexOf('async function logData()'));
    const logEnd = logFn.indexOf('\n}\n') + 3;
    const logBody = logFn.slice(0, logEnd);
    !/if \(!currentStats\) return;/.test(logBody)
      ? ok('logData works without runSim (no currentStats gate)', 'form-driven logging')
      : fail('logData works without runSim (no currentStats gate)', 'still gated on currentStats');

    finish(done);
  }, 80);

  function finish(done) { done(); }
}

// Runner
async function main() {
  if (!QUIET) {
    console.log('Sanity pass — Puyallup River Companion');
    console.log('======================================');
  }

  describe('Syntax');
  try {
    const jsFiles = ['src/app.js', 'src/services/supabase.js', 'src/services/water.js', 'src/utils/regulations.js', 'sw.js'];
    for (const f of jsFiles) execFileSync('node', ['--check', f], { cwd: ROOT, stdio: 'pipe' });
    ok('node --check on JS + sw.js', jsFiles.join(', '));
  } catch (e) {
    fail('node --check on JS + sw.js', String(e.message).split('\n')[0]);
  }
  try {
    execFileSync('python3', ['-m', 'py_compile', 'api/water_report.py', 'scripts/dev_server.py', 'scripts/scrape_wdfw.py', 'scripts/refresh_wdfw_forecast.py'], { cwd: ROOT, stdio: 'pipe' });
    ok('python3 -m py_compile', 'api/water_report.py, scripts/*.py');
  } catch (e) {
    fail('python3 -m py_compile', String(e.message).split('\n')[0]);
  }

  staticIntegrity();

  // Resolve a free port, then start the server on it.
  if (!PORT) {
    PORT = await new Promise((resolve, reject) => {
      const srv = require('net').createServer();
      srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
      srv.on('error', reject);
    });
  }

  let server = null;
  try {
    server = await startServer();
    await httpChecks();
    await new Promise((resolve) => behaviorChecks(resolve));
  } catch (e) {
    fail('dev server start', e.message);
  } finally {
    if (server) stopServer(server);
  }

  if (!QUIET) console.log('\n======================================');
  console.log(`PASSED ${passes} | FAILED ${failures.length}`);
  if (failures.length) {
    console.log('Failures: ' + failures.join('; '));
    process.exit(1);
  }
  console.log('Sanity pass: ALL GREEN');
  process.exit(0);
}

main();

