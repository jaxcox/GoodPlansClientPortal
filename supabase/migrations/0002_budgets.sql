-- =============================================================================
-- Phase 4 — Budgets & Goals
-- One budget per (client, year). Coach + client can both edit (Doc 05 PC:
-- Budget & Goals is fully client-editable). Coach reads via tenant scope.
-- =============================================================================

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  coach_id uuid not null references coaches(id) on delete cascade,
  year int not null,

  -- Annual targets
  annual_revenue numeric,
  cogs_target_pct numeric,

  -- Monthly distribution (12 percentages summing to 100 in 'seasonal' mode;
  -- empty / null in 'even' mode means equal monthly thirds)
  season_type text not null default 'even',
  season_pct jsonb not null default '[]'::jsonb,

  -- YTD actuals — month-by-month per Doc 08 PC. Index 0 = Jan, 11 = Dec.
  ytd_thru_month int,
  ytd_revenue_by_month jsonb,
  ytd_cogs_by_month jsonb,

  -- Per-KPI goal numbers, keyed by KPI id (or custom KPI id)
  goals jsonb not null default '{}'::jsonb,

  -- Per-capacity-group goals, keyed by group id. Shape:
  --   { [groupId]: { target: number, format: '%' | '$' } }
  capacity_group_goals jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (client_id, year),
  check (year between 2000 and 2100),
  check (season_type in ('even', 'seasonal'))
);

create index if not exists idx_budgets_client_id on budgets(client_id);
create index if not exists idx_budgets_coach_id on budgets(coach_id);

alter table budgets enable row level security;

-- Coach (or super_admin) full access for their tenant ------------------------
drop policy if exists "budgets_coach_rw" on budgets;
create policy "budgets_coach_rw" on budgets
for all using (
  current_app_role() = 'super_admin'
  or coach_id = current_coach_id()
) with check (
  current_app_role() = 'super_admin'
  or coach_id = current_coach_id()
);

-- Client may read + edit their own budgets ----------------------------------
drop policy if exists "budgets_client_self_read" on budgets;
create policy "budgets_client_self_read" on budgets
for select using (client_id = current_client_id());

drop policy if exists "budgets_client_self_update" on budgets;
create policy "budgets_client_self_update" on budgets
for update using (client_id = current_client_id())
with check (client_id = current_client_id());

drop policy if exists "budgets_client_self_insert" on budgets;
create policy "budgets_client_self_insert" on budgets
for insert with check (
  client_id = current_client_id()
  and coach_id = (select coach_id from public.clients where id = current_client_id())
);

-- updated_at trigger --------------------------------------------------------
drop trigger if exists trg_budgets_updated on budgets;
create trigger trg_budgets_updated before update on budgets
  for each row execute function set_updated_at();
