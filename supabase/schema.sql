-- =============================================================================
-- The Good Plans Co — Client Performance Portal
-- Phase 1 schema: multi-tenant foundation
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- =============================================================================

-- Required for gen_random_uuid()
create extension if not exists pgcrypto;

-- =============================================================================
-- ENUMS
-- =============================================================================

do $$ begin
  create type user_role as enum ('super_admin', 'coach', 'client');
exception
  when duplicate_object then null;
end $$;

-- =============================================================================
-- TABLES
-- =============================================================================

-- coaches: the tenant. One row per coach who runs their own portal.
-- Brand fields here drive every coach-facing surface (top bar, footer, emails).
create table if not exists coaches (
  id uuid primary key default gen_random_uuid(),
  brand_name text not null,
  brand_logo_url text,
  brand_primary_color text default '#FFF200',
  brand_footer_text text,
  support_email text,
  from_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- industries: coach-defined. Each industry belongs to exactly one coach.
-- KPI defaults are stored as JSON keyed by KPI id.
create table if not exists industries (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references coaches(id) on delete cascade,
  name text not null,
  kpi_defaults jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_industries_coach_id on industries(coach_id);

-- clients: belongs to a coach. The client's auth user (if activated) is
-- separately tracked so a client login lands them on their own record.
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references coaches(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  industry_id uuid references industries(id) on delete set null,

  company_name text not null,
  contact_name text,
  email text,
  shared_folder_link text,

  invite_code text,
  invite_code_expires_at timestamptz,
  reset_code text,
  reset_code_expires_at timestamptz,

  activated boolean not null default false,
  archived boolean not null default false,

  -- Per-client structure (populated in later phases)
  kpis jsonb not null default '{}'::jsonb,
  custom_kpis jsonb not null default '[]'::jsonb,
  capacity_groups jsonb not null default '[]'::jsonb,
  dashboard_order jsonb,
  coach_note text,
  coach_note_updated_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clients_coach_id on clients(coach_id);
create index if not exists idx_clients_auth_user_id on clients(auth_user_id);

-- profiles: links a Supabase auth user to a role + (for coaches/clients)
-- the coach tenant they belong to. RLS reads from this table.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null,
  coach_id uuid references coaches(id) on delete cascade,
  client_id uuid references clients(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_coach_id on profiles(coach_id);
create index if not exists idx_profiles_client_id on profiles(client_id);

-- =============================================================================
-- HELPER FUNCTIONS — used by RLS policies and app code
-- =============================================================================

create or replace function current_app_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role::text from public.profiles where id = auth.uid()
$$;

create or replace function current_coach_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coach_id from public.profiles where id = auth.uid()
$$;

create or replace function current_client_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select client_id from public.profiles where id = auth.uid()
$$;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
-- Pattern:
--   super_admin → access everything (cross-tenant management)
--   coach       → access only their own coach record + their clients/industries
--   client      → access only their own client record (and later, their entries)

alter table coaches enable row level security;
alter table industries enable row level security;
alter table clients enable row level security;
alter table profiles enable row level security;

-- coaches policies ------------------------------------------------------------
drop policy if exists "coaches_select" on coaches;
create policy "coaches_select" on coaches
for select using (
  current_app_role() = 'super_admin'
  or id = current_coach_id()
  or id = (select coach_id from public.clients where id = current_client_id())
);

drop policy if exists "coaches_update_self" on coaches;
create policy "coaches_update_self" on coaches
for update using (
  current_app_role() = 'super_admin'
  or id = current_coach_id()
);

drop policy if exists "coaches_insert_admin" on coaches;
create policy "coaches_insert_admin" on coaches
for insert with check (current_app_role() = 'super_admin');

-- industries policies ---------------------------------------------------------
drop policy if exists "industries_coach_rw" on industries;
create policy "industries_coach_rw" on industries
for all using (
  current_app_role() = 'super_admin'
  or coach_id = current_coach_id()
) with check (
  current_app_role() = 'super_admin'
  or coach_id = current_coach_id()
);

drop policy if exists "industries_client_read" on industries;
create policy "industries_client_read" on industries
for select using (
  coach_id = (select coach_id from public.clients where id = current_client_id())
);

-- clients policies ------------------------------------------------------------
drop policy if exists "clients_coach_rw" on clients;
create policy "clients_coach_rw" on clients
for all using (
  current_app_role() = 'super_admin'
  or coach_id = current_coach_id()
) with check (
  current_app_role() = 'super_admin'
  or coach_id = current_coach_id()
);

drop policy if exists "clients_client_self" on clients;
create policy "clients_client_self" on clients
for select using (id = current_client_id());

drop policy if exists "clients_client_update_self" on clients;
create policy "clients_client_update_self" on clients
for update using (id = current_client_id());

-- profiles policies -----------------------------------------------------------
drop policy if exists "profiles_self_read" on profiles;
create policy "profiles_self_read" on profiles
for select using (
  id = auth.uid()
  or current_app_role() = 'super_admin'
  or (current_app_role() = 'coach' and coach_id = current_coach_id())
);

drop policy if exists "profiles_admin_write" on profiles;
create policy "profiles_admin_write" on profiles
for all using (current_app_role() = 'super_admin')
with check (current_app_role() = 'super_admin');

-- =============================================================================
-- TIMESTAMP TRIGGERS
-- =============================================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_coaches_updated on coaches;
create trigger trg_coaches_updated before update on coaches
  for each row execute function set_updated_at();

drop trigger if exists trg_industries_updated on industries;
create trigger trg_industries_updated before update on industries
  for each row execute function set_updated_at();

drop trigger if exists trg_clients_updated on clients;
create trigger trg_clients_updated before update on clients
  for each row execute function set_updated_at();

-- =============================================================================
-- BOOTSTRAP — call this ONCE after creating your first auth user
-- =============================================================================
-- Usage:
--   1. Supabase Dashboard → Authentication → Users → "Add User"
--      Enter your email + a password. Click "Create user".
--   2. SQL Editor → run:
--        select bootstrap_coach('jackie@thegoodplansco.com', 'The Good Plans Co');
--      (use the email of the auth user you just created)
-- =============================================================================

create or replace function bootstrap_coach(p_email text, p_brand_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_coach_id uuid;
begin
  select id into v_user_id from auth.users where email = p_email;
  if v_user_id is null then
    raise exception 'No auth user found with email %. Create them in Authentication → Users first.', p_email;
  end if;

  if exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'Profile already exists for %.', p_email;
  end if;

  insert into public.coaches (brand_name, support_email, from_email)
    values (p_brand_name, p_email, p_email)
    returning id into v_coach_id;

  insert into public.profiles (id, role, coach_id, display_name)
    values (v_user_id, 'coach', v_coach_id, p_brand_name);

  return v_coach_id;
end;
$$;
