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
    const cleanEmail = email.trim().toLowerCase();

    // 1. Attempt standard Supabase Auth sign in
    let { data, error } = await supabaseClient.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (!error && data?.session) {
      _session = data.session;
      const role = _role(data.session) || 'client';
      return {
        role,
        name: _name(data.session),
        id: data.user.id,
      };
    }

    // 2. Auto-register attempt if user credentials were not in Auth yet
    try {
      const { data: sData, error: sErr } = await supabaseClient.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: { role: 'client', name: cleanEmail.split('@')[0] }
        }
      });
      if (!sErr && sData?.session) {
        _session = sData.session;
        return {
          role: 'client',
          name: _name(sData.session),
          id: sData.user.id,
        };
      }
    } catch (e) {
      console.warn('Auto-signup attempt:', e);
    }

    // 3. Client fallback: lookup registered email in public.clients database
    try {
      const { data: client } = await supabaseClient
        .from('clients')
        .select('id, business_name, email')
        .ilike('email', cleanEmail)
        .maybeSingle();

      if (client) {
        localStorage.setItem('ag_client_override_id', client.id);
        localStorage.setItem('ag_client_override_name', client.business_name);

        return {
          role: 'client',
          name: client.business_name,
          id: client.id,
          overrideUrl: `${CONFIG.CLIENT_HOME}?client_id=${client.id}`,
        };
      }
    } catch (e) {
      console.warn('Client fallback lookup error:', e);
    }

    if (error) throw new Error(error.message);
    throw new Error('Invalid login credentials');
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
