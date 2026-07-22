// ============================================================
// AgencyPay — Auth module using Supabase Auth (email + password)
// ============================================================

const Auth = (() => {
  let _session = null;

  // ── Internal: get role from session ─────────────────────
  function _role(session) {
    return session?.user?.user_metadata?.role || null;
  }

  function _name(session) {
    return session?.user?.user_metadata?.name
      || session?.user?.email
      || 'User';
  }

  // ── Login ────────────────────────────────────────────────
  async function login(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw new Error(error.message);

    _session = data.session;
    const role = _role(data.session);

    if (!role) {
      await supabaseClient.auth.signOut();
      throw new Error('Account has no role assigned. Contact your administrator.');
    }

    return {
      role,
      name: _name(data.session),
      id: data.user.id,
    };
  }

  // ── Logout ───────────────────────────────────────────────
  async function logout() {
    await supabaseClient.auth.signOut();
    window.location.href = CONFIG.LOGIN;
  }

  // ── Require auth (call at top of every protected page) ──
  async function requireAuth(requiredRole) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    _session = session;

    if (!session) {
      window.location.href = CONFIG.LOGIN;
      return false;
    }

    const role = _role(session);

    if (requiredRole && role !== requiredRole) {
      // Wrong role — redirect to correct home
      window.location.href = role === 'admin' ? CONFIG.ADMIN_HOME : CONFIG.CLIENT_HOME;
      return false;
    }

    return true;
  }

  // ── Sync getters (use cached _session — only valid after requireAuth) ──
  function getRole()  { return _role(_session); }
  function getName()  { return _name(_session); }
  function getId()    { return _session?.user?.id || null; }
  function getToken() { return _session?.access_token || null; }
  function isLoggedIn() { return !!_session; }

  // ── Listen for session changes (token refresh, sign-out) ──
  supabaseClient.auth.onAuthStateChange((event, session) => {
    _session = session;
    if (event === 'SIGNED_OUT') {
      window.location.href = CONFIG.LOGIN;
    }
  });

  return {
    login, logout, requireAuth,
    getRole, getName, getId, getToken, isLoggedIn,
  };
})();
