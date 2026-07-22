# AgencyPay — Client Subscription & Billing Portal

A full-stack web application for digital agencies to manage recurring monthly billing for website clients. Built with Supabase (Postgres + Edge Functions) + static HTML/CSS/JS.

---

## Features

- ✅ Role-based login (Admin + Client) with bcrypt password hashing
- ✅ Admin-only client creation — no public registration
- ✅ Automatic next-due-date calculation (server-side, IST, month-end safe)
- ✅ Daily cron at 9:00 AM IST for Upcoming Due / Due Today / Overdue reminders
- ✅ WhatsApp + Email notifications (Meta Cloud API + Resend)
- ✅ Editable notification templates with placeholder support
- ✅ Full notification logs with status tracking
- ✅ Client dashboard with countdown, monthly strip, and payment history
- ✅ Rate-limited login endpoint

---

## Setup Guide

### Step 1 — Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Note your **Project URL** and **anon key** from: Settings → API
3. Note your **service role key** and **JWT secret** from the same page

### Step 2 — Run the Database Migration

1. Open your Supabase project → **SQL Editor**
2. Copy and paste the entire contents of `supabase/migrations/001_initial_schema.sql`
3. Click **Run**

This creates all tables, RLS policies, seeds the default admin account, and seeds the 4 notification templates.

> ⚠️ **Change the default admin password immediately!**
> Default: username `admin`, password `Admin@123`
> Change it from the Supabase SQL Editor:
> ```sql
> UPDATE admins SET password_hash = crypt('YourNewPassword', gen_salt('bf', 12))
> WHERE username = 'admin';
> ```

### Step 3 — Deploy Edge Functions

Install the Supabase CLI:
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Deploy all functions:
```bash
supabase functions deploy auth-login
supabase functions deploy admin-clients
supabase functions deploy admin-payments
supabase functions deploy admin-dashboard
supabase functions deploy admin-templates
supabase functions deploy admin-logs
supabase functions deploy client-portal
supabase functions deploy send-notification
supabase functions deploy daily-cron
```

### Step 4 — Set Edge Function Secrets

Copy `supabase/.env.example` to `supabase/.env` and fill in your values, then:

```bash
supabase secrets set --env-file supabase/.env
```

Or set them one by one in the Supabase Dashboard:
**Settings → Edge Functions → Secrets**

Required secrets:
| Secret | Where to get it |
|--------|----------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API |
| `JWT_SECRET` | Supabase → Settings → API → JWT Secret |
| `RESEND_API_KEY` | resend.com → API Keys |
| `EMAIL_FROM` | Your verified sender domain in Resend |
| `WHATSAPP_ACCESS_TOKEN` | Meta Developer Portal → WhatsApp → API Setup |
| `WHATSAPP_PHONE_NUMBER_ID` | Same page as above |

> **WhatsApp not ready yet?** Leave `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` unset. The function will mock the send and log `success` — you can wire it up later without any code changes.

### Step 5 — Configure the Frontend

Open `js/config.js` and fill in:

```js
SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co',
SUPABASE_ANON_KEY: 'YOUR_ANON_KEY',
AGENCY_NAME: 'Your Agency Name',  // Shown in client dashboard header
APP_NAME: 'AgencyPay',            // Can be renamed to your portal name
```

### Step 6 — Enable the Daily Cron Job

In the Supabase SQL Editor, uncomment and run the `cron.schedule(...)` block at the bottom of `001_initial_schema.sql` — replace `YOUR_PROJECT_REF` and `YOUR_SERVICE_ROLE_KEY`:

```sql
SELECT cron.schedule(
  'agencypay-daily-cron',
  '30 3 * * *',  -- 09:00 IST = 03:30 UTC
  $$
    SELECT net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/daily-cron',
      headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY", "Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    )
  $$
);
```

> Requires the `pg_net` extension. Enable it in: **Database → Extensions → pg_net**

### Step 7 — Deploy to Hostinger (or any static host)

Upload all files (everything except the `supabase/` folder) to your hosting:

```
index.html
admin/
client/
css/
js/
```

The `supabase/` folder stays on your machine (source code for Edge Functions and migrations).

---

## Default Login

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `Admin@123` ← **Change immediately** |

---

## Branding Customization

| File | What to change |
|------|---------------|
| `js/config.js` | `APP_NAME`, `AGENCY_NAME` |
| All HTML `<title>` tags | Portal name |
| `css/main.css` `:root` | `--color-brand-*` for accent color |
| Emoji `💳` in sidebar/header | Your logo image |

---

## Notification Template Placeholders

| Placeholder | Replaced with |
|-------------|--------------|
| `{{client_name}}` | Client's business name |
| `{{amount}}` | Monthly amount (e.g. 2,500) |
| `{{due_date}}` | Next due date (DD/MM/YYYY) |
| `{{website}}` | Client's website URL |

---

## WhatsApp Provider Swap

All WhatsApp sending is isolated to the `sendWhatsAppMessage()` function in `supabase/functions/send-notification/index.ts`. To switch provider, only replace that function body — the rest of the app is untouched.

```
Supported providers (swap by editing sendWhatsAppMessage):
- Meta Cloud API (default, scaffolded)
- WATI: POST https://live-server.wati.io/api/v1/sendSessionMessage
- AiSensy: POST https://backend.aisensy.com/campaign/t1/api/v2
- Interakt: POST https://api.interakt.ai/v1/public/message/
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5 + CSS3 + Vanilla JS |
| Backend | Supabase Edge Functions (Deno/TypeScript) |
| Database | Supabase Postgres |
| Auth | Custom JWT (bcrypt + HMAC-SHA256) |
| Email | Resend API |
| WhatsApp | Meta Cloud API (swappable) |
| Cron | Supabase pg_cron + pg_net |
| Hosting | Static (Hostinger, Netlify, Vercel, etc.) |
