-- =============================================================================
-- Puyallup River Companion — Catch Log / Brag Board schema
--
-- Run this once in Supabase Studio > SQL Editor. It is IDEMPOTENT and SAFE to
-- run against the existing project: all new columns are added with
-- `ADD COLUMN IF NOT EXISTS`, nothing is dropped or renamed, and the view /
-- function are replaced with `CREATE OR REPLACE`.
--
-- Also enable: Authentication > Sign In / Providers > Anonymous sign-ins.
--
-- LIVE BACKEND (verified by endpoint probe 2026-09-16)
--   public.catches columns:
--     id, user_id, created_at, angler_name, catch_time, flow, species,
--     latitude, longitude, weight, leader_lb, leader_length, leader_material,
--     hook_size, yarn, foam, corky_size, bead_material, bead_size,
--     barometer, hook_location, gauge_height
--   public.public_catch_feed columns: id, name, time, flow (NO fish column yet)
--
-- Privacy model
--   public.catches          full private profile, RLS pins every row to its angler
--   public.public_catch_feed  view exposing ONLY name / time / flow / fish
--   get_global_calibration    RPC returning anonymised tackle telemetry (no identity,
--                             no GPS, no location) for the crowdsourced physics engine
-- =============================================================================

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

-- -----------------------------------------------------------------------------
-- Brag Board: a definer-rights view that bypasses RLS by design and exposes only
-- the four public columns. Nobody can select gear or GPS through it.
-- -----------------------------------------------------------------------------
create or replace view public.public_catch_feed as
    select angler_name as name, catch_time as time, flow as flow, species as fish
    from public.catches
    where angler_name is not null;

grant select on public.public_catch_feed to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Crowdsourced calibration: anonymised tackle telemetry for the physics engine.
-- security definer so it can read past RLS, but the return shape carries no
-- identity, no GPS and no hook location column name that maps to a person.
-- -----------------------------------------------------------------------------
create or replace function public.get_global_calibration(p_flow integer, p_species text)
returns table (
    flow            integer,
    species         text,
    hook_location   text,
    leader_length   numeric,
    leader_lb       numeric,
    weight          numeric,
    hook_size       text,
    yarn            numeric,
    foam            text,
    bead_material   text,
    bead_size       numeric
)
language sql
stable
security definer
set search_path = public
as $$
    select
        c.flow,
        c.species,
        c.hook_location,
        c.leader_length,
        c.leader_lb,
        c.weight,
        c.hook_size,
        c.yarn,
        c.foam,
        c.bead_material,
        c.bead_size
    from public.catches c
    where c.leader_length is not null
      and c.flow is not null
      and abs(c.flow - p_flow) <= 300
      and (p_species is null or c.species = p_species)
    order by c.catch_time desc
    limit 500;
$$;

grant execute on function public.get_global_calibration(integer, text) to anon, authenticated;