// ============================================================
// AgencyPay — Shared utilities for Edge Functions
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verify } from "https://deno.land/x/djwt@v2.9.1/mod.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

export function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

async function getKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("JWT_SECRET") || Deno.env.get("SUPABASE_JWT_SECRET") || "agencypay-secret-change-me";
  const enc = new TextEncoder();
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export interface AuthPayload {
  sub: string;
  role: "admin" | "client";
  name: string;
}

export async function verifyAuth(req: Request, requiredRole?: "admin" | "client"): Promise<AuthPayload | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    const key = await getKey();
    const payload = await verify(token, key) as AuthPayload;
    if (requiredRole && payload.role !== requiredRole) return null;
    return payload;
  } catch {
    return null;
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function unauthorized(): Response {
  return json({ error: "Unauthorized" }, 401);
}

export function forbidden(): Response {
  return json({ error: "Forbidden" }, 403);
}

export function badRequest(msg: string): Response {
  return json({ error: msg }, 400);
}

// ============================================================
// Date utilities — all IST-aware (Asia/Kolkata = UTC+5:30)
// ============================================================

/** Get current date in IST as a Date (midnight IST) */
export function todayIST(): Date {
  const now = new Date();
  // IST offset: UTC+5:30 = 330 minutes
  const istOffset = 330 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  return new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()));
}

/** Parse a YYYY-MM-DD date string into a UTC midnight Date */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Format a Date as DD/MM/YYYY */
export function formatDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Format a Date as YYYY-MM-DD (for DB storage) */
export function toDBDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Calculate next due date after a payment on paymentDate.
 * = paymentDate + 1 calendar month, clamped to last day of that month.
 */
export function getNextDueDate(paymentDate: Date): Date {
  const y = paymentDate.getUTCFullYear();
  const m = paymentDate.getUTCMonth(); // 0-indexed
  const d = paymentDate.getUTCDate();

  const targetMonth = m + 1; // may be 12 (= next year January)
  const targetYear = targetMonth > 11 ? y + 1 : y;
  const normalizedMonth = targetMonth % 12;

  // Last day of the target month
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, lastDay);

  return new Date(Date.UTC(targetYear, normalizedMonth, clampedDay));
}

/**
 * Compute billing status relative to today (IST).
 */
export function getBillingStatus(
  nextDueDateStr: string,
  reminderDaysBefore: number
): "current" | "due_soon" | "overdue" {
  const today = todayIST();
  const nextDue = parseDate(nextDueDateStr);

  const dueSoonStart = new Date(nextDue.getTime());
  dueSoonStart.setUTCDate(dueSoonStart.getUTCDate() - reminderDaysBefore);

  if (today < dueSoonStart) return "current";
  if (today <= nextDue) return "due_soon";
  return "overdue";
}

/** Days until due (negative = overdue) */
export function daysUntilDue(nextDueDateStr: string): number {
  const today = todayIST();
  const nextDue = parseDate(nextDueDateStr);
  const diff = nextDue.getTime() - today.getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

/** Format ₹ currency */
export function formatAmount(n: number): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Substitute template placeholders */
export function applyTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

/** Generate a secure random password */
export function generatePassword(length = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$!";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => chars[b % chars.length]).join("");
}
