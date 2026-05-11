-- Per-client toggle: shows the YTD Actuals card on Budget & Goals when on.
-- Used for mid-year onboarding clients in their first budget year. Default
-- true preserves visibility for any client that already has YTD data; coach
-- flips it off in Settings for year 2+. The actual YTD data lives on the
-- budgets table per (client_id, year), so flipping this off does NOT delete
-- prior years' data — it only hides the editor.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS tracks_ytd_actuals BOOLEAN NOT NULL DEFAULT true;
