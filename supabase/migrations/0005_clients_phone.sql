-- Phone is informational only — used on the client card and in Settings;
-- not used for auth (email is still the login key). Nullable; old clients
-- inherit NULL.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS phone TEXT;
