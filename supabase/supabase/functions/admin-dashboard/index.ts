// ============================================================
// AgencyPay — Edge Function: admin-dashboard
// Returns aggregated stats for the admin home dashboard
// Requires admin JWT
// ============================================================

import {
  corsHeaders, getSupabase, json, verifyAuth, unauthorized,
  todayIST, toDBDate, getBillingStatus,
} from "../_shared/utils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await verifyAuth(req, "admin");
  if (!auth) return unauthorized();

  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const supabase = getSupabase();

  // Fetch settings
  const { data: settings } = await supabase
    .from("notification_settings")
    .select("reminder_days_before")
    .single();
  const reminderDaysBefore = settings?.reminder_days_before ?? 3;

  // Fetch all active clients
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, business_name, email, monthly_amount, next_due_date, status, last_paid_date")
    .eq("status", "active");

  if (error) return json({ error: error.message }, 500);

  // Compute stats
  let totalMRR = 0;
  let dueSoonClients: typeof clients = [];
  let overdueClients: typeof clients = [];

  for (const c of clients || []) {
    totalMRR += Number(c.monthly_amount);
    const bs = getBillingStatus(c.next_due_date, reminderDaysBefore);
    if (bs === "due_soon") dueSoonClients.push(c);
    if (bs === "overdue") overdueClients.push(c);
  }

  // Total collected this calendar month (IST)
  const today = todayIST();
  const monthStart = toDBDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  const monthEnd = toDBDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)));

  const { data: payments } = await supabase
    .from("payments")
    .select("amount")
    .gte("payment_date", monthStart)
    .lte("payment_date", monthEnd);

  const collectedThisMonth = (payments || []).reduce((sum, p) => sum + Number(p.amount), 0);

  // Fetch paused/cancelled counts
  const { data: pausedData } = await supabase
    .from("clients")
    .select("id", { count: "exact" })
    .eq("status", "paused");

  return json({
    active_clients: (clients || []).length,
    total_mrr: totalMRR,
    collected_this_month: collectedThisMonth,
    due_soon_count: dueSoonClients.length,
    overdue_count: overdueClients.length,
    due_soon_clients: dueSoonClients.map((c) => ({
      id: c.id,
      business_name: c.business_name,
      next_due_date: c.next_due_date,
      monthly_amount: c.monthly_amount,
    })),
    overdue_clients: overdueClients.map((c) => ({
      id: c.id,
      business_name: c.business_name,
      next_due_date: c.next_due_date,
      monthly_amount: c.monthly_amount,
    })),
    paused_clients: pausedData?.length ?? 0,
  });
});
