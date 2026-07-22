// ============================================================
// AgencyPay — Edge Function: admin-clients
// All CRUD operations for client management
// All routes require admin JWT
// ============================================================

import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import {
  corsHeaders, getSupabase, json, verifyAuth, unauthorized, badRequest,
  getNextDueDate, getBillingStatus, toDBDate, parseDate, generatePassword,
} from "../_shared/utils.ts";

async function getSettings(supabase: ReturnType<typeof getSupabase>) {
  const { data } = await supabase.from("notification_settings").select("*").single();
  return { reminderDaysBefore: data?.reminder_days_before ?? 3 };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await verifyAuth(req, "admin");
  if (!auth) return unauthorized();

  const supabase = getSupabase();
  const url = new URL(req.url);
  const clientId = url.searchParams.get("id");
  const { reminderDaysBefore } = await getSettings(supabase);

  // ── GET list ──────────────────────────────────────────────
  if (req.method === "GET" && !clientId) {
    const search = url.searchParams.get("search") || "";
    const statusFilter = url.searchParams.get("status") || "";

    let query = supabase
      .from("clients")
      .select(`id, business_name, website_url, contact_person, email, whatsapp_number,
               username, monthly_amount, subscription_start_date, last_paid_date,
               next_due_date, status, created_at`)
      .order("business_name");

    if (statusFilter && statusFilter !== "all") query = query.eq("status", statusFilter);
    if (search) query = query.ilike("business_name", `%${search}%`);

    const { data, error } = await query;
    if (error) return json({ error: error.message }, 500);

    // Attach computed billing status
    const enriched = (data || []).map((c) => ({
      ...c,
      billing_status: c.status === "active"
        ? getBillingStatus(c.next_due_date, reminderDaysBefore)
        : c.status,
    }));

    return json(enriched);
  }

  // ── GET single ────────────────────────────────────────────
  if (req.method === "GET" && clientId) {
    const { data, error } = await supabase
      .from("clients")
      .select(`id, business_name, website_url, contact_person, email, whatsapp_number,
               username, monthly_amount, subscription_start_date, last_paid_date,
               next_due_date, status, created_at`)
      .eq("id", clientId)
      .single();

    if (error) return json({ error: "Client not found" }, 404);

    const payments = await supabase
      .from("payments")
      .select(`id, amount, payment_date, payment_mode, reference_note, created_at,
               admins!marked_by(name)`)
      .eq("client_id", clientId)
      .order("payment_date", { ascending: false });

    return json({
      ...data,
      billing_status: data.status === "active"
        ? getBillingStatus(data.next_due_date, reminderDaysBefore)
        : data.status,
      payments: payments.data || [],
    });
  }

  // ── POST create client ────────────────────────────────────
  if (req.method === "POST") {
    const body = await req.json();
    const {
      business_name, website_url, contact_person, email, whatsapp_number,
      password, monthly_amount, subscription_start_date, status = "active",
    } = body;

    if (!business_name || !email || !subscription_start_date) {
      return badRequest("business_name, email, and subscription_start_date are required");
    }

    // Generate or use provided password
    const rawPassword = password || generatePassword();

    // Create user in Supabase Auth via admin API
    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email: email.trim(),
      password: rawPassword,
      email_confirm: true,
      user_metadata: { role: "client", name: business_name },
    });

    if (authErr) {
      return json({ error: authErr.message }, 400);
    }

    // Calculate initial next_due_date = subscription_start_date (no payment yet)
    const nextDue = toDBDate(parseDate(subscription_start_date));

    const { data, error } = await supabase
      .from("clients")
      .insert({
        auth_user_id: authUser.user.id,
        business_name, website_url, contact_person, email, whatsapp_number,
        monthly_amount: Number(monthly_amount) || 1000,
        subscription_start_date,
        next_due_date: nextDue,
        status,
      })
      .select()
      .single();

    if (error) {
      // Rollback auth user creation if DB insert fails
      await supabase.auth.admin.deleteUser(authUser.user.id);
      return json({ error: error.message }, 500);
    }

    // Return plain password ONCE (never stored in plain text again)
    return json({ ...data, generated_password: rawPassword }, 201);
  }

  // ── PUT update client ─────────────────────────────────────
  if (req.method === "PUT" && clientId) {
    const body = await req.json();
    const updates: Record<string, unknown> = {};

    const allowed = [
      "business_name", "website_url", "contact_person", "email",
      "whatsapp_number", "monthly_amount", "status",
    ];
    for (const key of allowed) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    // Allow password reset via Supabase Auth
    if (body.password) {
      const { data: clientData } = await supabase
        .from("clients")
        .select("auth_user_id")
        .eq("id", clientId)
        .single();

      if (clientData?.auth_user_id) {
        await supabase.auth.admin.updateUserById(clientData.auth_user_id, {
          password: body.password,
        });
      }
    }

    const { data, error } = await supabase
      .from("clients")
      .update(updates)
      .eq("id", clientId)
      .select()
      .single();

    if (error) return json({ error: error.message }, 500);
    return json(data);
  }

  // ── PATCH status (pause / cancel / reactivate) ─────────────
  if (req.method === "PATCH" && clientId) {
    const { status } = await req.json();
    if (!["active", "paused", "cancelled"].includes(status)) {
      return badRequest("status must be active, paused, or cancelled");
    }
    const { data, error } = await supabase
      .from("clients")
      .update({ status })
      .eq("id", clientId)
      .select()
      .single();

    if (error) return json({ error: error.message }, 500);
    return json(data);
  }

  // ── DELETE client ─────────────────────────────────────────
  if (req.method === "DELETE" && clientId) {
    const { error } = await supabase.from("clients").delete().eq("id", clientId);
    if (error) return json({ error: error.message }, 500);
    return json({ success: true });
  }

  return json({ error: "Not found" }, 404);
});
