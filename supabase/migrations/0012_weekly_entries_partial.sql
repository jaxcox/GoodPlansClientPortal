-- Partial weekly entries — for Sun–Sat weeks that cross a month
-- boundary. Per product direction (Doc 06, revived 2026-05-23), a
-- boundary week splits into two entries so MTD/QTD/YTD math attributes
-- each side's actuals to the correct month:
--
--   Partial A: starts on the Sunday, covers days through end-of-month
--   Partial B: starts on the 1st of the next month, covers days
--              through the Saturday
--
-- e.g. Sun Mar 29 – Sat Apr 4, 2026:
--   Partial A: week_start_date = 2026-03-29, days = 3, is_partial = true
--   Partial B: week_start_date = 2026-04-01, days = 4, is_partial = true
--
-- The existing (client_id, week_start_date) unique constraint still
-- holds because the two partials have distinct start dates.
--
-- days = 7 + is_partial = false is the normal full-week shape (matches
-- every existing row's behavior; defaults make the migration
-- backward-compatible).
--
-- Phase 1 covers month boundaries. Year-boundary handling (loading
-- both years' budgets so the Jan-side partial uses the new year's
-- goals) is Phase 2 — for now Dec/Jan splits work structurally but
-- the Jan-side uses last year's budget until next year is set up.
alter table weekly_entries
  add column if not exists is_partial boolean not null default false,
  add column if not exists days integer not null default 7;

alter table weekly_entries
  drop constraint if exists weekly_entries_days_range;

alter table weekly_entries
  add constraint weekly_entries_days_range check (days between 1 and 7);
