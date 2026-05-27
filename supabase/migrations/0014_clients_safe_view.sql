-- =============================================================================
-- Data minimization: clients_safe view for client-side reads
-- =============================================================================
-- The clients table includes columns the UI never renders to a logged-in
-- client but which any client could read via direct API inspection:
-- invite_code, invite_code_expires_at, reset_code, reset_code_expires_at,
-- auth_user_id.
--
-- Migration 0010 locked WRITES on these columns; this migration narrows
-- client-side READS by routing them through a view that omits the
-- sensitive fields. Severity is low (those tokens are single-use and
-- tied to flows the logged-in client already controls), but it's the
-- "ship only what the UI needs" hygiene appropriate before broader
-- client onboarding.
--
-- Why a view instead of column-level GRANTs: client and coach share the
-- `authenticated` Postgres role in Supabase Auth (the role is set by
-- JWT claims at query time, not at GRANT time). A column-level REVOKE
-- on `authenticated` would also block the coach reading the same table,
-- which we DON'T want — coach needs invite_code on the Pending tab of
-- Coach Admin. So we expose a SELECT-only view of safe columns and
-- switch client-side reads to it; coach-side reads keep going to the
-- table.
--
-- security_invoker = on so RLS policies on the underlying clients
-- table still apply to view access. A client still only sees their own
-- row; coaches still see their own clients. No new policies needed.
-- =============================================================================

create or replace view public.clients_safe
  with (security_invoker = on)
  as
select
  id,
  coach_id,
  industry_id,
  company_name,
  contact_name,
  email,
  phone,
  shared_folder_link,
  -- Intentionally excluded: auth_user_id, invite_code,
  -- invite_code_expires_at, reset_code, reset_code_expires_at.
  -- Coach reads these via the clients table (RLS scoped to their
  -- own clients); client-side reads go through this view and never
  -- see them.
  activated,
  archived,
  must_change_password,
  weekly_reminder_enabled,
  kpis,
  custom_kpis,
  capacity_groups,
  tracks_ytd_actuals,
  dashboard_order,
  coach_note,
  coach_note_updated_at,
  created_at,
  updated_at
from public.clients;

grant select on public.clients_safe to authenticated;
