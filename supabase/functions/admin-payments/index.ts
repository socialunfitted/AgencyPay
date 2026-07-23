// ============================================================
// AgencyPay — Edge Function: admin-payments
// POST /functions/v1/admin-payments
// Marks a payment as received, recalculates next_due_date,
// triggers "Payment Received" notification
// Requires admin JWT
// ============================================================

import {
  corsHeaders, getSupabase, json, verifyAuth, unauthorized, badRequest,
  getNextDueDate, toDBDate, parseDate,
} from "../_shared/utils.ts";
import { dispatchNotification } from "../send-notification/index.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await verifyAuth(req, "admin");
  if (!auth) return unauthorized();

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const { client_id, amount, payment_date, payment_mode, reference_note } = body;

    if (!client_id || !amount || !payment_date) {
      return badRequest("client_id, amount, and payment_date are required");
    }

    const paymentAmount = Number(amount);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      return badRequest("amount must be a positive number");
    }

    const supabase = getSupabase();

    // Verify client exists
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, business_name, status")
      .eq("id", client_id)
      .single();

    if (clientErr || !client) return json({ error: "Client not found" }, 404);
    if (client.status === "cancelled") return json({ error: "Cannot record payment for a cancelled client" }, 400);

    // Parse payment date and calculate next due date
    const payDate = parseDate(payment_date);
    const nextDue = getNextDueDate(payDate);
    const nextDueStr = toDBDate(nextDue);

    // Insert payment record
    const { data: payment, error: payErr } = await supabase
      .from("payments")
      .insert({
        client_id,
        amount: paymentAmount,
        payment_date,
        payment_mode: payment_mode || "UPI",
        reference_note: reference_note || null,
        marked_by: auth.sub,
      })
      .select()
      .single();

    if (payErr) return json({ error: payErr.message }, 500);

    // Update client's last_paid_date and next_due_date
    const { error: updateErr } = await supabase
      .from("clients")
      .update({
        last_paid_date: payment_date,
        next_due_date: nextDueStr,
      })
      .eq("id", client_id);

    if (updateErr) return json({ error: updateErr.message }, 500);

    // Also update any pending subscription invoices for this client to Paid
    await supabase
      .from("subscriptions")
      .update({ payment_status: "Paid", paid_date: payment_date })
      .eq("client_id", client_id)
      .eq("payment_status", "Pending");

    // Fire "Payment Received" notification asynchronously
    // (don't await — let it run in background)
    dispatchNotification(client_id, "payment_received").catch((e) =>
      console.error("Notification dispatch failed:", e)
    );

    return json({
      success: true,
      payment,
      next_due_date: nextDueStr,
    }, 201);

  } catch (e: unknown) {
    console.error("admin-payments error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
