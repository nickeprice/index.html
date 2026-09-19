-- 2026-09-18 — Phase 2.4: second corky (Foam 2).
--
-- Some anglers run two corkies. Both are recorded (foam + foam_2) and BOTH feed
-- the buoyancy model in the Gear Sim. Idempotent, so re-running is a no-op.

alter table public.catches add column if not exists foam_2 text;
