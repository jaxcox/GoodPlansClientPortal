-- =============================================================================
-- Phase 5 — Weekly Entries
-- One row per (client, week_start_date). Holds the actuals that map to KPI
-- goals on the budget plus capacity-group actuals.
--
-- Week convention: Sunday-start, Sat-end (US). week_start_date is always
-- the Sunday of the week the entry covers.
--
-- kpi_values is keyed by KPI id (standard or custom). Auto-derived KPIs
-- (closeRate, avgEstimateValue, etc.) are NOT stored — they're computed
-- from inputs at read time.
--
-- capacity_values is keyed by capacity_group id. Shape per group depends on
-- the group's tracking method (lives on clients.capacity_groups). Examples:
--   manual:    { utilizationPct: number }
--   slots:     { slotsFilled: number, totalSlots: number }
--   labor:     { producedHours: number }   (working hours come from the group def)
--   revenue:   { revenueProduced: number }
--   headcount: { departments: { [deptId]: { hoursWorked: number } } }
-- =============================================================================

create table if not exists weekly_entries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  coach_id uuid not null references coaches(id) on delete cascade,

  -- Sunday of the week this entry covers
  week_start_date date not null,

  -- Per-KPI actuals (input KPIs only), keyed by KPI id or custom KPI id
  kpi_values jsonb not null default '{}'::jsonb,

  -- Per-capacity-group actuals, keyed by capacity group id
  capacity_values jsonb not null default '{}'::jsonb,

  -- Free-form notes the coach / client can leave for the week
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (client_id, week_start_date)
);

create index if not exists idx_weekly_entries_client_week
  on weekly_entries(client_id, week_start_date desc);
create index if not exists idx_weekly_entries_coach_id
  on weekly_entries(coach_id);

alter table weekly_entries enable row level security;

-- Coach (or super_admin) full access for their tenant ------------------------
drop policy if exists "weekly_entries_coach_rw" on weekly_entries;
create policy "weekly_entries_coach_rw" on weekly_entries
for all using (
  current_app_role() = 'super_admin'
  or coach_id = current_coach_id()
) with check (
  current_app_role() = 'super_admin'
  or coach_id = current_coach_id()
);

-- Client may read + edit their own entries ----------------------------------
drop policy if exists "weekly_entries_client_self_read" on weekly_entries;
create policy "weekly_entries_client_self_read" on weekly_entries
for select using (client_id = current_client_id());

drop policy if exists "weekly_entries_client_self_update" on weekly_entries;
create policy "weekly_entries_client_self_update" on weekly_entries
for update using (client_id = current_client_id())
with check (client_id = current_client_id());

drop policy if exists "weekly_entries_client_self_insert" on weekly_entries;
create policy "weekly_entries_client_self_insert" on weekly_entries
for insert with check (
  client_id = current_client_id()
  and coach_id = (select coach_id from public.clients where id = current_client_id())
);

-- updated_at trigger --------------------------------------------------------
drop trigger if exists trg_weekly_entries_updated on weekly_entries;
create trigger trg_weekly_entries_updated before update on weekly_entries
  for each row execute function set_updated_at();
