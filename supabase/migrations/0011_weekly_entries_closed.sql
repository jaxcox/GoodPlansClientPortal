-- "Closed" weekly entries — the business was intentionally not operating
-- that week (holiday, vacation, scheduled shutdown). Per product
-- direction, a closed week is the most-honest answer to "what happened":
-- the business produced nothing, so all KPI values save as zero, the
-- row is removed from the Missed Weeks dropdown (it's not forgotten,
-- it was closed), and the cumulative math counts the lost week against
-- the unchanged monthly / annual goal — the closure shows up as a real
-- non-revenue dip rather than being magically excluded.
--
-- The Weekly Entry UI hides the KPI input cards when this flag is on
-- and clears kpi_values + capacity_values to {} before saving so the
-- DB never carries stale numbers under a closed row. Notes stay
-- editable so the client can document why they closed.
--
-- History page surfaces a "C" badge in the date header for closed
-- weeks so a coach scanning a long table can read them as deliberate
-- without diving into Notes.
alter table weekly_entries
add column if not exists closed boolean not null default false;
