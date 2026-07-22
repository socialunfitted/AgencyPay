// ============================================================
// AgencyPay — Edge Function: send-notification
// Internal function called by other functions and the daily cron
// POST body: { client_id, type, channel? }
//   type: "upcoming_due" | "due_today" | "overdue" | "payment_received"
//   channel: "email" | "whatsapp" | "both" (default: use template setting)
// ============================================================

import {
  corsHeaders, getSupabase, json, verifyAuth,
  formatDate, parseDate, formatAmount, applyTemplate,
} from "../_shared/utils.ts";

// ============================================================
// Email: Resend API
// Set RESEND_API_KEY in Supabase Edge Function secrets
// ============================================================
async function sendEmail(opts: {
  to: string;
  subject: string;
  body: string;
  fromName?: string;
}): Promise<{ success: boolean; error?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set — email skipped (mock mode)");
    return { success: true }; // mock success when not configured
  }

  const fromEmail = Deno.env.get("EMAIL_FROM") || "noreply@youragency.com";
  const fromName = opts.fromName || Deno.env.get("EMAIL_FROM_NAME") || "AgencyPay";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to: [opts.to],
        subject: opts.subject,
        text: opts.body,
        html: opts.body.replace(/\n/g, "<br>"),
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: err };
    }
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: String(e) };
  }
}

// ============================================================
// WhatsApp: Meta Cloud API (swappable)
// Set WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID in secrets
// To switch provider: replace this function body only
// ============================================================
async function sendWhatsAppMessage(
  toNumber: string,
  messageText: string
): Promise<{ success: boolean; error?: string }> {
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

  if (!accessToken || !phoneNumberId) {
    console.warn("WhatsApp credentials not set — WhatsApp skipped (mock mode)");
    return { success: true }; // mock success when not configured
  }

  // Normalize number: ensure it starts with country code, no + or spaces
  const normalized = toNumber.replace(/\D/g, "");

  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: normalized,
          type: "text",
          text: { body: messageText },
        }),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: err };
    }
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: String(e) };
  }
}

// ============================================================
// Main dispatcher
// ============================================================
export async function dispatchNotification(
  clientId: string,
  type: string,
  channelOverride?: string
): Promise<void> {
  const supabase = getSupabase();

  // Fetch client
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, business_name, email, whatsapp_number, monthly_amount, next_due_date, website_url, status")
    .eq("id", clientId)
    .single();

  if (clientErr || !client) {
    console.error("Client not found:", clientId);
    return;
  }

  // Fetch template
  const { data: template, error: tplErr } = await supabase
    .from("notification_templates")
    .select("*")
    .eq("type", type)
    .eq("is_active", true)
    .single();

  if (tplErr || !template) {
    console.error("Template not found for type:", type);
    return;
  }

  const channel = channelOverride || template.channel;

  // Resolve placeholders
  const vars: Record<string, string> = {
    client_name: client.business_name,
    amount: Number(client.monthly_amount).toLocaleString("en-IN", { minimumFractionDigits: 0 }),
    due_date: formatDate(parseDate(client.next_due_date)),
    website: client.website_url || "your website",
  };

  const messageBody = applyTemplate(template.message_body, vars);
  const subject = applyTemplate(template.subject || "Payment Notification", vars);

  // Send email
  if (channel === "email" || channel === "both") {
    const result = await sendEmail({ to: client.email, subject, body: messageBody });
    await supabase.from("notifications_log").insert({
      client_id: clientId,
      channel: "email",
      type,
      status: result.success ? "sent" : "failed",
      error_message: result.error || null,
    });
  }

  // Send WhatsApp
  if (channel === "whatsapp" || channel === "both") {
    if (client.whatsapp_number) {
      const result = await sendWhatsAppMessage(client.whatsapp_number, messageBody);
      await supabase.from("notifications_log").insert({
        client_id: clientId,
        channel: "whatsapp",
        type,
        status: result.success ? "sent" : "failed",
        error_message: result.error || null,
      });
    }
  }
}

// ============================================================
// HTTP handler (for manual triggering from admin panel)
// POST { client_id, type, channel? }
// Requires admin JWT
// ============================================================
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await verifyAuth(req, "admin");
  if (!auth) return json({ error: "Unauthorized" }, 401);

  try {
    const { client_id, type, channel } = await req.json();
    if (!client_id || !type) return json({ error: "client_id and type required" }, 400);

    await dispatchNotification(client_id, type, channel);
    return json({ success: true });
  } catch (e: unknown) {
    console.error("send-notification error:", e);
    return json({ error: "Internal error" }, 500);
  }
});
