// ============================================================
// AgencyPay — Auth module
// Session management, role routing, logout
// ============================================================

const Auth = (() => {
  function save(token, role, name, id) {
    sessionStorage.setItem(CONFIG.TOKEN_KEY, token);
    sessionStorage.setItem(CONFIG.ROLE_KEY, role);
    sessionStorage.setItem(CONFIG.NAME_KEY, name);
    sessionStorage.setItem(CONFIG.ID_KEY, id);
    // Also persist in localStorage for page refreshes
    localStorage.setItem(CONFIG.TOKEN_KEY, token);
    localStorage.setItem(CONFIG.ROLE_KEY, role);
    localStorage.setItem(CONFIG.NAME_KEY, name);
    localStorage.setItem(CONFIG.ID_KEY, id);
  }

  function getToken() {
    return sessionStorage.getItem(CONFIG.TOKEN_KEY)
      || localStorage.getItem(CONFIG.TOKEN_KEY);
  }

  function getRole() {
    return sessionStorage.getItem(CONFIG.ROLE_KEY)
      || localStorage.getItem(CONFIG.ROLE_KEY);
  }

  function getName() {
    return sessionStorage.getItem(CONFIG.NAME_KEY)
      || localStorage.getItem(CONFIG.NAME_KEY) || 'User';
  }

  function getId() {
    return sessionStorage.getItem(CONFIG.ID_KEY)
      || localStorage.getItem(CONFIG.ID_KEY);
  }

  function isLoggedIn() {
    const token = getToken();
    if (!token) return false;
    // Decode JWT to check expiry (without verifying signature — server verifies)
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const now = Math.floor(Date.now() / 1000);
      return payload.exp > now;
    } catch {
      return false;
    }
  }

  function logout() {
    sessionStorage.clear();
    localStorage.removeItem(CONFIG.TOKEN_KEY);
    localStorage.removeItem(CONFIG.ROLE_KEY);
    localStorage.removeItem(CONFIG.NAME_KEY);
    localStorage.removeItem(CONFIG.ID_KEY);
    window.location.href = CONFIG.LOGIN;
  }

  /** Call at top of every protected page */
  function requireAuth(requiredRole) {
    if (!isLoggedIn()) {
      window.location.href = CONFIG.LOGIN;
      return false;
    }
    const role = getRole();
    if (requiredRole && role !== requiredRole) {
      // Redirect to appropriate home
      window.location.href = role === 'admin' ? CONFIG.ADMIN_HOME : CONFIG.CLIENT_HOME;
      return false;
    }
    return true;
  }

  /** Login — calls auth-login Edge Function */
  async function login(username, password, role) {
    const res = await fetch(`${CONFIG.FUNCTIONS_URL}/auth-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    save(data.token, data.role, data.name, data.id);
    return data;
  }

  return { login, logout, requireAuth, getToken, getRole, getName, getId, isLoggedIn };
})();
