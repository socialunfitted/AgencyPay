// ============================================================
// AgencyPay — Edge Function: admin-templates
// CRUD for notification templates + settings
// All routes require admin JWT
// ============================================================

import {
  corsHeaders, getSupabase, json, verifyAuth, unauthorized, badRequest,
} from "../_shared/utils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await verifyAuth(req, "admin");
  if (!auth) return unauthorized();

  const supabase = getSupabase();
  const url = new URL(req.url);
  const path = url.pathname.split("/").pop(); // "templates" or "settings"

  // ── GET all templates ─────────────────────────────────────
  if (req.method === "GET" && path !== "settings") {
    const { data, error } = await supabase
      .from("notification_templates")
      .select("*")
      .order("type");
    if (error) return json({ error: error.message }, 500);
    return json(data);
  }

  // ── GET settings ──────────────────────────────────────────
  if (req.method === "GET" && path === "settings") {
    const { data, error } = await supabase
      .from("notification_settings")
      .select("*")
      .single();
    if (error) return json({ error: error.message }, 500);
    return json(data);
  }

  // ── PUT update a template ─────────────────────────────────
  if (req.method === "PUT") {
    const body = await req.json();
    const { id, channel, subject, message_body, is_active } = body;

    if (!id) return badRequest("Template id required");

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (channel !== undefined) updates.channel = channel;
    if (subject !== undefined) updates.subject = subject;
    if (message_body !== undefined) {
      if (!message_body.trim()) return badRequest("message_body cannot be empty");
      updates.message_body = message_body;
    }
    if (is_active !== undefined) updates.is_active = is_active;

    const { data, error } = await supabase
      .from("notification_templates")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) return json({ error: error.message }, 500);
    return json(data);
  }

  // ── PATCH notification settings (reminder days etc.) ──────
  if (req.method === "PATCH") {
    const body = await req.json();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.reminder_days_before !== undefined) {
      const v = Number(body.reminder_days_before);
      if (isNaN(v) || v < 1 || v > 30) return badRequest("reminder_days_before must be 1–30");
      updates.reminder_days_before = v;
    }
    if (body.grace_days_overdue !== undefined) {
      const v = Number(body.grace_days_overdue);
      if (isNaN(v) || v < 1 || v > 30) return badRequest("grace_days_overdue must be 1–30");
      updates.grace_days_overdue = v;
    }

    const { data, error } = await supabase
      .from("notification_settings")
      .update(updates)
      .eq("id", (await supabase.from("notification_settings").select("id").single()).data?.id)
      .select()
      .single();

    if (error) return json({ error: error.message }, 500);
    return json(data);
  }

  return json({ error: "Method not allowed" }, 405);
});
