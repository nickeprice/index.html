# Internal Change Log

## 2026-09-17 — Phase B: catch-write fixes, environment enrichment, and feature work
Fixed the Cheater-rig insert break (dropped `corky_size`, numeric `hook_size`), captured
gauge/barometer/water-temp/wind/moon into private catch rows, and added My Catches
(edit/delete), a regulations detail panel, and rig preset persistence.
- Key files: `src/app.js`, `src/services/supabase.js`, `src/services/water.js`,
  `src/styles.css`, `index.html`, `supabase/migrations/20260917000200_catch_writes_env_columns.sql`.

## 2026-09-17 — Live DB fully migrated
Pushed all four migrations to the live Supabase project (pztcfsqifbfkjvosygcy): init_schema,
normalize_rls, catch_writes_env_columns, and set_user_id_default. Verified live: `user_id`
now defaults to `auth.uid()` (guest inserts work), `corky_size` dropped, env columns added.
- Key file: `supabase/migrations/20260917000300_set_user_id_default.sql`.
