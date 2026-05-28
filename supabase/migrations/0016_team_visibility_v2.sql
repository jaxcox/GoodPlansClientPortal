-- =============================================================================
-- Multi-coach team visibility — v2 (security definer helpers, no recursion)
-- =============================================================================
-- Migration 0015 added cross-table policies that PostgREST flagged as
-- recursive (error 42P17). The sub-queries inside the policies referenced
-- other tables whose RLS evaluation eventually looped back. Profile reads
-- on the user's own row 500'd, breaking sign-in.
--
-- This migration replaces the policies with SECURITY DEFINER helper
-- functions that encapsulate the cross-table lookups. Because the helpers
-- run as the function owner (postgres) with BYPASSRLS, sub-queries inside
-- them don't trigger the caller's RLS — no recursion. The policies
-- themselves just call the helper and get back a boolean.
--
-- Same visibility outcome as 0015 (managers see reports + reports'
-- profiles + reports' clients; reports see only their own data) but
-- evaluated without recursion.
--
-- The manager_coach_id column + backfill from 0015 stay in place. This
-- migration is additive — adds two helpers, recreates four policies.

-- 1. is_my_direct_report(coach_id) — true when the given coach_id is a
--    direct report of the caller (the caller's coach_id is set as
--    manager_coach_id on the given coach row). SECURITY DEFINER bypasses
--    RLS on the coaches sub-query.
create or replace function is_my_direct_report(target_coach_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists(
    select 1 from public.coaches
    where id = target_coach_id
      and manager_coach_id = (
        select coach_id from public.profiles where id = auth.uid()
      )
  )
$$;

-- 2. is_in_my_hierarchy(coach_id) — true when the given coach_id is
--    either the caller themselves OR one of the caller's direct reports.
--    Used by client read/update policies so a manager can see + edit
--    their own + their reports' clients.
create or replace function is_in_my_hierarchy(target_coach_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (
    select coach_id as my_id from public.profiles where id = auth.uid()
  )
  select exists(
    select 1 from me where my_id = target_coach_id
  )
  or exists(
    select 1 from public.coaches, me
    where coaches.id = target_coach_id
      and coaches.manager_coach_id = me.my_id
  )
$$;

-- 3. Recreate the team-visibility policies using the helpers. Each is
--    just `using (helper(column))` — no inline sub-queries that could
--    trigger recursion. Drops are idempotent so this migration is safe
--    to re-run.

-- Coaches: read your direct reports' coach rows.
drop policy if exists "coaches_select_reports" on coaches;
create policy "coaches_select_reports" on coaches
for select using (
  is_my_direct_report(id)
);

-- Profiles: read your direct reports' coach profiles (for display_name).
drop policy if exists "profiles_select_team" on profiles;
create policy "profiles_select_team" on profiles
for select using (
  role = 'coach'
  and is_my_direct_report(coach_id)
);

-- Clients: read clients owned by your direct reports.
drop policy if exists "clients_select_reports" on clients;
create policy "clients_select_reports" on clients
for select using (
  is_my_direct_report(coach_id)
);

-- Clients: update reports' clients (manager reassigning back to self,
--          adjusting fields the report shouldn't touch, etc.). The
--          WITH CHECK ensures the new coach_id is somewhere in the
--          caller's hierarchy (self or a report).
drop policy if exists "clients_update_reports" on clients;
create policy "clients_update_reports" on clients
for update using (
  is_my_direct_report(coach_id)
)
with check (
  is_in_my_hierarchy(coach_id)
);
