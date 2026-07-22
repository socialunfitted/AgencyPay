// ============================================================
// AgencyPay — API layer
// All calls to Supabase Edge Functions
// ============================================================

const API = (() => {
  async function call(path, options = {}) {
    const token = Auth.getToken();
    const res = await fetch(`${CONFIG.FUNCTIONS_URL}/${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });

    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      Auth.logout();
      return;
    }

    if (!res.ok) {
      throw new Error(data.error || `Request failed: ${res.status}`);
    }
    return data;
  }

  // ── Dashboard ──────────────────────────────────────────────
  const dashboard = {
    getStats: () => call('admin-dashboard'),
  };

  // ── Clients ───────────────────────────────────────────────
  const clients = {
    list: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return call(`admin-clients${qs ? '?' + qs : ''}`);
    },
    get: (id) => call(`admin-clients?id=${id}`),
    create: (body) => call('admin-clients', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => call(`admin-clients?id=${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    updateStatus: (id, status) => call(`admin-clients?id=${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    delete: (id) => call(`admin-clients?id=${id}`, { method: 'DELETE' }),
  };

  // ── Payments ──────────────────────────────────────────────
  const payments = {
    markReceived: (body) => call('admin-payments', { method: 'POST', body: JSON.stringify(body) }),
  };

  // ── Templates ─────────────────────────────────────────────
  const templates = {
    list: () => call('admin-templates'),
    update: (body) => call('admin-templates', { method: 'PUT', body: JSON.stringify(body) }),
    getSettings: () => call('admin-templates/settings'),
    updateSettings: (body) => call('admin-templates', { method: 'PATCH', body: JSON.stringify(body) }),
  };

  // ── Logs ──────────────────────────────────────────────────
  const logs = {
    list: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return call(`admin-logs${qs ? '?' + qs : ''}`);
    },
  };

  // ── Notifications ─────────────────────────────────────────
  const notifications = {
    send: (client_id, type, channel) =>
      call('send-notification', { method: 'POST', body: JSON.stringify({ client_id, type, channel }) }),
    runCron: () => call('daily-cron', { method: 'POST', body: '{}' }),
  };

  // ── Client Portal ─────────────────────────────────────────
  const clientPortal = {
    getData: () => call('client-portal'),
  };

  return { dashboard, clients, payments, templates, logs, notifications, clientPortal };
})();

// ============================================================
// Shared UI utilities used across all pages
// ============================================================

const UI = (() => {
  // Toast notification
  function toast(message, type = 'default') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    const icons = { success: '✓', error: '✕', warning: '⚠', default: 'ℹ' };
    el.innerHTML = `<span>${icons[type] || icons.default}</span><span>${message}</span>`;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // Format currency (₹)
  function formatRupees(amount) {
    return '₹' + Number(amount).toLocaleString('en-IN', {
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
  }

  // Format date as DD/MM/YYYY
  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00Z');
    return d.toLocaleDateString('en-IN', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
    });
  }

  // Get billing status given next_due_date and reminderDaysBefore
  function getBillingStatus(nextDueDateStr, reminderDaysBefore = 3) {
    const today = new Date();
    // Normalize to UTC midnight for today
    const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    const nextDue = new Date(nextDueDateStr + 'T00:00:00Z');
    const dueSoonStart = new Date(nextDue);
    dueSoonStart.setUTCDate(dueSoonStart.getUTCDate() - reminderDaysBefore);
    if (todayUTC < dueSoonStart) return 'current';
    if (todayUTC <= nextDue) return 'due_soon';
    return 'overdue';
  }

  // Build a status badge element
  function statusBadge(status) {
    const map = {
      current:    ['Current', 'current'],
      due_soon:   ['Due Soon', 'due-soon'],
      overdue:    ['Overdue', 'overdue'],
      active:     ['Active', 'active'],
      paused:     ['Paused', 'paused'],
      cancelled:  ['Cancelled', 'cancelled'],
    };
    const [label, cls] = map[status] || [status, 'paused'];
    return `<span class="badge badge-${cls}"><span class="badge-dot"></span>${label}</span>`;
  }

  // Modal open/close helpers
  function openModal(id) {
    document.getElementById(id)?.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
    document.body.style.overflow = '';
  }

  // Set loading state on a button
  function setLoading(btn, loading) {
    if (loading) {
      btn.dataset.originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span> ${btn.dataset.loadingText || 'Loading…'}`;
    } else {
      btn.disabled = false;
      btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
    }
  }

  // Show/hide page loader
  function showLoader(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = `<div class="page-loader"><div class="loader"></div></div>`;
  }

  // Format payment mode
  function paymentModeIcon(mode) {
    const icons = { 'UPI': '📱', 'Bank Transfer': '🏦', 'Cash': '💵', 'Razorpay': '💳', 'Other': '💰' };
    return `<span class="payment-mode-badge">${icons[mode] || '💰'} ${mode}</span>`;
  }

  // Get initials from name
  function initials(name) {
    return (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  return {
    toast, formatRupees, formatDate, getBillingStatus,
    statusBadge, openModal, closeModal, setLoading, showLoader,
    paymentModeIcon, initials,
  };
})();
