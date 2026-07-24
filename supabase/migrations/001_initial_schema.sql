-- ============================================================
-- AgencyPay Billing Portal — Initial Schema
-- Run this in Supabase SQL Editor (or via supabase db push)
-- ============================================================

-- Enable pgcrypto for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enable pg_cron for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================
-- TABLE: admins
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: clients
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clients (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name           TEXT NOT NULL,
  website_url             TEXT,
  contact_person          TEXT,
  email                   TEXT NOT NULL,
  whatsapp_number         TEXT,
  username                TEXT UNIQUE NOT NULL,
  password_hash           TEXT NOT NULL,
  monthly_amount          NUMERIC(10,2) NOT NULL DEFAULT 1000.00,
  subscription_start_date DATE NOT NULL,
  last_paid_date          DATE,
  next_due_date           DATE NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','paused','cancelled')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: payments
-- ============================================================
CREATE TABLE IF NOT EXISTS public.payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  amount         NUMERIC(10,2) NOT NULL,
  payment_date   DATE NOT NULL,
  payment_mode   TEXT NOT NULL DEFAULT 'UPI'
                   CHECK (payment_mode IN ('UPI','Bank Transfer','Cash','Razorpay','Other')),
  reference_note TEXT,
  marked_by      UUID REFERENCES public.admins(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: notification_templates
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notification_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         TEXT NOT NULL
                 CHECK (type IN ('upcoming_due','due_today','overdue','payment_received')),
  channel      TEXT NOT NULL DEFAULT 'both'
                 CHECK (channel IN ('email','whatsapp','both')),
  subject      TEXT,                     -- for email subject line
  message_body TEXT NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: notification_settings
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notification_settings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_upi_id        TEXT NOT NULL DEFAULT 'socialunfitted@okicici',
  agency_name         TEXT NOT NULL DEFAULT 'Social.Unfitted',
  admin_whatsapp      TEXT NOT NULL DEFAULT '919003490495',
  reminder_days_before INT NOT NULL DEFAULT 3,
  grace_days_overdue   INT NOT NULL DEFAULT 2,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: notifications_log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL CHECK (channel IN ('email','whatsapp')),
  type          TEXT NOT NULL CHECK (type IN ('upcoming_due','due_today','overdue','payment_received')),
  status        TEXT NOT NULL CHECK (status IN ('sent','failed')),
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_message TEXT
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_clients_next_due_date  ON public.clients(next_due_date);
CREATE INDEX IF NOT EXISTS idx_clients_status         ON public.clients(status);
CREATE INDEX IF NOT EXISTS idx_payments_client_id     ON public.payments(client_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_date  ON public.payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_notif_log_client_id    ON public.notifications_log(client_id);
CREATE INDEX IF NOT EXISTS idx_notif_log_sent_at      ON public.notifications_log(sent_at);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.admins               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications_log    ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS — all Edge Functions use service role key
-- These policies allow the service role full access:
CREATE POLICY "service_role_all" ON public.admins
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.clients
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.payments
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.notification_templates
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.notification_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.notifications_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Anon/authenticated users cannot access directly (all goes through Edge Functions)
CREATE POLICY "deny_anon" ON public.admins     FOR ALL TO anon    USING (false);
CREATE POLICY "deny_anon" ON public.clients    FOR ALL TO anon    USING (false);
CREATE POLICY "deny_anon" ON public.payments   FOR ALL TO anon    USING (false);
CREATE POLICY "deny_anon" ON public.notification_templates FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon" ON public.notification_settings  FOR ALL TO anon USING (false);
CREATE POLICY "deny_anon" ON public.notifications_log      FOR ALL TO anon USING (false);

-- ============================================================
-- SEED: Default admin account
-- Username: admin | Password: Admin@123 (CHANGE IMMEDIATELY)
-- ============================================================
INSERT INTO public.admins (name, email, username, password_hash)
VALUES (
  'Agency Admin',
  'admin@youragency.com',
  'admin',
  crypt('Admin@123', gen_salt('bf', 12))
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED: Notification settings (singleton row)
-- ============================================================
INSERT INTO public.notification_settings (admin_upi_id, agency_name, admin_whatsapp, reminder_days_before, grace_days_overdue)
VALUES ('socialunfitted@okicici', 'Social.Unfitted', '919003490495', 3, 2)
ON CONFLICT DO NOTHING;

-- ============================================================
-- SEED: Default notification templates
-- ============================================================
INSERT INTO public.notification_templates (type, channel, subject, message_body) VALUES
(
  'upcoming_due',
  'both',
  'Payment Due Soon — {{website}}',
  'Hi {{client_name}}, your monthly payment of ₹{{amount}} for {{website}} is due on {{due_date}}. Please make the payment to keep everything running smoothly.'
),
(
  'due_today',
  'both',
  'Payment Due Today — {{website}}',
  'Hi {{client_name}}, your payment of ₹{{amount}} for {{website}} is due today. Please pay at your earliest convenience.'
),
(
  'overdue',
  'both',
  'Payment Overdue — {{website}}',
  'Hi {{client_name}}, your payment of ₹{{amount}} for {{website}} was due on {{due_date}} and hasn''t been received yet. Kindly clear it soon to avoid service interruption.'
),
(
  'payment_received',
  'both',
  'Payment Received — Thank You!',
  'Hi {{client_name}}, we''ve received your payment of ₹{{amount}} for {{website}}. Thank you! Your next due date is {{due_date}}.'
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- pg_cron: Daily job at 09:00 IST (03:30 UTC)
-- Calls the daily-cron Edge Function via HTTP
-- NOTE: Replace YOUR_PROJECT_REF with your Supabase project ref
-- ============================================================
-- SELECT cron.schedule(
--   'agencypay-daily-cron',
--   '30 3 * * *',  -- 09:00 IST = 03:30 UTC
--   $$
--     SELECT net.http_post(
--       url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/daily-cron',
--       headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY", "Content-Type": "application/json"}'::jsonb,
--       body := '{}'::jsonb
--     )
--   $$
-- );
-- Uncomment after replacing YOUR_PROJECT_REF and YOUR_SERVICE_ROLE_KEY
