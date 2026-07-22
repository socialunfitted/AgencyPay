// ============================================================
// AgencyPay — Frontend Configuration
// Fill in your Supabase project values before deploying
// ============================================================

const CONFIG = {
  // ── Supabase ──────────────────────────────────────────────
  // 1. Go to supabase.com → your project → Settings → API
  // 2. Copy "Project URL" → paste below
  SUPABASE_URL:      'https://givqmvmpjssqklhufigr.supabase.co',
  // 3. Copy "anon public" key → paste below
  SUPABASE_ANON_KEY: 'sb_publishable_f8uUSMWyMr4l4X67dLWm1A_j2M1ADG6',

  // ── Edge Function base URL (auto-derived from SUPABASE_URL)
  get FUNCTIONS_URL() {
    return this.SUPABASE_URL + '/functions/v1';
  },

  // ── App ───────────────────────────────────────────────────
  APP_NAME:   'AgencyPay',
  AGENCY_NAME: 'Your Agency Name',  // Shown in client header

  // ── Session ───────────────────────────────────────────────
  TOKEN_KEY:   'agencypay_token',
  ROLE_KEY:    'agencypay_role',
  NAME_KEY:    'agencypay_name',
  ID_KEY:      'agencypay_id',
  SESSION_TTL: 24 * 60 * 60 * 1000, // 24h in ms

  // ── Routes ───────────────────────────────────────────────
  ADMIN_HOME:  '/admin/dashboard.html',
  CLIENT_HOME: '/client/dashboard.html',
  LOGIN:       '/index.html',
};

// Freeze to prevent accidental mutation
Object.freeze(CONFIG);
