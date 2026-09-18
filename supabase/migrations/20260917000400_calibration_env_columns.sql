-- ============================================================================
-- Enrich get_global_calibration with environmental context
--
-- Adds water temperature, wind, and moon phase to the community-sonar RPC so
-- the frontend can pull the strike zone toward feeding fish using not just
-- tackle telemetry but also the conditions that correlate with where they sit.
-- Idempotent (drop then create), preserves SECURITY DEFINER + search_path,
-- and still exposes no identity or GPS columns.
-- ============================================================================

drop function if exists public.get_global_calibration(integer, text);

create function public.get_global_calibration(p_flow integer, p_species text)
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
    cast_distance_ft text,
    water_temp_f numeric,
    wind_speed_mph numeric,
    wind_dir_compass text,
    moon_phase text
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
        c.cast_distance_ft::text,
        c.water_temp_f,
        c.wind_speed_mph,
        c.wind_dir_compass,
        c.moon_phase
    from public.catches c
    where c.leader_length is not null
      and c.flow is not null
      and abs(c.flow - p_flow) <= 300
      and (p_species is null or c.species = p_species)
    -- Deterministic newest-first so the app's 8-sample window is stable run-to-run.
    order by c.catch_time desc nulls last, c.id desc
    limit 500;
$function$;

grant execute on function public.get_global_calibration(integer, text)
    to anon, authenticated, service_role;

