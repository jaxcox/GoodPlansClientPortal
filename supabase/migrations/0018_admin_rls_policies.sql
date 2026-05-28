-- =============================================================================
-- Admin-scope RLS policies (Phase B of the role overhaul)
-- =============================================================================
-- Layers admin-tier visibility + write rights on top of the existing
-- per-coach and per-manager policies from 0015 / 0016. Admin policies are
-- additive — they grant access in addition to existing policies. A coach
-- who is BOTH a manager AND admin matches both sets, which is fine
-- (Postgres RLS combines policies with OR for SELECT and with AND of any
-- matching USING for UPDATE — both forms produce the right answer here).
--
-- Helpers used: `is_admin_self()`, `is_in_my_brand(uuid)` from 0017.
--
-- Tables touched: coaches, profiles, clients, industries.
-- Nothing dropped, nothing renamed — purely additive.

-- ----------------------------------------------------------------------------
-- COACHES — admin can see + update any coach in their brand
-- ----------------------------------------------------------------------------
drop policy if exists "coaches_select_admin_brand" on coaches;
create policy "coaches_select_admin_brand" on coaches
for select using (
  is_admin_self() and is_in_my_brand(id)
);

drop policy if exists "coaches_update_admin_brand" on coaches;
create policy "coaches_update_admin_brand" on coaches
for update using (
  is_admin_self() and is_in_my_brand(id)
)
with check (
  is_admin_self() and is_in_my_brand(id)
);

-- ----------------------------------------------------------------------------
-- PROFILES — admin can see (and rename via display_name) any coach
--            profile in their brand. Client profiles are NOT exposed by
--            this policy; admins reach clients via the clients table.
-- ----------------------------------------------------------------------------
drop policy if exists "profiles_select_admin_brand" on profiles;
create policy "profiles_select_admin_brand" on profiles
for select using (
  is_admin_self()
  and role = 'coach'
  and coach_id is not null
  and is_in_my_brand(coach_id)
);

drop policy if exists "profiles_update_admin_brand" on profiles;
create policy "profiles_update_admin_brand" on profiles
for update using (
  is_admin_self()
  and role = 'coach'
  and coach_id is not null
  and is_in_my_brand(coach_id)
)
with check (
  is_admin_self()
  and role = 'coach'
  and coach_id is not null
  and is_in_my_brand(coach_id)
);

-- ----------------------------------------------------------------------------
-- CLIENTS — admin sees + can update + can archive + can reassign any
--           client in their brand. Insert is left to Edge Functions
--           (they use service role, bypassing RLS) — no client-side
--           insert policy because the create-client flow lives in code
--           that already runs through the function pipeline.
-- ----------------------------------------------------------------------------
drop policy if exists "clients_select_admin_brand" on clients;
create policy "clients_select_admin_brand" on clients
for select using (
  is_admin_self() and is_in_my_brand(coach_id)
);

drop policy if exists "clients_update_admin_brand" on clients;
create policy "clients_update_admin_brand" on clients
for update using (
  is_admin_self() and is_in_my_brand(coach_id)
)
with check (
  is_admin_self() and is_in_my_brand(coach_id)
);

-- ----------------------------------------------------------------------------
-- INDUSTRIES — admin can write industries in their brand. Phase D moves
--              industries to brand-shared storage (brand_owner_coach_id);
--              for now the existing coach_id scoping stays. This policy
--              lets an admin write any industry whose owner is in their
--              brand, which works under either scoping model.
-- ----------------------------------------------------------------------------
drop policy if exists "industries_select_admin_brand" on industries;
create policy "industries_select_admin_brand" on industries
for select using (
  is_admin_self() and is_in_my_brand(coach_id)
);

drop policy if exists "industries_insert_admin_brand" on industries;
create policy "industries_insert_admin_brand" on industries
for insert with check (
  is_admin_self() and is_in_my_brand(coach_id)
);

drop policy if exists "industries_update_admin_brand" on industries;
create policy "industries_update_admin_brand" on industries
for update using (
  is_admin_self() and is_in_my_brand(coach_id)
)
with check (
  is_admin_self() and is_in_my_brand(coach_id)
);

drop policy if exists "industries_delete_admin_brand" on industries;
create policy "industries_delete_admin_brand" on industries
for delete using (
  is_admin_self() and is_in_my_brand(coach_id)
);
