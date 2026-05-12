-- Per-client toggle for the weekly-entry reminder email. The email job
-- itself isn't built yet (deferred to Phase 9 deploy, see parking lot) —
-- this column just stores the preference now so the UI can manage it and
-- the future cron can read it without a follow-on migration.
alter table clients
add column if not exists weekly_reminder_enabled boolean not null default true;
