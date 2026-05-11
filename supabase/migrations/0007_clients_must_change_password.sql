-- One-time-use temp-password flag. When a coach sets a password via the
-- coach-side Reset Password modal, this is flipped true on the affected
-- client. The ClientPortal renders a force-change-password interstitial
-- as long as this is true — the client cannot reach any page in the
-- portal until they pick their own password. The interstitial flips it
-- back to false on success.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
