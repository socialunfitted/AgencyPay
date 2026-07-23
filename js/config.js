// ============================================================
// AgencyPay — Frontend Configuration
// ============================================================

const CONFIG = {
  // ── Supabase ──────────────────────────────────────────────
  SUPABASE_URL:      'https://givqmvmpjssqklhufigr.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_f8uUSMWyMr4l4X67dLWm1A_j2M1ADG6',

  // ── App ───────────────────────────────────────────────────
  APP_NAME: 'AgencyPay',
  
  get AGENCY_NAME() {
    return localStorage.getItem('ag_agency_name') || 'Social.Unfitted';
  },
  set AGENCY_NAME(val) {
    if (val) localStorage.setItem('ag_agency_name', val.trim());
  },

  get ADMIN_UPI_ID() {
    return localStorage.getItem('ag_admin_upi_id') || 'socialunfitted@okicici';
  },
  set ADMIN_UPI_ID(val) {
    if (val) localStorage.setItem('ag_admin_upi_id', val.trim());
  },

  get ADMIN_WHATSAPP() {
    return localStorage.getItem('ag_admin_whatsapp') || '919003490495';
  },
  set ADMIN_WHATSAPP(val) {
    if (val) localStorage.setItem('ag_admin_whatsapp', val.trim());
  },

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
