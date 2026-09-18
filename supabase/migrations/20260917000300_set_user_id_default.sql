-- ============================================================================
-- Ensure live user_id has the auth.uid() default
--
-- The initial (20260917000000) migration declared `user_id uuid not null
-- default auth.uid()` inside `create table if not exists`. On a pre-existing
-- production table the create is a no-op, so the default NEVER landed and the
-- live column stayed `not null` with no default. Anonymous guest sessions rely
-- on that default (the client sends user_id: undefined), so without it every
-- fresh catch insert fails with a not-null violation.
--
-- This sets the default idempotently; it touches no rows and cannot fail twice.
-- ============================================================================

alter table public.catches alter column user_id set default auth.uid();
