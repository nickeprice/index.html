-- 2026-09-18 — Backfill river_name on the surviving sample catch.
--
-- The kept 2026-09-17T13:30Z "Nick · Coho · 984 CFS" sample predates the
-- river_name column (added in 20260918000200), so its river showed "--".
-- The angler confirmed this catch was on the Puyallup River.
--
-- Idempotent: guarded by `river_name is null`, so re-running is a no-op and it
-- can never overwrite a real value.

update public.catches
   set river_name = 'Puyallup River'
 where id = '141d8fbf-5bdd-475c-8112-67508a706937'
   and river_name is null;
