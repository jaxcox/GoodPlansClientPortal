-- =============================================================================
-- Drop must_change_password — Reset Password (coach side) removed
-- =============================================================================
-- The coach-side "Reset Password" flow is removed in favor of the existing
-- self-service Forgot Password on the login screen. The temp-password
-- flow created risk (plaintext password handoff via text/email) without
-- meaningfully expanding what coaches could do — coaches can fix a
-- mistyped email on the client's record and let them use Forgot Password.
--
-- This migration:
--   1. Recreates clients_safe view WITHOUT the must_change_password column
--      (drop column would fail otherwise — views depend on it).
--   2. Drops clients.must_change_password.
--
-- The clients_safe view's other columns are unchanged. Same RLS posture
-- (security_invoker = on so underlying table RLS applies).

-- 1. Recreate the safe view without must_change_password
drop view if exists public.clients_safe;

create view public.clients_safe
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
  activated,
  archived,
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

-- 2. Drop the column
alter table public.clients drop column if exists must_change_password;
