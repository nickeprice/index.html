-- ============================================================================
-- Puyallup River Companion - initial schema
--
-- This migration formalises the objects that ALREADY EXIST in the live project
-- (ref: pztcfsqifbfkjvosygcy). Every statement is idempotent so it can be pushed
-- onto that existing database without error, and so a fresh `supabase start`
-- builds an identical local environment.
--
-- Source of truth: live catalog introspected 2026-09-17 via pg_attribute,
-- pg_indexes, pg_get_viewdef() and pg_get_functiondef().
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- public.catches
-- Private catch records. Stores the full tackle profile + GPS; only four
-- columns are ever exposed publicly (see public_catch_feed below).
-- ----------------------------------------------------------------------------
create table if not exists public.catches (
    id                uuid                     not null default gen_random_uuid(),
    user_id           uuid                     not null,
    created_at        timestamptz              not null default timezone('utc', now()),
    species           text                     not null,
    hook_location     text,
    catch_time        timestamptz,
    latitude          double precision,
    longitude         double precision,
    angler_name       text,
    flow              integer,
    gauge_height      numeric,
    barometer         numeric,
    leader_length     integer,
    leader_material   text,
    leader_lb         integer,
    hook_size         integer,
    yarn              text,
    corky_size        integer,
    foam              text,
    weight            numeric,
    bead_material     text,
    bead_size         numeric,
    -- Legacy duplicate bead columns retained for older client builds.
    bd_mat            text,
    bd_sz             numeric,
    rod_ft            numeric,
    cast_distance_ft  numeric,
    mainline_mat      text,
    mainline_lb       numeric,
    -- Simulation outputs, stored so community sonar can replay the physics.
    line_height_in    numeric,
    zone_min_in       numeric,
    zone_max_in       numeric,
    sim_score         numeric,
    constraint catches_pkey primary key (id)
);

create index if not exists catches_catch_time_idx
    on public.catches using btree (catch_time desc);
create index if not exists catches_flow_idx
    on public.catches using btree (flow);
create index if not exists catches_species_idx
    on public.catches using btree (species);
create index if not exists catches_user_idx
    on public.catches using btree (user_id);


-- ----------------------------------------------------------------------------
-- public.public_catch_feed
-- The Brag Board view: name, time, flow and species only. Gear profiles and
-- GPS coordinates are deliberately absent so they can never leak.
--
-- IMPORTANT: this view must keep the default security_invoker = false. The view
-- owner's rights bypass RLS on public.catches, which is exactly what lets
-- anonymous visitors read the public board while their own private rows stay
-- invisible. Enabling security_invoker would break the Brag Board for
-- signed-out users.
-- ----------------------------------------------------------------------------
create or replace view public.public_catch_feed as
    select angler_name as name,
           catch_time  as "time",
           flow        as flow,
           species     as fish
      from public.catches
     where angler_name is not null;

-- ----------------------------------------------------------------------------
-- public.get_global_calibration(p_flow, p_species)
-- Community sonar feed for the physics engine. Returns the anonymised tackle
-- telemetry of catches logged near this flow (+/- 300 CFS) and species, so the
-- app can pull the strike zone toward where fish are actually feeding.
--
-- SECURITY DEFINER is intentional: it must read every angler's row, which the
-- caller's own-row RLS policy would otherwise hide. It is STABLE and returns
-- only tackle/flow columns - never angler_name, GPS or user_id.
-- ----------------------------------------------------------------------------
create or replace function public.get_global_calibration(p_flow integer, p_species text)
 returns table(
    flow integer,
    species text,
    hook_location text,
    leader_length text,
    leader_material text,
    leader_lb text,
    mainline_mat text,
    mainline_lb text,
    weight text,
    hook_size text,
    yarn text,
    foam text,
    bead_material text,
    bead_size text,
    rod_ft text,
    cast_distance_ft text
 )
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
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
$function$;

-- ----------------------------------------------------------------------------
-- Grants (mirror the live project: Data API roles can reach all three objects)
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on public.catches
    to anon, authenticated, service_role;

grant select on public.public_catch_feed
    to anon, authenticated, service_role;

grant execute on function public.get_global_calibration(integer, text)
    to anon, authenticated, service_role;

