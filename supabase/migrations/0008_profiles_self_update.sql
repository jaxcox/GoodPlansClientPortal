-- Allow users to update their own profile row.
--
-- Background: the original schema only gave super_admin write access to
-- profiles. The Coach Account page lets a coach edit their own display_name,
-- which requires a self-update policy. Scoped narrowly: the policy only
-- applies when id = auth.uid(), so a coach can't edit anyone else's profile.
-- Coaches still can't change role / coach_id / client_id — those columns
-- aren't touched by the Account page, and changes would only flow through
-- the admin write policy.
drop policy if exists "profiles_self_update" on profiles;
create policy "profiles_self_update" on profiles
for update using (id = auth.uid())
with check (id = auth.uid());
