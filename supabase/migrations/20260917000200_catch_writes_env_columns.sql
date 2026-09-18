-- ============================================================================
-- Catch-write type fix + environmental context columns
--
-- 1. Drop the redundant `corky_size` integer mirror. The client wrote
--    `payload.foam` (the string form, e.g. 'c12' for a Cheater rig) into it,
--    which Postgres rejects ("invalid input syntax for type integer"), breaking
--    catch inserts for any non-numeric foam. `foam` already stores the true
--    value, and nothing reads the integer copy, so removing it is safe and
--    fixes the write path in the same migration.
--
-- 2. Add live environmental context so each private catch row records what the
--    water/weather were actually doing at log time, turning the community sonar
--    (get_global_calibration) into a richer training set.
-- ============================================================================

alter table public.catches drop column if exists corky_size;

alter table public.catches add column if not exists water_temp_f      numeric;
alter table public.catches add column if not exists wind_speed_mph    numeric;
alter table public.catches add column if not exists wind_dir_compass  text;
alter table public.catches add column if not exists moon_phase        text;
