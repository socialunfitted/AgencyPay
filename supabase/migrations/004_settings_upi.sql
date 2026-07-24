-- ============================================================
-- AgencyPay Billing Portal — Dynamic Settings & UPI Sync
-- Migration 004
-- ============================================================

ALTER TABLE public.notification_settings 
  ADD COLUMN IF NOT EXISTS admin_upi_id TEXT NOT NULL DEFAULT 'socialunfitted@okicici',
  ADD COLUMN IF NOT EXISTS agency_name TEXT NOT NULL DEFAULT 'Social.Unfitted',
  ADD COLUMN IF NOT EXISTS admin_whatsapp TEXT NOT NULL DEFAULT '919003490495';
