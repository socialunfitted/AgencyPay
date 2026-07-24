// ============================================================
// AgencyPay — Edge Function: client-portal
// GET /functions/v1/client-portal
// Returns the authenticated client's own data ONLY
// Requires client JWT
// ============================================================

import {
  corsHeaders, getSupabase, json, verifyAuth, unauthorized,
  getBillingStatus, daysUntilDue, formatDate, parseDate,
} from "../_shared/utils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await verifyAuth(req, "client");
  if (!auth) return unauthorized();

  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const supabase = getSupabase();
  const clientId = auth.sub; // from JWT — cannot be spoofed

  // Fetch settings
  const { data: settings } = await supabase
    .from("notification_settings")
    .select("reminder_days_before, admin_upi_id, agency_name, admin_whatsapp")
    .maybeSingle();
  const reminderDaysBefore = settings?.reminder_days_before ?? 3;

  // Fetch client profile (only their own row — server enforced)
  const { data: client, error } = await supabase
    .from("clients")
    .select(`
      id, business_name, website_url, contact_person, email,
      monthly_amount, subscription_start_date, last_paid_date,
      next_due_date, status, created_at
    `)
    .eq("id", clientId)
    .single();

  if (error || !client) return json({ error: "Account not found" }, 404);

  // Fetch payment history (own payments only — server enforced)
  const { data: payments } = await supabase
    .from("payments")
    .select("id, amount, payment_date, payment_mode, reference_note, created_at")
    .eq("client_id", clientId)
    .order("payment_date", { ascending: false });

  // Compute billing status & countdown
  const billingStatus = getBillingStatus(client.next_due_date, reminderDaysBefore);
  const daysDiff = daysUntilDue(client.next_due_date);

  let countdownText: string;
  if (daysDiff > 0) countdownText = `Due in ${daysDiff} day${daysDiff === 1 ? "" : "s"}`;
  else if (daysDiff === 0) countdownText = "Due Today";
  else countdownText = `Overdue by ${Math.abs(daysDiff)} day${Math.abs(daysDiff) === 1 ? "" : "s"}`;

  // Build a month-by-month history strip (last 12 months)
  const today = new Date();
  const monthlyStrip: { month: string; status: "paid" | "unpaid" | "upcoming" }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    const yr = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const label = d.toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

    // Check if a payment was made in this month
    const paid = (payments || []).some((p) => {
      const pd = parseDate(p.payment_date);
      return pd.getUTCFullYear() === yr && pd.getUTCMonth() + 1 === mo;
    });

    const isUpcoming = d.getTime() > today.getTime();
    monthlyStrip.push({ month: label, status: isUpcoming ? "upcoming" : paid ? "paid" : "unpaid" });
  }

  return json({
    client: {
      ...client,
      billing_status: billingStatus,
      days_until_due: daysDiff,
      countdown_text: countdownText,
      next_due_date_formatted: formatDate(parseDate(client.next_due_date)),
    },
    settings: {
      admin_upi_id: settings?.admin_upi_id || "socialunfitted@okicici",
      agency_name: settings?.agency_name || "Social.Unfitted",
      admin_whatsapp: settings?.admin_whatsapp || "919003490495",
      reminder_days_before: reminderDaysBefore,
    },
    payments: (payments || []).map((p) => ({
      ...p,
      payment_date_formatted: formatDate(parseDate(p.payment_date)),
    })),
    monthly_strip: monthlyStrip,
  });
});
