-- Synthetic local fixtures only. Run before the v1.35.0 migration on a fresh disposable DB.
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('a1350000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'watchlist-a@example.test', '', NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW()),
  ('a1350000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'watchlist-b@example.test', '', NOW(), '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.portfolios (id, user_id, name, is_default)
VALUES
  ('b1350000-0000-4000-8000-000000000001', 'a1350000-0000-4000-8000-000000000001', 'Synthetic A1', TRUE),
  ('b1350000-0000-4000-8000-000000000002', 'a1350000-0000-4000-8000-000000000001', 'Synthetic A2', FALSE),
  ('b1350000-0000-4000-8000-000000000003', 'a1350000-0000-4000-8000-000000000002', 'Synthetic B1', TRUE)
ON CONFLICT (id) DO NOTHING;

-- The legacy row is deliberately present before the new migration and must remain untouched.
INSERT INTO public.watchlist (user_id, symbol, target_price, note)
VALUES ('a1350000-0000-4000-8000-000000000001', 'AAPL', 123.45, 'synthetic legacy row; preserve')
ON CONFLICT (user_id, symbol) DO NOTHING;
