-- Synthetic dependency shim only; not a Supabase Auth implementation or migration.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users(id) VALUES
  ('a1350000-0000-4000-8000-000000000001'),
  ('a1350000-0000-4000-8000-000000000002');
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
