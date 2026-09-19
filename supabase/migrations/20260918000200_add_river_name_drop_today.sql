-- 2026-09-18 — Phase 2.3: add river_name for the public board, drop today's test row.
--
-- 1) public.catches gains a coarse river_name ("Puyallup River", "Carbon River",
--    "Green River", "Nisqually River", "White River") derived at log time from
--    the active station/GPS. Raw lat/lon stays private per RLS.
--
-- 2) public_catch_feed now exposes name / time / river / fish (the "Flow"
--    column is removed from the PUBLIC view; it is still a private column).
--    NOTE: CREATE OR REPLACE VIEW cannot rename an existing column
--    (SQLSTATE 42P16), so the view is DROPPED and recreated — the same pattern
--    documented in src/services/schema.sql.
--
-- 3) Deletes the stray 2026-09-18T14:38Z "Nick · Coho · flow 1050" row the
--    angler did NOT record. Idempotent (exact PK match).

alter table public.catches add column if not exists river_name text;

drop view if exists public.public_catch_feed;

create view public.public_catch_feed as
    select angler_name as name,
           catch_time  as "time",
           river_name  as river,
           species     as fish
      from public.catches
     where angler_name is not null;

grant select on public.public_catch_feed to anon, authenticated;

delete from public.catches
 where id = '16b6b989-365f-4bcb-b0cf-4db0e4f12c85';
