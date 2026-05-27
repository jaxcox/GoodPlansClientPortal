-- =============================================================================
-- Fix activate-client: column-immutability trigger was rejecting service-role
-- writes
-- =============================================================================
-- Migration 0010 added enforce_clients_client_update_columns() to lock down
-- which columns a CLIENT can change on their own row (so they can't, e.g.,
-- flip their own activated flag or rewrite their auth_user_id). The trigger
-- recognized two privileged actors and bypassed for them:
--
--   * super_admin (full access)
--   * coach (when updating their own client)
--
-- Anyone else was assumed to be the client themselves, and the column
-- lockdown fired.
--
-- The activate-client Edge Function falls outside both privileged paths:
-- it runs with the Supabase service role to set auth_user_id + activated
-- on the client row after the user submits their invite code. The trigger
-- saw no JWT context (auth.uid() is null for service-role connections),
-- defaulted to the client-actor branch, and rejected the auth_user_id
-- write with "Client cannot change clients.auth_user_id".
--
-- This caught real activation flows: clients clicking the invite-code
-- link in their email got the red error and couldn't finish setup.
--
-- The fix: bypass the lockdown when there's no authenticated user
-- (auth.uid() is null), which is the signature of a service-role /
-- system-context write. Real clients ALWAYS have an auth.uid() (their
-- own user) when they hit this trigger, so this branch only fires for
-- privileged callers.
-- =============================================================================

create or replace function enforce_clients_client_update_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Service role / system writes (no authenticated user): no restrictions.
  -- activate-client uses this path to set auth_user_id + activated.
  if auth.uid() is null then
    return new;
  end if;

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
