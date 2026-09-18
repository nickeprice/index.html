# Copilot Instructions

This repository is the Puyallup River Companion, a no-build, mobile-first PWA. Read `AGENTS.md` and `.clinerules` before making changes.

## Architecture

- Use plain HTML/CSS/classic JavaScript. Do not add a framework, bundler, package manager, or ES-module imports without an explicit request.
- Preserve the script order in `index.html`: Supabase SDK, regulations utilities/data, `src/services/supabase.js`, `src/services/water.js`, then `src/app.js` last.
- Keep shared state and functions compatible with the existing global-scope design.
- Keep Gear Sim and Catch Log duplicate controls synchronized.
- Preserve PWA behavior in `sw.js`, including network-first navigation/API behavior, stale-while-revalidate static assets, tap-to-apply updates, and offline catch buffering.

## Safety and privacy

- Supabase is optional at runtime. Preserve local/offline fallbacks when remote services fail.
- Keep GPS, tackle details, user IDs, and private catch rows out of public feed responses and debug output.
- Keep RLS enabled on `public.catches`. Add schema changes only as idempotent migrations under `supabase/migrations/`.
- Never commit service-role credentials or access tokens. The browser Supabase key is publishable configuration, not a reason to add more credentials.
- Use DOM APIs or `textContent` for external/user-controlled strings; avoid unsanitized `innerHTML`.

## Validation

There is no build step or committed test runner. For JavaScript changes run:

```bash
find src -name '*.js' -print0 | xargs -0 -n1 node --check
node --check sw.js
```

For Python changes run:

```bash
python3 -m py_compile api/water_report.py scripts/dev_server.py scripts/scrape_wdfw.py
```

For browser-facing changes, start `python3 scripts/dev_server.py 8000` and check `http://127.0.0.1:8000/index.html`, including the affected tab, page errors, accessibility behavior, and offline behavior when relevant.

Keep edits small, preserve existing user changes, and do not rewrite unrelated files.