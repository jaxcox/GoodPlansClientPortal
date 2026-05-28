-- =============================================================================
-- Industries become brand-shared (Phase D of the role overhaul)
-- =============================================================================
-- Industries were originally coach-scoped: each coach owned their own list,
-- and reassigning a client to another coach in the same brand had to COPY
-- the client's industry to the target coach to keep the link valid.
--
-- The new model: industries belong to the BRAND. All coaches in the brand
-- read the same list. Only Admins can write (per the role overhaul spec).
-- Reassigning a client no longer copies industries — the brand-scoped row
-- stays the same, and any coach in the brand can read it.
--
-- This migration:
--   1. Adds industries.brand_owner_coach_id (FK → coaches.id)
--   2. Backfills it by walking each industry's coach_id up the
--      manager_coach_id chain to the brand owner
--   3. Drops the old industries RLS policies (coach-scoped + the
--      admin-brand policies from 0018 that still used coach_id)
--   4. Adds new policies: SELECT for anyone in the brand;
--      INSERT/UPDATE/DELETE for admins in the brand
--   5. Adds NOT NULL + FK + index after backfill
--
-- The legacy `coach_id` column is left in place for now (it tells you
-- which coach originally created the row — handy historic info). A future
-- cleanup can drop it if it proves redundant.
--
-- Reassign-client Edge Function updates separately to stop copying
-- industries (the copy logic becomes dead code).

-- 1. Add column (nullable initially so backfill can fill it)
alter table industries
  add column if not exists brand_owner_coach_id uuid;

-- 2. Backfill by walking each industry's coach_id up to the brand owner.
--    Recursive CTE: start at the industry's owning coach, follow
--    manager_coach_id up until manager_coach_id is null (the root).
with recursive chain as (
  select
    i.id as industry_id,
    c.id as cur_coach_id,
    c.manager_coach_id
  from public.industries i
  join public.coaches c on c.id = i.coach_id
  where i.brand_owner_coach_id is null
  union all
  select
    ch.industry_id,
    c.id,
    c.manager_coach_id
  from chain ch
  join public.coaches c on c.id = ch.manager_coach_id
)
update public.industries i
   set brand_owner_coach_id = ch.cur_coach_id
  from chain ch
 where i.id = ch.industry_id
   and ch.manager_coach_id is null
   and i.brand_owner_coach_id is null;

-- 3. Drop ALL existing policies on industries. We're replacing the full
--    set (originals + 0018 admin-brand ones) with the brand-shared model.
--    DO block walks pg_policies so we don't have to guess at every name
--    that ever lived here.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'industries'
  loop
    execute format('drop policy if exists %I on industries', pol.policyname);
  end loop;
end $$;

-- 4. New policies. SELECT for any coach in the brand; INSERT / UPDATE /
--    DELETE for admins only, scoped to their own brand. Uses the
--    is_admin_self + is_in_my_brand helpers from 0017.

create policy "industries_select_brand" on industries
for select using (
  is_in_my_brand(brand_owner_coach_id)
);

create policy "industries_insert_brand_admin" on industries
for insert with check (
  is_admin_self() and is_in_my_brand(brand_owner_coach_id)
);

create policy "industries_update_brand_admin" on industries
for update using (
  is_admin_self() and is_in_my_brand(brand_owner_coach_id)
)
with check (
  is_admin_self() and is_in_my_brand(brand_owner_coach_id)
);

create policy "industries_delete_brand_admin" on industries
for delete using (
  is_admin_self() and is_in_my_brand(brand_owner_coach_id)
);

-- 5. Constraints + index AFTER backfill — would fail if any rows still
--    had a null brand_owner_coach_id. The backfill above is idempotent
--    so re-running this migration is safe.
alter table public.industries
  alter column brand_owner_coach_id set not null;

-- FK + cascade so removing a brand owner takes their industries with
-- them. The brand owner can't be removed today (remove-coach blocks
-- removing themselves and brand owners have no manager to be a report
-- to), so this is defensive.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'industries_brand_owner_coach_id_fkey'
  ) then
    alter table public.industries
      add constraint industries_brand_owner_coach_id_fkey
      foreign key (brand_owner_coach_id) references public.coaches(id)
      on delete cascade;
  end if;
end $$;

create index if not exists idx_industries_brand_owner
  on public.industries(brand_owner_coach_id);
