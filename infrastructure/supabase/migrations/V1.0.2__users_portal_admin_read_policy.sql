-- Grant portal_app_user read access to the users table for observability admin UI.
--
-- Background: `01_rls-policies.sql` enables RLS on `users` with a single
-- policy `service_role_users` limited to `auth.role() = 'service_role'`.
-- The dashboard middleware (`dashboard/middleware/rbac/database-context.js`)
-- connects as `portal_app_user`, which is a different Postgres role — so
-- every admin query against `users` returned 0 rows silently.
--
-- This policy fills the gap by granting portal_app_user unrestricted SELECT.
-- It matches the current admin-UX intent (super_admin sees everything).
-- If partner-scoped admins are added later, tighten this via a USING clause
-- that reads a session variable set by set_portal_user_context().

-- CREATE POLICY IF NOT EXISTS is not supported on the running Postgres version;
-- guard with a DO block instead.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'users' AND policyname = 'portal_admin_users_read'
  ) THEN
    EXECUTE 'CREATE POLICY portal_admin_users_read ON users FOR SELECT TO portal_app_user USING (true)';
  END IF;
END $$;
