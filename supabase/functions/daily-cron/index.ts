// ============================================================
// AgencyPay — Edge Function: daily-cron
// Runs daily at 09:00 IST via pg_cron
// Checks every active client and fires appropriate reminders
// Also callable manually via POST (admin JWT or cron secret)
// ============================================================

import {
  getSupabase, todayIST, toDBDate, parseDate, getBillingStatus,
} from "../_shared/utils.ts";
import { dispatchNotification } from "../send-notification/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function alreadySentToday(
  supabase: ReturnType<typeof getSupabase>,
  clientId: string,
  type: string
): Promise<boolean> {
  const todayStr = toDBDate(todayIST());
  const { data } = await supabase
    .from("notifications_log")
    .select("id")
    .eq("client_id", clientId)
    .eq("type", type)
    .eq("status", "sent")
    .gte("sent_at", todayStr + "T00:00:00Z")
    .lte("sent_at", todayStr + "T23:59:59Z")
    .limit(1);
  return (data || []).length > 0;
}

async function runDailyCron(): Promise<{ processed: number; sent: number; skipped: number }> {
  const supabase = getSupabase();

  // Fetch settings
  const { data: settings } = await supabase
    .from("notification_settings")
    .select("reminder_days_before, grace_days_overdue")
    .single();

  const reminderDaysBefore = settings?.reminder_days_before ?? 3;
  const graceDaysOverdue = settings?.grace_days_overdue ?? 2;

  const today = todayIST();
  const todayStr = toDBDate(today);

  // Fetch all active clients
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, business_name, next_due_date, status")
    .eq("status", "active");

  if (error) {
    console.error("daily-cron: failed to fetch clients:", error);
    return { processed: 0, sent: 0, skipped: 0 };
  }

  let sent = 0;
  let skipped = 0;

  for (const client of clients || []) {
    const nextDue = parseDate(client.next_due_date);
    const billingStatus = getBillingStatus(client.next_due_date, reminderDaysBefore);

    const daysDiff = Math.round(
      (nextDue.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    let notifType: string | null = null;

    // Due today
    if (daysDiff === 0) {
      notifType = "due_today";
    }
    // Upcoming (exact reminder day)
    else if (daysDiff === reminderDaysBefore) {
      notifType = "upcoming_due";
    }
    // Overdue — fire every `graceDaysOverdue` days after due date
    else if (daysDiff < 0) {
      const daysOverdue = Math.abs(daysDiff);
      // Fire on day 1 overdue and then every `graceDaysOverdue` days
      if (daysOverdue === 1 || daysOverdue % graceDaysOverdue === 0) {
        notifType = "overdue";
      }
    }

    if (!notifType) {
      skipped++;
      continue;
    }

    // Check if already sent today for this type (idempotency)
    const already = await alreadySentToday(supabase, client.id, notifType);
    if (already) {
      console.log(`daily-cron: already sent ${notifType} to ${client.business_name} today`);
      skipped++;
      continue;
    }

    console.log(`daily-cron: sending ${notifType} to ${client.business_name}`);
    await dispatchNotification(client.id, notifType);
    sent++;
  }

  return { processed: (clients || []).length, sent, skipped };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth: either admin JWT or a shared cron secret header
  const cronSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("Authorization");

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    // Authorized via cron secret
  } else {
    // Try admin JWT
    const { verifyAuth } = await import("../_shared/utils.ts");
    const auth = await verifyAuth(req, "admin");
    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const result = await runDailyCron();
    console.log("daily-cron complete:", result);
    return new Response(JSON.stringify({ success: true, ...result }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    console.error("daily-cron error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
