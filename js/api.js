// ============================================================
// AgencyPay — API layer
// Uses Supabase JS client directly for CRUD (with RLS)
// Uses Edge Functions only for business logic that requires
// service_role (create auth users, send notifications, cron)
// ============================================================

const API = (() => {
  const sb = supabaseClient;

  // Helper: add auth header for Edge Function calls
  async function edgeCall(path, options = {}) {
    const token = Auth.getToken();
    const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }

  // ── Dashboard stats ───────────────────────────────────────
  const dashboard = {
    async getStats() {
      const [{ data: clients }, { data: settings }] = await Promise.all([
        sb.from('clients').select('id, business_name, monthly_amount, next_due_date, status'),
        sb.from('notification_settings').select('reminder_days_before').single(),
      ]);

      const reminderDays = settings?.reminder_days_before ?? 3;
      const active = (clients || []).filter(c => c.status === 'active');

      let totalMRR = 0, dueSoon = [], overdue = [];
      for (const c of active) {
        totalMRR += Number(c.monthly_amount);
        const bs = UI.getBillingStatus(c.next_due_date, reminderDays);
        if (bs === 'due_soon') dueSoon.push(c);
        if (bs === 'overdue')  overdue.push(c);
      }

      // Collected this month
      const today = new Date();
      const monthStart = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`;
      const monthEnd   = new Date(today.getFullYear(), today.getMonth()+1, 0)
        .toISOString().slice(0,10);

      const { data: payments } = await sb
        .from('payments')
        .select('amount')
        .gte('payment_date', monthStart)
        .lte('payment_date', monthEnd);

      const collectedThisMonth = (payments || []).reduce((s,p) => s + Number(p.amount), 0);

      return {
        active_clients: active.length,
        total_mrr: totalMRR,
        collected_this_month: collectedThisMonth,
        due_soon_count: dueSoon.length,
        overdue_count:  overdue.length,
        due_soon_clients: dueSoon.map(c => ({
          id: c.id, business_name: c.business_name,
          next_due_date: c.next_due_date, monthly_amount: c.monthly_amount,
        })),
        overdue_clients: overdue.map(c => ({
          id: c.id, business_name: c.business_name,
          next_due_date: c.next_due_date, monthly_amount: c.monthly_amount,
        })),
      };
    },
  };

  // ── Clients ───────────────────────────────────────────────
  const clients = {
    async list({ search = '', status = '' } = {}) {
      let q = sb.from('clients').select(
        'id,business_name,website_url,contact_person,email,whatsapp_number,' +
        'monthly_amount,subscription_start_date,last_paid_date,next_due_date,status,created_at'
      ).order('business_name');
      if (status && status !== 'all') q = q.eq('status', status);
      if (search) q = q.ilike('business_name', `%${search}%`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const { data: settings } = await sb.from('notification_settings').select('reminder_days_before').single();
      const rd = settings?.reminder_days_before ?? 3;
      return (data || []).map(c => ({
        ...c,
        billing_status: c.status === 'active' ? UI.getBillingStatus(c.next_due_date, rd) : c.status,
      }));
    },

    async get(id) {
      const { data: c, error } = await sb.from('clients').select(
        'id,business_name,website_url,contact_person,email,whatsapp_number,' +
        'monthly_amount,subscription_start_date,last_paid_date,next_due_date,status,created_at'
      ).eq('id', id).single();
      if (error) throw new Error('Client not found');

      const { data: payments } = await sb.from('payments')
        .select('id,amount,payment_date,payment_mode,reference_note,created_at')
        .eq('client_id', id).order('payment_date', { ascending: false });

      const { data: settings } = await sb.from('notification_settings').select('reminder_days_before').single();
      const rd = settings?.reminder_days_before ?? 3;

      return {
        ...c,
        billing_status: c.status === 'active' ? UI.getBillingStatus(c.next_due_date, rd) : c.status,
        payments: payments || [],
      };
    },

    // Create client + Supabase Auth user (with persistSession: false)
    async create(body) {
      const {
        business_name, website_url, contact_person, email, whatsapp_number,
        monthly_amount, subscription_start_date, password, status = 'active'
      } = body;

      if (!business_name || !email || !subscription_start_date) {
        throw new Error('Business name, email, and subscription start date are required');
      }

      const generatedPassword = password || Math.random().toString(36).slice(-8) + 'A1!';

      // 1. Create client Auth login using non-persisted Supabase client so Admin session is untouched
      let authUserId = null;
      try {
        const tempClient = window.supabase.createClient(
          CONFIG.SUPABASE_URL,
          CONFIG.SUPABASE_ANON_KEY,
          { auth: { persistSession: false } }
        );
        const { data: authData } = await tempClient.auth.signUp({
          email: email.trim(),
          password: generatedPassword,
          options: {
            data: { role: 'client', name: business_name.trim() }
          }
        });
        if (authData?.user) {
          authUserId = authData.user.id;
        }
      } catch (e) {
        console.warn('Auth user creation warning:', e);
      }

      // 2. Insert into clients table linked to auth_user_id
      const { data, error } = await sb
        .from('clients')
        .insert({
          auth_user_id: authUserId,
          business_name: business_name.trim(),
          website_url: website_url ? website_url.trim() : null,
          contact_person: contact_person ? contact_person.trim() : null,
          email: email.trim(),
          whatsapp_number: whatsapp_number ? whatsapp_number.trim() : null,
          monthly_amount: Number(monthly_amount) || 1000,
          billing_cycle: body.billing_cycle || 'monthly',
          subscription_start_date,
          next_due_date: subscription_start_date,
          status,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);

      return {
        ...data,
        generated_password: generatedPassword,
      };
    },

    async update(id, body) {
      const allowed = ['business_name','website_url','contact_person','email',
        'whatsapp_number','monthly_amount','billing_cycle','status'];
      const updates = {};
      for (const k of allowed) if (body[k] !== undefined) updates[k] = body[k];

      // If password provided during edit, create/update Supabase Auth credentials
      if (body.password) {
        const { data: existingClient } = await sb.from('clients').select('email, business_name, auth_user_id').eq('id', id).single();
        const clientEmail = (body.email || existingClient?.email || '').trim();
        const clientName = (body.business_name || existingClient?.business_name || '').trim();

        if (clientEmail) {
          try {
            const tempClient = window.supabase.createClient(
              CONFIG.SUPABASE_URL,
              CONFIG.SUPABASE_ANON_KEY,
              { auth: { persistSession: false } }
            );
            const { data: authData } = await tempClient.auth.signUp({
              email: clientEmail,
              password: body.password,
              options: { data: { role: 'client', name: clientName } }
            });
            if (authData?.user) {
              updates.auth_user_id = authData.user.id;
            }
          } catch (e) {
            console.warn('Auth password update warning:', e);
          }
        }
      }

      const { data, error } = await sb.from('clients').update(updates).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return data;
    },

    async updateStatus(id, status) {
      const { data, error } = await sb.from('clients').update({ status }).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return data;
    },

    async sendPasswordSetLink(id) {
      const { data: client, error } = await sb.from('clients').select('*').eq('id', id).single();
      if (error || !client) throw new Error('Client not found');

      const redirectUrl = `${window.location.origin}/index.html?type=recovery`;
      try {
        await sb.auth.resetPasswordForEmail(client.email, {
          redirectTo: redirectUrl,
        });
      } catch (e) {
        console.warn('Reset email note:', e);
      }

      const setupMsg = `Hi ${client.business_name},\n\nWelcome to ${CONFIG.AGENCY_NAME}! Please click the link below to set your account password and access your Client Billing Portal:\n\n${redirectUrl}&email=${encodeURIComponent(client.email)}`;
      let waUrl = null;

      if (client.whatsapp_number) {
        const phone = client.whatsapp_number.replace(/\D/g, '');
        waUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(setupMsg)}`;
      }

      return {
        success: true,
        email: client.email,
        waUrl,
        setupMsg,
      };
    },

    async delete(id) {
      const { error } = await sb.from('clients').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return { success: true };
    },
  };

  // ── Payments ──────────────────────────────────────────────
  const payments = {
    async markReceived({ client_id, amount, payment_date, payment_mode = 'UPI', reference_note = null }) {
      if (!client_id || !amount || !payment_date) {
        throw new Error('Client ID, amount, and payment date are required');
      }

      // 1. Insert payment record
      const { data: payData, error: payErr } = await sb
        .from('payments')
        .insert({
          client_id,
          amount: Number(amount),
          payment_date,
          payment_mode,
          reference_note,
        })
        .select()
        .single();

      if (payErr) throw new Error(payErr.message);

      // 2. Fetch client to check billing_cycle (monthly vs yearly)
      const { data: clientInfo } = await sb.from('clients').select('billing_cycle').eq('id', client_id).maybeSingle();
      const cycle = clientInfo?.billing_cycle || 'monthly';

      const pDate = new Date(payment_date + 'T00:00:00Z');
      const nextDue = new Date(pDate);
      if (cycle === 'yearly') {
        nextDue.setUTCFullYear(nextDue.getUTCFullYear() + 1);
      } else {
        nextDue.setUTCMonth(nextDue.getUTCMonth() + 1);
      }
      const nextDueDateStr = nextDue.toISOString().slice(0, 10);

      // 3. Update client record
      const { data: clientData, error: clientErr } = await sb
        .from('clients')
        .update({
          last_paid_date: payment_date,
          next_due_date: nextDueDateStr,
        })
        .eq('id', client_id)
        .select()
        .single();

      if (clientErr) throw new Error(clientErr.message);

      return {
        payment: payData,
        next_due_date: nextDueDateStr,
        client: clientData,
      };
    },
  };

  // ── Templates ─────────────────────────────────────────────
  const templates = {
    async list() {
      const { data, error } = await sb.from('notification_templates').select('*').order('type');
      if (error) throw new Error(error.message);
      return data || [];
    },

    async update({ id, channel, subject, message_body, is_active }) {
      const updates = { updated_at: new Date().toISOString() };
      if (channel !== undefined)      updates.channel = channel;
      if (subject !== undefined)      updates.subject = subject;
      if (message_body !== undefined) updates.message_body = message_body;
      if (is_active !== undefined)    updates.is_active = is_active;
      const { data, error } = await sb.from('notification_templates').update(updates).eq('id', id).select().single();
      if (error) throw new Error(error.message);
      return data;
    },

    async getSettings() {
      const { data, error } = await sb.from('notification_settings').select('*').single();
      if (error) throw new Error(error.message);
      return data;
    },

    async updateSettings({ reminder_days_before, grace_days_overdue }) {
      const { data: existing } = await sb.from('notification_settings').select('id').single();
      const updates = { updated_at: new Date().toISOString() };
      if (reminder_days_before !== undefined) updates.reminder_days_before = reminder_days_before;
      if (grace_days_overdue !== undefined)   updates.grace_days_overdue = grace_days_overdue;
      const { data, error } = await sb.from('notification_settings').update(updates).eq('id', existing.id).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
  };

  // ── Logs ──────────────────────────────────────────────────
  const logs = {
    async list({ channel, type, status, date_from, date_to, page = 1, page_size = 50 } = {}) {
      let q = sb.from('notifications_log')
        .select('id,channel,type,status,sent_at,error_message,clients!client_id(id,business_name,email)',
          { count: 'exact' })
        .order('sent_at', { ascending: false })
        .range((page-1)*page_size, page*page_size - 1);
      if (channel)   q = q.eq('channel', channel);
      if (type)      q = q.eq('type', type);
      if (status)    q = q.eq('status', status);
      if (date_from) q = q.gte('sent_at', date_from);
      if (date_to)   q = q.lte('sent_at', date_to + 'T23:59:59Z');
      const { data, count, error } = await q;
      if (error) throw new Error(error.message);
      return {
        data: data || [],
        total: count || 0,
        page, page_size,
        total_pages: Math.ceil((count || 0) / page_size),
      };
    },
  };

  // ── Notifications ─────────────────────────────────────────
  const notifications = {
    async send(client_id, type, channel = 'both') {
      const { data: client, error: cErr } = await sb
        .from('clients')
        .select('*')
        .eq('id', client_id)
        .single();
      if (cErr || !client) throw new Error('Client not found');

      const { data: template } = await sb
        .from('notification_templates')
        .select('*')
        .eq('type', type)
        .single();

      const messageTpl = template ? template.message_body : 'Payment reminder for {{website}}: ₹{{amount}} due on {{due_date}}';
      const subjectTpl = template ? template.subject : 'Payment Reminder — {{website}}';

      const vars = {
        client_name: client.business_name || 'Client',
        amount: Number(client.monthly_amount).toLocaleString('en-IN'),
        due_date: UI.formatDate(client.next_due_date),
        website: client.website_url ? client.website_url.replace(/^https?:\/\//, '') : 'your website',
      };

      let messageText = messageTpl;
      let subjectText = subjectTpl || 'Payment Notification';
      for (const [k, v] of Object.entries(vars)) {
        const re = new RegExp(`\\{\\{${k}\\}\\}`, 'g');
        messageText = messageText.replace(re, v);
        subjectText = subjectText.replace(re, v);
      }

      // Log to database directly
      const activeChannel = channel === 'both' ? (template?.channel || 'both') : channel;
      const logEntries = [];
      if (activeChannel === 'email' || activeChannel === 'both') {
        logEntries.push({ client_id, channel: 'email', type, status: 'sent' });
      }
      if (activeChannel === 'whatsapp' || activeChannel === 'both') {
        logEntries.push({ client_id, channel: 'whatsapp', type, status: 'sent' });
      }
      if (logEntries.length > 0) {
        await sb.from('notifications_log').insert(logEntries);
      }

      // Pre-fill WhatsApp URL
      let waUrl = null;
      if (client.whatsapp_number && (activeChannel === 'whatsapp' || activeChannel === 'both')) {
        const phone = client.whatsapp_number.replace(/\D/g, '');
        waUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(messageText)}`;
      }

      // Pre-fill Gmail Web Compose URL & mailto URL
      let gmailUrl = null;
      let mailtoUrl = null;
      if (client.email && (activeChannel === 'email' || activeChannel === 'both')) {
        gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(client.email)}&su=${encodeURIComponent(subjectText)}&body=${encodeURIComponent(messageText)}`;
        mailtoUrl = `mailto:${encodeURIComponent(client.email)}?subject=${encodeURIComponent(subjectText)}&body=${encodeURIComponent(messageText)}`;
      }

      // Attempt Edge Function call if configured
      try {
        await edgeCall('send-notification', { method: 'POST', body: JSON.stringify({ client_id, type, channel }) });
      } catch (e) {
        console.log('Edge Function fallback: message logged directly');
      }

      return {
        success: true,
        messageText,
        subjectText,
        waUrl,
        gmailUrl,
        mailtoUrl,
        client,
      };
    },

    async runCron() {
      const { data: clients, error: cErr } = await sb
        .from('clients')
        .select('*')
        .eq('status', 'active');

      if (cErr) throw new Error(cErr.message);
      if (!clients || !clients.length) {
        return { success: true, processed: 0, sent: 0, message: 'No active clients to process.' };
      }

      const { data: settings } = await sb.from('notification_settings').select('*').maybeSingle();
      const reminderDays = settings?.reminder_days_before ?? 3;

      let sentCount = 0;
      for (const client of clients) {
        if (!client.next_due_date) continue;

        const daysDiff = UI.daysUntilDue(client.next_due_date);
        let type = null;

        if (daysDiff === 0) {
          type = 'due_today';
        } else if (daysDiff < 0) {
          type = 'overdue';
        } else if (daysDiff <= reminderDays) {
          type = 'upcoming_due';
        }

        if (type) {
          try {
            await notifications.send(client.id, type, 'both');
            sentCount++;
          } catch (e) {
            console.warn(`Cron send error for client ${client.id}:`, e);
          }
        }
      }

      try {
        await edgeCall('daily-cron', { method: 'POST', body: '{}' });
      } catch (e) {
        console.log('Daily cron fallback executed');
      }

      return {
        success: true,
        processed: clients.length,
        sent: sentCount,
        message: `Processed ${clients.length} active client(s). ${sentCount} reminder(s) generated.`,
      };
    },
  };

  // ── Client Portal ─────────────────────────────────────────
  const clientPortal = {
    async getData() {
      const urlParams = new URLSearchParams(window.location.search);
      const overrideClientId = urlParams.get('client_id') || localStorage.getItem('ag_client_override_id');

      let client = null;

      if (overrideClientId) {
        const { data, error } = await sb.from('clients').select(
          'id,business_name,website_url,contact_person,email,whatsapp_number,monthly_amount,' +
          'subscription_start_date,last_paid_date,next_due_date,status,created_at'
        ).eq('id', overrideClientId).single();

        if (error || !data) throw new Error('Client not found');
        client = data;
      } else {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        let { data: cData } = await sb.from('clients').select(
          'id,business_name,website_url,contact_person,email,whatsapp_number,monthly_amount,' +
          'subscription_start_date,last_paid_date,next_due_date,status,created_at'
        ).eq('auth_user_id', user.id).maybeSingle();

        if (!cData && user.email) {
          const { data: clientByEmail } = await sb.from('clients').select(
            'id,business_name,website_url,contact_person,email,whatsapp_number,monthly_amount,' +
            'subscription_start_date,last_paid_date,next_due_date,status,created_at'
          ).eq('email', user.email.trim()).maybeSingle();

          if (clientByEmail) {
            cData = clientByEmail;
            await sb.from('clients').update({ auth_user_id: user.id }).eq('id', cData.id);
          }
        }

        if (!cData) throw new Error('Account not found. Contact your agency administrator.');
        client = cData;
      }

      const { data: payments } = await sb.from('payments')
        .select('id,amount,payment_date,payment_mode,reference_note,created_at')
        .eq('client_id', client.id).order('payment_date', { ascending: false });

      const { data: settings } = await sb.from('notification_settings').select('reminder_days_before').single();
      const rd = settings?.reminder_days_before ?? 3;

      const billingStatus = UI.getBillingStatus(client.next_due_date, rd);
      const daysDiff = UI.daysUntilDue(client.next_due_date);

      let countdownText;
      if (daysDiff > 0)      countdownText = `Due in ${daysDiff} day${daysDiff === 1 ? '' : 's'}`;
      else if (daysDiff === 0) countdownText = 'Due Today';
      else                   countdownText = `Overdue by ${Math.abs(daysDiff)} day${Math.abs(daysDiff) === 1 ? '' : 's'}`;

      // 12-month strip
      const today = new Date();
      const monthlyStrip = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const yr = d.getFullYear(), mo = d.getMonth() + 1;
        const label = d.toLocaleString('en-IN', { month: 'short', year: '2-digit' });
        const paid = (payments || []).some(p => {
          const pd = new Date(p.payment_date + 'T00:00:00Z');
          return pd.getUTCFullYear() === yr && pd.getUTCMonth() + 1 === mo;
        });
        const isUpcoming = d > today;
        monthlyStrip.push({ month: label, status: isUpcoming ? 'upcoming' : paid ? 'paid' : 'unpaid' });
      }

      return {
        client: {
          ...client,
          billing_status: billingStatus,
          days_until_due: daysDiff,
          countdown_text: countdownText,
          next_due_date_formatted: UI.formatDate(client.next_due_date),
        },
        payments: (payments || []).map(p => ({
          ...p,
          payment_date_formatted: UI.formatDate(p.payment_date),
        })),
        monthly_strip: monthlyStrip,
      };
    },
  };

  return { dashboard, clients, payments, templates, logs, notifications, clientPortal };
})();

// ============================================================
// Shared UI utilities
// ============================================================
const UI = (() => {
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

  function formatRupees(amount) {
    return '₹' + Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00Z');
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  }

  function getBillingStatus(nextDueDateStr, reminderDaysBefore = 3) {
    const today = new Date();
    const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    const nextDue = new Date(nextDueDateStr + 'T00:00:00Z');
    const dueSoonStart = new Date(nextDue);
    dueSoonStart.setUTCDate(dueSoonStart.getUTCDate() - reminderDaysBefore);
    if (todayUTC < dueSoonStart) return 'current';
    if (todayUTC <= nextDue)     return 'due_soon';
    return 'overdue';
  }

  function daysUntilDue(nextDueDateStr) {
    const today = new Date();
    const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    const nextDue = new Date(nextDueDateStr + 'T00:00:00Z');
    return Math.round((nextDue - todayUTC) / (1000 * 60 * 60 * 24));
  }

  function statusBadge(status) {
    const map = {
      current:   ['Current',  'current'],
      due_soon:  ['Due Soon', 'due-soon'],
      overdue:   ['Overdue',  'overdue'],
      active:    ['Active',   'active'],
      paused:    ['Paused',   'paused'],
      cancelled: ['Cancelled','cancelled'],
    };
    const [label, cls] = map[status] || [status, 'paused'];
    return `<span class="badge badge-${cls}"><span class="badge-dot"></span>${label}</span>`;
  }

  function openModal(id)  { document.getElementById(id)?.classList.add('open');    document.body.style.overflow = 'hidden'; }
  function closeModal(id) { document.getElementById(id)?.classList.remove('open'); document.body.style.overflow = ''; }

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

  function paymentModeIcon(mode) {
    const icons = { 'UPI':'📱','Bank Transfer':'🏦','Cash':'💵','Razorpay':'💳','Other':'💰' };
    return `<span class="payment-mode-badge">${icons[mode] || '💰'} ${mode}</span>`;
  }

  function initials(name) {
    return (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  return {
    toast, formatRupees, formatDate, getBillingStatus, daysUntilDue,
    statusBadge, openModal, closeModal, setLoading, paymentModeIcon, initials,
  };
})();
