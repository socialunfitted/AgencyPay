-- ============================================================
-- AgencyPay Billing Portal — Subscriptions & Dynamic UPI QR Schema
-- Migration 003
-- ============================================================

-- Create subscriptions table
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  invoice_number   TEXT UNIQUE NOT NULL,
  reference_number TEXT UNIQUE NOT NULL,
  monthly_amount   NUMERIC(10,2) NOT NULL,
  upi_payload      TEXT NOT NULL,
  qr_image         TEXT NOT NULL, -- Data URL (PNG)
  qr_svg           TEXT,          -- Raw SVG string for crisp vector download
  payment_status   TEXT NOT NULL DEFAULT 'Pending'
                     CHECK (payment_status IN ('Pending', 'Paid', 'Failed', 'Cancelled', 'Expired', 'Overdue', 'Refunded')),
  due_date         DATE NOT NULL,
  paid_date        DATE,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for subscriptions table
CREATE INDEX IF NOT EXISTS idx_subscriptions_client_id ON public.subscriptions(client_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status    ON public.subscriptions(payment_status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_inv_no    ON public.subscriptions(invoice_number);
CREATE INDEX IF NOT EXISTS idx_subscriptions_ref_no    ON public.subscriptions(reference_number);

-- Enable RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "service_role_subscriptions_all" ON public.subscriptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "deny_anon_subscriptions" ON public.subscriptions
  FOR ALL TO anon USING (false);

-- Helper function to generate auto-incrementing Invoice Number (INV-YYYYMM-000001)
CREATE OR REPLACE FUNCTION generate_next_invoice_number()
RETURNS TEXT AS $$
DECLARE
  yr_mo TEXT;
  seq INT;
  inv_no TEXT;
BEGIN
  yr_mo := TO_CHAR(CURRENT_DATE, 'YYYYMM');
  SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM 12) AS INT)), 0) + 1
  INTO seq
  FROM public.subscriptions
  WHERE invoice_number LIKE 'INV-' || yr_mo || '-%';
  
  inv_no := 'INV-' || yr_mo || '-' || LPAD(seq::TEXT, 6, '0');
  RETURN inv_no;
END;
$$ LANGUAGE plpgsql;

-- Helper function to generate unique Payment Reference Number (SUB-YYYY-000001)
CREATE OR REPLACE FUNCTION generate_next_reference_number()
RETURNS TEXT AS $$
DECLARE
  yr TEXT;
  seq INT;
  ref_no TEXT;
BEGIN
  yr := TO_CHAR(CURRENT_DATE, 'YYYY');
  SELECT COALESCE(MAX(CAST(SUBSTRING(reference_number FROM 10) AS INT)), 0) + 1
  INTO seq
  FROM public.subscriptions
  WHERE reference_number LIKE 'SUB-' || yr || '-%';
  
  ref_no := 'SUB-' || yr || '-' || LPAD(seq::TEXT, 6, '0');
  RETURN ref_no;
END;
$$ LANGUAGE plpgsql;
