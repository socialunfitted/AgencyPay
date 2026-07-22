// ============================================================
// AgencyPay — Frontend Configuration
// ============================================================

const CONFIG = {
  // ── Supabase ──────────────────────────────────────────────
  SUPABASE_URL:      'https://givqmvmpjssqklhufigr.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_f8uUSMWyMr4l4X67dLWm1A_j2M1ADG6',

  // ── App ───────────────────────────────────────────────────
  APP_NAME:        'AgencyPay',
  AGENCY_NAME:     'Social.Unfitted',
  ADMIN_WHATSAPP:  '919003490495',

  // ── Routes ───────────────────────────────────────────────
  ADMIN_HOME:  '/admin/dashboard.html',
  CLIENT_HOME: '/client/dashboard.html',
  LOGIN:       '/index.html',
};

// Initialize the Supabase JS client (loaded via CDN before this script)
const supabaseClient = window.supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY
);

Object.freeze(CONFIG);
