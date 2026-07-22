// ============================================================
// AgencyPay — Supabase Edge Function: auth-login
// POST /functions/v1/auth-login
// Body: { username, password, role: "admin" | "client" }
// Returns: { token, role, name, id }
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { create, getNumericDate } from "https://deno.land/x/djwt@v2.9.1/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Simple in-memory rate limiter (resets on cold start — good enough for edge)
const attempts: Map<string, { count: number; resetAt: number }> = new Map();
const RATE_LIMIT = 10;       // max attempts
const RATE_WINDOW = 60_000;  // per 60 seconds

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (rec.count >= RATE_LIMIT) return false;
  rec.count++;
  return true;
}

// JWT secret derived from Supabase JWT secret env var
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const ip = req.headers.get("x-forwarded-for") || "unknown";
  if (!checkRateLimit(ip)) {
    return new Response(JSON.stringify({ error: "Too many requests. Try again in a minute." }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { username, password, role } = await req.json();

    if (!username || !password || !role) {
      return new Response(JSON.stringify({ error: "username, password, and role are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let userId: string;
    let displayName: string;
    let storedHash: string;

    if (role === "admin") {
      const { data, error } = await supabase
        .from("admins")
        .select("id, name, password_hash")
        .eq("username", username.trim())
        .single();

      if (error || !data) {
        return new Response(JSON.stringify({ error: "Invalid credentials" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = data.id;
      displayName = data.name;
      storedHash = data.password_hash;

    } else if (role === "client") {
      const { data, error } = await supabase
        .from("clients")
        .select("id, business_name, password_hash, status")
        .eq("username", username.trim())
        .single();

      if (error || !data) {
        return new Response(JSON.stringify({ error: "Invalid credentials" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (data.status === "cancelled") {
        return new Response(JSON.stringify({ error: "Account is cancelled. Please contact your agency." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = data.id;
      displayName = data.business_name;
      storedHash = data.password_hash;

    } else {
      return new Response(JSON.stringify({ error: "Invalid role" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify password with bcrypt
    const valid = await bcrypt.compare(password, storedHash);
    if (!valid) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Issue JWT (24h expiry)
    const key = await getKey();
    const payload = {
      sub: userId,
      role,
      name: displayName,
      iat: getNumericDate(0),
      exp: getNumericDate(60 * 60 * 24), // 24 hours
    };
    const token = await create({ alg: "HS256", typ: "JWT" }, payload, key);

    return new Response(JSON.stringify({ token, role, name: displayName, id: userId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("auth-login error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
