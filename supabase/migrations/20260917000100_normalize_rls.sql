-- ============================================================================
-- Normalise RLS policies on public.catches
--
-- The live database had accumulated FIVE overlapping policies in two naming
-- generations:
--
--   "Users can view own catches"     SELECT  TO public         USING (auth.uid() = user_id)
--   "Users can insert own catches"   INSERT  TO public         WITH CHECK (auth.uid() = user_id)
--   "Users can delete own catches"   DELETE  TO public         USING (auth.uid() = user_id)
--   "catches_select_own"             SELECT  TO authenticated  USING (user_id = auth.uid())
--   "catches_insert_own"             INSERT  TO authenticated  WITH CHECK (user_id = auth.uid())
--
-- Because permissive policies are OR'd together, the duplicates were harmless
-- but confusing: two policies guarded the same command, and the DELETE case had
-- no canonical counterpart at all.
--
-- This migration replaces all five with exactly ONE policy per command, in a
-- single snake_case naming convention. It is behaviour-preserving:
--
--   * `TO public` expands to anon + authenticated + service_role + postgres.
--     service_role has BYPASSRLS and postgres is the superuser, so neither is
--     affected by dropping the legacy rows. That leaves anon + authenticated,
--     which is exactly what the replacement policies grant.
--   * Guest sessions created by Supabase anonymous sign-in carry the
--     `authenticated` role (JWT claim is_anonymous = true), so they keep full
--     read/write access to their own rows.
--   * auth.uid() is NULL for the anon role, and `user_id = NULL` is never true,
--     so signed-out visitors still cannot read or write private catches. They
--     reach the Brag Board through public_catch_feed instead.
--
-- Both statements run inside the migration transaction, so there is no window
-- where the table is unguarded or unreachable.
-- ============================================================================

-- 1. Drop every legacy and duplicate policy (idempotent).
drop policy if exists "Users can view own catches"   on public.catches;
drop policy if exists "Users can insert own catches" on public.catches;
drop policy if exists "Users can delete own catches" on public.catches;
drop policy if exists "catches_select_own"           on public.catches;
drop policy if exists "catches_insert_own"           on public.catches;
drop policy if exists "catches_update_own"           on public.catches;
drop policy if exists "catches_delete_own"           on public.catches;

-- 2. Re-create one canonical policy per command.
create policy "catches_select_own" on public.catches
    for select
    to anon, authenticated
    using (user_id = auth.uid());

create policy "catches_insert_own" on public.catches
    for insert
    to anon, authenticated
    with check (user_id = auth.uid());

create policy "catches_update_own" on public.catches
    for update
    to anon, authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

create policy "catches_delete_own" on public.catches
    for delete
    to anon, authenticated
    using (user_id = auth.uid());
