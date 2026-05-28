-- =============================================================================
-- Multi-coach: manager → coach hierarchy
-- =============================================================================
-- Original model treated each coach as a fully isolated tenant. This migration
-- introduces a two-level hierarchy: a coach can have a "manager" (another
-- coach who oversees them). Managers see their direct reports AND their
-- reports' clients; they can reassign clients between themselves and their
-- reports. Reports see only their own clients — same as before.
--
-- For Jackie's case: she's the top-level manager (manager_coach_id NULL); Steve
-- is her direct report (manager_coach_id = Jackie's id). Jackie sees Steve's
-- coach row + Steve's clients; Steve sees only his own clients.
--
-- Hierarchy is intentionally one level deep for now. A coach's manager has
-- no manager themselves (NULL). If we ever need multi-level org charts the
-- RLS policies below would need to recurse — for now they only check
-- direct-report relationships.

-- 1. Add the manager column on coaches. Self-referential FK. ON DELETE
--    SET NULL so deleting a manager doesn't cascade-delete their reports.
alter table coaches
  add column if not exists manager_coach_id uuid references coaches(id) on delete set null;

create index if not exists idx_coaches_manager_coach_id on coaches(manager_coach_id);

-- 2. Coaches: a coach can read their direct reports' coach rows. The
--    existing coaches_select policy already covers reading their own row;
--    this policy adds reports.
drop policy if exists "coaches_select_reports" on coaches;
create policy "coaches_select_reports" on coaches
for select using (
  manager_coach_id = current_coach_id()
);

-- 3. Profiles: a coach can read their direct reports' coach profiles
--    (display_name etc.) so the Team tab can show names. The existing
--    profiles_self_read already covers their own profile + clients
--    assigned to them; this policy adds reports' coach profiles.
drop policy if exists "profiles_select_team" on profiles;
create policy "profiles_select_team" on profiles
for select using (
  role = 'coach'
  and coach_id in (
    select id from coaches where manager_coach_id = current_coach_id()
  )
);

-- 4. Clients: a coach can read their direct reports' clients so the
--    Clients tab can surface them under the right filter. Reports see
--    only their own clients (covered by clients_coach_select).
drop policy if exists "clients_select_reports" on clients;
create policy "clients_select_reports" on clients
for select using (
  coach_id in (
    select id from coaches where manager_coach_id = current_coach_id()
  )
);

-- 5. Clients update (manager reassigns): a coach can UPDATE a client
--    owned by one of their direct reports (e.g. to reassign back to
--    themselves or to another report). The service-role reassign-client
--    function handles this in practice (auth.uid() is null bypass), but
--    this policy lets the manager run row-level edits via the table API
--    if ever needed in the future.
drop policy if exists "clients_update_reports" on clients;
create policy "clients_update_reports" on clients
for update using (
  coach_id in (
    select id from coaches where manager_coach_id = current_coach_id()
  )
)
with check (
  coach_id = current_coach_id()
  or coach_id in (
    select id from coaches where manager_coach_id = current_coach_id()
  )
);

-- 6. One-time backfill. Pre-migration coach rows had no manager column,
--    so they're all NULL after the column add. Heuristic: within each
--    brand, the OLDEST coach is presumed the founder/manager; every
--    other coach in that brand is presumed a direct report of them.
--    Future coaches created via the add-coach Edge Function get
--    manager_coach_id set explicitly — this is a one-shot fix for
--    existing rows.
with brand_managers as (
  select distinct on (brand_name) brand_name, id
  from coaches
  where manager_coach_id is null
  order by brand_name, created_at asc
)
update coaches c
set manager_coach_id = bm.id
from brand_managers bm
where c.brand_name = bm.brand_name
  and c.manager_coach_id is null
  and c.id != bm.id;
