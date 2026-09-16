-- ============================================================================
-- Puyallup River Companion — Catch Log / Brag Board schema
--
-- Run this once in Supabase Studio > SQL Editor. It is IDEMPOTENT and SAFE to
-- re-run: columns use `ADD COLUMN IF NOT EXISTS`, policies are dropped first,
-- and the view / function are dropped before create (Postgres error 42P16 /
-- 42P13: CREATE OR REPLACE cannot drop a column or change a return type).
--
-- Also enable: Authentication > Sign In / Providers > Anonymous sign-ins.
--
-- LIVE BACKEND (verified 2026-09-16, both endpoints HTTP 200 [])
--   public.catches columns include text-typed tackle fields (yarn etc. stored
--   as text like '1/2" yarn' — hence the ::text casts in the RPC below).
--   public.public_catch_feed columns: name, time, flow, fish
--
-- Privacy model
--   public.catches          full private profile, RLS pins every row to its angler
--   public.public_catch_feed  view exposing ONLY name / time / flow / fish
--   get_global_calibration    RPC returning anonymised tackle telemetry (no identity,
--                             no GPS) for the crowdsourced physics engine
-- ============================================================================

create table if not exists public.catches (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid not null default auth.uid(),
    created_at       timestamptz not null default now(),

    -- public Brag Board columns
    angler_name      text,
    catch_time       timestamptz,
    flow             integer,
    species          text,

    -- private: location
    hook_location    text,
    latitude         numeric,
    longitude        numeric,

    -- private: full tackle profile (what the physics engine trains on)
    leader_length    numeric,
    leader_material  text,
    leader_lb        numeric,
    hook_size        text,
    yarn             numeric,
    foam             text,
    corky_size       text,
    bead_material    text,
    bead_size        numeric,
    weight           numeric,          -- lead weight, oz

    -- environmental context
    barometer        numeric,
    gauge_height     numeric
);

-- --- columns the deployed table does not have yet (nullable: safe to add) ---
alter table public.catches add column if not exists rod_ft           numeric;
alter table public.catches add column if not exists cast_distance_ft numeric;
alter table public.catches add column if not exists mainline_mat     text;
alter table public.catches add column if not exists mainline_lb      numeric;
alter table public.catches add column if not exists line_height_in   numeric;
alter table public.catches add column if not exists zone_min_in      numeric;
alter table public.catches add column if not exists zone_max_in      numeric;
alter table public.catches add column if not exists sim_score        numeric;

create index if not exists catches_catch_time_idx on public.catches (catch_time desc);
create index if not exists catches_flow_idx       on public.catches (flow);
create index if not exists catches_species_idx    on public.catches (species);
create index if not exists catches_user_idx       on public.catches (user_id);

-- -----------------------------------------------------------------------------
-- Row Level Security: an angler can write and read only their own rows.
-- Anonymous sessions are real users (role 'authenticated'), so the insert policy
-- works for guests while still pinning user_id = auth.uid().
-- -----------------------------------------------------------------------------
alter table public.catches enable row level security;

drop policy if exists "catches_insert_own" on public.catches;
create policy "catches_insert_own"
    on public.catches for insert
    to anon, authenticated
    with check (user_id = auth.uid());

drop policy if exists "catches_select_own" on public.catches;
create policy "catches_select_own"
    on public.catches for select
    to authenticated
    using (user_id = auth.uid());

-- FIX for 42P16: DROP first — CREATE OR REPLACE cannot drop the old `id`
-- column from a previously deployed version of this view.
DROP VIEW IF EXISTS public.public_catch_feed;
CREATE VIEW public.public_catch_feed as
    select angler_name as name, catch_time as time, flow as flow, species as fish
    from public.catches
    where angler_name is not null;

grant select on public.public_catch_feed to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Crowdsourced calibration: anonymised tackle telemetry for the physics engine.
-- security definer so it can read past RLS, but the return shape carries no
-- identity and no GPS.
--
-- FIX for 42P13: DROP first — CREATE OR REPLACE cannot change a return type.
-- All tackle columns are text with explicit ::text casts because the deployed
-- catches table stores values like yarn as text, not numeric.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_global_calibration(integer, text);
create function public.get_global_calibration(p_flow integer, p_species text)
returns table (
    flow            integer,
    species         text,
    hook_location   text,
    leader_length   text,
    leader_material text,
    leader_lb       text,
    mainline_mat    text,
    mainline_lb     text,
    weight          text,
    hook_size       text,
    yarn            text,
    foam            text,
    bead_material   text,
    bead_size       text,
    rod_ft          text,
    cast_distance_ft text
)
language sql
stable
security definer
set search_path = public
as $$
    select
        c.flow::integer,
        c.species::text,
        c.hook_location::text,
        c.leader_length::text,
        c.leader_material::text,
        c.leader_lb::text,
        c.mainline_mat::text,
        c.mainline_lb::text,
        c.weight::text,
        c.hook_size::text,
        c.yarn::text,
        c.foam::text,
        c.bead_material::text,
        c.bead_size::text,
        c.rod_ft::text,
        c.cast_distance_ft::text
    from public.catches c
    where c.leader_length is not null
      and c.flow is not null
      and abs(c.flow - p_flow) <= 300
      and (p_species is null or c.species = p_species)
    -- Deterministic newest-first so the app's 8-sample window is stable run-to-run.
    order by c.catch_time desc nulls last, c.id desc
    limit 500;
$$;

grant execute on function public.get_global_calibration(integer, text) to anon, authenticated;

-- Force PostgREST to pick up the new view / function immediately.
NOTIFY pgrst, 'reload schema';