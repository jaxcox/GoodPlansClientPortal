-- =============================================================================
-- Full database backup — single-query snapshot
-- =============================================================================
-- Run this in Supabase → SQL Editor → New query → paste → click "Run".
-- Then in the result panel, click the "Download CSV" button (or right-click
-- the result cell → "Copy cell content" depending on Supabase UI version).
--
-- The output is one row with one cell containing a JSON document with every
-- non-trivial table snapshotted at the moment you ran the query:
--
--   - coaches              — your coach record (brand_name, support_email, etc.)
--   - profiles             — auth user → role mappings
--   - industries           — your custom industries
--   - clients              — every client row (companies, contacts, budgets,
--                            KPI configs, custom KPIs, capacity groups, etc.)
--   - budgets              — annual targets, monthly distributions, YTD actuals
--                            per client per year
--   - weekly_entries       — every weekly KPI entry, ordered by week
--
-- Save the result CSV file somewhere safe — Dropbox, iCloud, a USB stick,
-- whatever you trust. Filename convention: `portal-backup-YYYY-MM-DD.csv`
-- so the date is obvious at a glance.
--
-- Recovery: this format isn't human-friendly to read directly, but it IS a
-- complete restorable snapshot. If you ever need to restore, ask Claude to
-- write a restore script that parses the JSON and INSERTs the rows back. You
-- can verify the file is good by opening it and confirming you see JSON with
-- recognizable client names, dates, etc.
--
-- This query is SAFE to run anytime — it's read-only, just SELECTs. It does
-- not modify any data. Run it as often as you want.
-- =============================================================================

select jsonb_build_object(
  'exported_at', now(),
  'schema_version', '0014',
  'coaches', (select jsonb_agg(row_to_json(t)) from coaches t),
  'profiles', (select jsonb_agg(row_to_json(t)) from profiles t),
  'industries', (select jsonb_agg(row_to_json(t)) from industries t),
  'clients', (select jsonb_agg(row_to_json(t)) from clients t),
  'budgets', (select jsonb_agg(row_to_json(t)) from budgets t),
  'weekly_entries', (
    select jsonb_agg(row_to_json(t) order by t.client_id, t.week_start_date)
    from weekly_entries t
  )
) as backup;
