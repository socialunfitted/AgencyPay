-- ============================================================
-- AgencyPay Migration 002: Supabase Auth Integration
-- Run this AFTER migration 001 in the SQL Editor
-- ============================================================

-- Add auth_user_id columns to link to Supabase Auth users
ALTER TABLE public.admins  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Remove password_hash from clients (Supabase Auth handles passwords now)
ALTER TABLE public.clients DROP COLUMN IF EXISTS password_hash;
ALTER TABLE public.clients DROP COLUMN IF EXISTS username;
ALTER TABLE public.admins  DROP COLUMN IF EXISTS password_hash;

-- ============================================================
-- Helper: check if current user is an admin
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admins WHERE auth_user_id = auth.uid()
  );
$$;

-- ============================================================
-- Update RLS policies to use Supabase Auth
-- ============================================================

-- Drop old blanket deny policies
DROP POLICY IF EXISTS "deny_anon" ON public.admins;
DROP POLICY IF EXISTS "deny_anon" ON public.clients;
DROP POLICY IF EXISTS "deny_anon" ON public.payments;
DROP POLICY IF EXISTS "deny_anon" ON public.notification_templates;
DROP POLICY IF EXISTS "deny_anon" ON public.notification_settings;
DROP POLICY IF EXISTS "deny_anon" ON public.notifications_log;

-- ── clients table ─────────────────────────────────────────
-- Admins can do everything
CREATE POLICY "admin_all_clients" ON public.clients
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Allow select on clients for authentication and portal lookup
DROP POLICY IF EXISTS "client_read_own" ON public.clients;
CREATE POLICY "public_read_clients" ON public.clients FOR SELECT USING (true);

-- ── payments table ────────────────────────────────────────
-- Admins full access
CREATE POLICY "admin_all_payments" ON public.payments
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Clients read own payments
CREATE POLICY "client_read_own_payments" ON public.payments
  FOR SELECT USING (
    client_id IN (SELECT id FROM public.clients WHERE auth_user_id = auth.uid())
  );

-- ── notification_templates ────────────────────────────────
CREATE POLICY "admin_all_templates" ON public.notification_templates
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "client_read_templates" ON public.notification_templates
  FOR SELECT USING (true); -- templates are not sensitive

-- ── notification_settings ────────────────────────────────
CREATE POLICY "admin_all_settings" ON public.notification_settings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "client_read_settings" ON public.notification_settings
  FOR SELECT USING (true);

-- ── notifications_log ─────────────────────────────────────
CREATE POLICY "admin_all_logs" ON public.notifications_log
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── admins table ──────────────────────────────────────────
CREATE POLICY "admin_read_self" ON public.admins
  FOR SELECT USING (auth_user_id = auth.uid());

-- ============================================================
-- Seed: Setup admin function
-- After creating an admin user in Supabase Dashboard:
--   Authentication → Users → Add User
-- Run this with their User ID and name:
-- ============================================================

-- EXAMPLE (replace with real values after creating user in dashboard):
-- SELECT public.setup_admin_user('PASTE-USER-UUID-HERE', 'Agency Admin', 'admin@youragency.com');

CREATE OR REPLACE FUNCTION public.setup_admin_user(
  p_user_id   UUID,
  p_name      TEXT,
  p_email     TEXT
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Set role in auth.users metadata
  UPDATE auth.users
  SET raw_user_meta_data = jsonb_build_object('role', 'admin', 'name', p_name)
  WHERE id = p_user_id;

  -- Insert into admins table (upsert)
  INSERT INTO public.admins (auth_user_id, name, email, username)
  VALUES (p_user_id, p_name, p_email, lower(replace(p_name, ' ', '')))
  ON CONFLICT (auth_user_id) DO UPDATE
    SET name = EXCLUDED.name, email = EXCLUDED.email;
END;
$$;
