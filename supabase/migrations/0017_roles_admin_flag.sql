-- =============================================================================
-- Roles + Admin flag + brand info columns (Phase A of the role overhaul)
-- =============================================================================
-- Splits the implicit "Manager (top of hierarchy) / Coach (report)" model
-- into explicit fields so we can:
--   1. Layer an `is_admin` capability on top of the role (admin = a flag,
--      anyone in the brand can have it, multiple admins allowed)
--   2. Let a coach be a Manager (role='manager') without being Admin, and
--      let a non-Manager coach be Admin too
--   3. Hang brand-level info (address, phone, website) off the brand
--      owner's row alongside the existing brand_name + brand_logo_url
--
-- Locked-in spec (per Jackie):
--   Admin (flag) — add clients, archive clients, add/remove/update coaches,
--                  edit company + brand info, create/edit industries,
--                  + Manager + Coach rights
--   Manager     — view team's info + clients, reassign clients, update
--                 client KPIs, edit own info, + Coach rights
--   Coach       — see own clients, update own clients' KPIs, edit own info
--
-- This migration is purely ADDITIVE. It adds columns + backfills + helper
-- functions, but does NOT touch existing RLS policies. Phase B wires the
-- helpers into policies + UI gating; without B, all existing behavior is
-- unchanged.

-- 1. Add explicit role + admin flag + personal phone to coaches.
-- ----------------------------------------------------------------------------
alter table coaches
  add column if not exists role text not null default 'coach'
    check (role in ('coach', 'manager')),
  add column if not exists is_admin boolean not null default false,
  add column if not exists phone text;

-- 2. Add brand-level company info columns. These live on the brand-owner
--    coach (the root of the manager_coach_id chain) — Phase E wires the
--    "read from owner" pattern. Nullable; no DB-level enforcement that
--    they only live on the owner row (RLS handles writes in Phase B).
-- ----------------------------------------------------------------------------
alter table coaches
  add column if not exists brand_address text,
  add column if not exists brand_phone text,
  add column if not exists brand_website text;

-- 3. Backfill. Every existing coach with no manager (top of hierarchy)
--    becomes role='manager' AND is_admin=true. They were already the
--    de-facto manager + admin under the old model; we just make it
--    explicit. All reports stay role='coach' / is_admin=false.
-- ----------------------------------------------------------------------------
update coaches
   set role = 'manager',
       is_admin = true
 where manager_coach_id is null
   and (role <> 'manager' or is_admin <> true);

-- 4. Helper functions for RLS + UI use (SECURITY DEFINER so they bypass
--    the caller's RLS on the inner queries — same recursion-avoidance
--    pattern as the helpers in migration 0016).
-- ----------------------------------------------------------------------------

-- is_admin_self() — true if the calling user is an admin. Used to gate
-- writes that admins can do anywhere in their brand. Returns false for
-- non-coach auth users (clients) so they can't accidentally pass admin
-- checks.
create or replace function is_admin_self()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists(
    select 1
      from public.coaches c
      join public.profiles p on p.coach_id = c.id
     where p.id = auth.uid()
       and p.role = 'coach'
       and c.is_admin = true
  )
$$;

-- is_manager_self() — true if the calling user is a manager. Doesn't
-- imply admin (manager is the team-reporting role, admin is the
-- editing-rights flag). Returns false for clients.
create or replace function is_manager_self()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists(
    select 1
      from public.coaches c
      join public.profiles p on p.coach_id = c.id
     where p.id = auth.uid()
       and p.role = 'coach'
       and c.role = 'manager'
  )
$$;

-- my_brand_owner_id() — returns the coach_id of the brand owner (the
-- root of the manager_coach_id chain) for the calling user. Used to
-- scope "everyone in my brand" lookups for admins.
--
-- Walk: start from my coach row → follow manager_coach_id up until null.
-- For the current 2-level hierarchy (Manager + reports), one step
-- suffices, but the recursive form makes this future-proof.
create or replace function my_brand_owner_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive chain as (
    select c.id, c.manager_coach_id
      from public.coaches c
      join public.profiles p on p.coach_id = c.id
     where p.id = auth.uid()
       and p.role = 'coach'
    union all
    select c.id, c.manager_coach_id
      from public.coaches c
      join chain ch on ch.manager_coach_id = c.id
  )
  select id from chain where manager_coach_id is null limit 1
$$;

-- is_in_my_brand(coach_id) — true when the given coach belongs to the
-- caller's brand (same brand-owner root). Used by admin-scope read
-- policies in Phase B: "admin sees all coaches in their brand."
create or replace function is_in_my_brand(target_coach_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with owner as (
    select my_brand_owner_id() as oid
  ),
  target_owner as (
    -- Compute brand owner of target_coach_id by walking up its chain
    with recursive chain as (
      select id, manager_coach_id
        from public.coaches
       where id = target_coach_id
      union all
      select c.id, c.manager_coach_id
        from public.coaches c
        join chain ch on ch.manager_coach_id = c.id
    )
    select id from chain where manager_coach_id is null limit 1
  )
  select exists(
    select 1 from owner, target_owner
     where owner.oid is not null
       and target_owner.id is not null
       and owner.oid = target_owner.id
  )
$$;
