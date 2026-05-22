-- =============================================================================
-- Lock down client + profile self-update column lists
-- =============================================================================
-- Two privilege-escalation holes the audit surfaced:
--
-- 1. profiles_self_update lets a row update itself with no column-level
--    restrictions, so a client could flip their own `role` to 'coach' or
--    change `coach_id` / `client_id` via a direct API call.
--
-- 2. clients_client_update_self has USING but no WITH CHECK, so a client
--    could change any column on their own row — including coach_id,
--    industry_id, archived, kpis, custom_kpis, tracks_ytd_actuals, etc.
--    The UI gates these but RLS didn't.
--
-- We implement column-level immutability via BEFORE-UPDATE triggers that
-- compare OLD vs NEW for the locked columns when the actor is NOT a
-- super_admin (for profiles) or NOT a coach (for clients). Triggers run
-- with SECURITY DEFINER and a fixed search_path, matching the pattern the
-- helper functions in schema.sql use.
--
-- Why a trigger instead of a richer WITH CHECK? RLS WITH CHECK only sees
-- the NEW row — it can't compare to OLD. We could subquery the current
-- table inside WITH CHECK, but that's noisier and easier to drift from.
-- A trigger keeps the diff explicit.
-- =============================================================================

-- =============================================================================
-- profiles: lock role / coach_id / client_id for non-admin updates
-- =============================================================================
create or replace function enforce_profiles_immutable_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- super_admin can change anything (they manage role assignments).
  if current_app_role() = 'super_admin' then
    return new;
  end if;
  if old.role is distinct from new.role then
    raise exception 'Cannot change profiles.role from non-admin context';
  end if;
  if old.coach_id is distinct from new.coach_id then
    raise exception 'Cannot change profiles.coach_id from non-admin context';
  end if;
  if old.client_id is distinct from new.client_id then
    raise exception 'Cannot change profiles.client_id from non-admin context';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_immutable on profiles;
create trigger trg_profiles_immutable
  before update on profiles
  for each row
  execute function enforce_profiles_immutable_columns();

-- =============================================================================
-- clients: lock coach-only columns when the actor is a client
-- =============================================================================
-- Clients can update: company_name, contact_name, phone,
-- weekly_reminder_enabled, capacity_groups, must_change_password.
-- Everything else on the clients row is coach- or admin-only.
create or replace function enforce_clients_client_update_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Coach (or super_admin) updating their own client: no restrictions.
  if current_app_role() = 'super_admin' then
    return new;
  end if;
  if current_app_role() = 'coach'
     and new.coach_id = current_coach_id()
     and old.coach_id = current_coach_id() then
    return new;
  end if;
  -- Otherwise: the actor is the client themselves. Lock down columns
  -- the UI doesn't expose to client-side editing.
  if old.id is distinct from new.id then
    raise exception 'Cannot change clients.id';
  end if;
  if old.coach_id is distinct from new.coach_id then
    raise exception 'Client cannot change clients.coach_id';
  end if;
  if old.auth_user_id is distinct from new.auth_user_id then
    raise exception 'Client cannot change clients.auth_user_id';
  end if;
  if old.industry_id is distinct from new.industry_id then
    raise exception 'Client cannot change clients.industry_id';
  end if;
  if old.email is distinct from new.email then
    raise exception 'Client cannot change clients.email';
  end if;
  if old.shared_folder_link is distinct from new.shared_folder_link then
    raise exception 'Client cannot change clients.shared_folder_link';
  end if;
  if old.invite_code is distinct from new.invite_code then
    raise exception 'Client cannot change clients.invite_code';
  end if;
  if old.invite_code_expires_at is distinct from new.invite_code_expires_at then
    raise exception 'Client cannot change clients.invite_code_expires_at';
  end if;
  if old.reset_code is distinct from new.reset_code then
    raise exception 'Client cannot change clients.reset_code';
  end if;
  if old.reset_code_expires_at is distinct from new.reset_code_expires_at then
    raise exception 'Client cannot change clients.reset_code_expires_at';
  end if;
  if old.activated is distinct from new.activated then
    raise exception 'Client cannot change clients.activated';
  end if;
  if old.archived is distinct from new.archived then
    raise exception 'Client cannot change clients.archived';
  end if;
  if old.kpis is distinct from new.kpis then
    raise exception 'Client cannot change clients.kpis';
  end if;
  if old.tracks_ytd_actuals is distinct from new.tracks_ytd_actuals then
    raise exception 'Client cannot change clients.tracks_ytd_actuals';
  end if;
  if old.custom_kpis is distinct from new.custom_kpis then
    raise exception 'Client cannot change clients.custom_kpis';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clients_client_update on clients;
create trigger trg_clients_client_update
  before update on clients
  for each row
  execute function enforce_clients_client_update_columns();
