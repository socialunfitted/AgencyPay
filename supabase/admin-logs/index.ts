// ============================================================
// AgencyPay — Edge Function: admin-logs
// GET notification logs with filtering and pagination
// Requires admin JWT
// ============================================================

import {
  corsHeaders, getSupabase, json, verifyAuth, unauthorized,
} from "../_shared/utils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await verifyAuth(req, "admin");
  if (!auth) return unauthorized();

  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const supabase = getSupabase();
  const url = new URL(req.url);

  const clientId   = url.searchParams.get("client_id");
  const channel    = url.searchParams.get("channel");
  const status     = url.searchParams.get("status");
  const type       = url.searchParams.get("type");
  const dateFrom   = url.searchParams.get("date_from");
  const dateTo     = url.searchParams.get("date_to");
  const page       = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const pageSize   = Math.min(100, parseInt(url.searchParams.get("page_size") || "50"));

  let query = supabase
    .from("notifications_log")
    .select(`
      id, channel, type, status, sent_at, error_message,
      clients!client_id(id, business_name, email)
    `, { count: "exact" })
    .order("sent_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (clientId)  query = query.eq("client_id", clientId);
  if (channel)   query = query.eq("channel", channel);
  if (status)    query = query.eq("status", status);
  if (type)      query = query.eq("type", type);
  if (dateFrom)  query = query.gte("sent_at", dateFrom);
  if (dateTo)    query = query.lte("sent_at", dateTo + "T23:59:59Z");

  const { data, count, error } = await query;
  if (error) return json({ error: error.message }, 500);

  return json({
    data: data || [],
    total: count || 0,
    page,
    page_size: pageSize,
    total_pages: Math.ceil((count || 0) / pageSize),
  });
});
