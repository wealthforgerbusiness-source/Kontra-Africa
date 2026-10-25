import {
  auth,
  api,
  onUser,
  signInEmail,
  signInGoogle,
  finishRedirect,
  logout,
  completeLogin,
  errorMessage
} from './firebase.js';
import {
  $,
  $$,
  h,
  clear,
  toast,
  setLoading,
  confirmDialog,
  formatDate,
  initUI,
  watchNetwork
} from './ui.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TITLES = {
  overview: 'Vue d’ensemble',
  users: 'Utilisateurs',
  revenue: 'Revenus',
  alerts: 'Alertes'
};
const PLAN_LABEL = { trial: 'Essai', starter: 'Starter', business: 'Business', pro: 'Pro' };
const STATUS_LABEL = { trial: 'En essai', active: 'Payant', expired: 'Expiré' };

const state = {
  view: 'overview',
  stats: null,
  users: [],
  usersStatus: '',
  usersBefore: null,
  usersLoaded: false,
  payments: [],
  paymentsBefore: null,
  paymentsLoaded: false,
  alertsLoaded: false,
  routeId: 0
};

/* ---------- Écrans ---------- */

function setHidden(node, hidden) {
  if (node) node.classList.toggle('hide', Boolean(hidden));
}

function setSplash(on) {
  const splash = $('#splash');
  if (splash) splash.classList.toggle('done', !on);
}

function setError(message) {
  const node = $('#adm-error');
  if (!node) return;
  node.textContent = message || '';
  setHidden(node, !message);
}

function showLogin() {
  setSplash(false);
  setHidden($('#app'), true);
  setHidden($('#auth'), false);
  setHidden($('#pane-denied'), true);
  setHidden($('#pane-login'), false);
  document.body.classList.add('is-auth');
}

function showDenied(text) {
  setSplash(false);
  setHidden($('#app'), true);
  setHidden($('#auth'), false);
  setHidden($('#pane-login'), true);
  setHidden($('#pane-denied'), false);
  const node = $('#denied-text');
  if (node) node.textContent = text || 'Ce compte n’a pas accès à l’administration.';
  document.body.classList.add('is-auth');
}

function showApp(user) {
  setSplash(false);
  setHidden($('#auth'), true);
  setHidden($('#app'), false);
  document.body.classList.remove('is-auth');
  const mail = $('#side-email');
  if (mail) mail.textContent = user.email || '';
}

/* ---------- Formatage ---------- */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function usd(value) {
  return '$' + num(value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function local(map) {
  const parts = Object.keys(map || {})
    .filter((cur) => num(map[cur]) !== 0)
    .map((cur) => num(map[cur]).toLocaleString('fr-FR') + ' ' + cur);
  return parts.length ? parts.join(' · ') : '—';
}

function monthLabel(id) {
  const [y, m] = String(id).split('-').map(Number);
  if (!y || !m) return String(id);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function stat(label, value, cls) {
  return h('div', { class: 'stat' + (cls ? ' ' + cls : '') }, h('small', { text: label }), h('strong', { text: value }));
}

function emptyBox(text) {
  return h('div', { class: 'empty' }, h('p', { text }));
}

function row(title, sub, endTop, endSub, actions) {
  return h(
    'div',
    { class: 'item' },
    h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: title }), h('div', { class: 'item-sub', text: sub })),
    h('div', { class: 'item-end' }, endTop, endSub ? h('small', { text: endSub }) : null),
    actions || null
  );
}

/* ---------- Navigation ---------- */

function go(view) {
  if (!TITLES[view]) return;
  state.view = view;
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === view));
  $$('[data-nav]').forEach((b) => {
    const on = b.dataset.nav === view;
    b.classList.toggle('active', on);
    b.classList.toggle('is-active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  const title = $('#topbar-title');
  if (title) title.textContent = TITLES[view];
  window.scrollTo(0, 0);
  loadView(view, false);
}

async function loadView(view, force) {
  try {
    if (view === 'overview' || view === 'revenue') {
      if (force || !state.stats) await loadStats();
      if (view === 'overview') renderOverview();
      else {
        renderRevenue();
        if (force || !state.paymentsLoaded) await loadPayments(true);
      }
    } else if (view === 'users') {
      if (force || !state.usersLoaded) await loadUsers(true);
    } else if (view === 'alerts') {
      if (force || !state.alertsLoaded) await loadAlerts();
    }
  } catch (err) {
    handleApiError(err);
  }
}

function handleApiError(err) {
  if (err && (err.status === 401 || err.status === 403)) {
    showDenied(errorMessage(err));
    return;
  }
  toast(errorMessage(err), 'error');
}

/* ---------- Données ---------- */

async function loadStats() {
  const data = await api('/api/admin/stats', { retry: true });
  state.stats = data;
  const upd = $('#adm-updated');
  if (upd) upd.textContent = 'Mis à jour ' + new Date(data.generatedAtMs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function renderOverview() {
  const s = state.stats;
  if (!s) return;
  const c = s.counters;

  const users = $('#ov-users');
  clear(users);
  users.append(
    stat('Utilisateurs', String(c.total), 'hero'),
    stat('En essai', String(c.trial), 'gold'),
    stat('Payants', String(c.active)),
    stat('Expirés', String(c.expired), 'warn')
  );

  const mrr = $('#ov-mrr');
  clear(mrr);
  mrr.append(stat('MRR (≈ USD)', usd(s.mrr.mrrUsd), 'hero'));
  Object.keys(s.mrr.mrr || {}).forEach((cur) => {
    mrr.append(stat('MRR ' + cur, num(s.mrr.mrr[cur]).toLocaleString('fr-FR') + ' ' + cur, 'gold'));
  });

  const m = s.thisMonth;
  $('#ov-month-title').textContent = monthLabel(m.month);
  const month = $('#ov-month');
  clear(month);
  month.append(
    row('Paiements', 'ce mois-ci', String(m.paidCount)),
    row('Brut', local(m.gross), usd(m.grossUsd)),
    row('Frais SasPay', local(m.fee), usd(m.feeUsd)),
    row('Gain net', local(m.net), usd(m.netUsd))
  );

  const plans = $('#ov-plans');
  clear(plans);
  const byPlan = s.mrr.activeByPlan || {};
  Object.keys(byPlan).forEach((id) => plans.append(row(PLAN_LABEL[id] || id, 'abonnés actifs', String(byPlan[id]))));
  if (!Object.keys(byPlan).length) plans.append(emptyBox('Aucun abonné pour le moment.'));

  const del = $('#ov-deleted');
  clear(del);
  del.append(
    row('Total supprimés', 'depuis le début', String(c.deleted)),
    row('Essais non payés', 'supprimés automatiquement', String(c.deletedTrial)),
    row('Comptes payants', 'supprimés', String(c.deletedPaid)),
    row('Supprimés à la main', 'par l’administrateur', String(c.deletedManual))
  );
}

function renderRevenue() {
  const s = state.stats;
  if (!s) return;
  const months = s.months.slice().reverse();
  const max = Math.max(1, ...months.map((m) => num(m.netUsd)));

  const bars = $('#rv-bars');
  clear(bars);
  months.forEach((m) => {
    bars.append(
      h(
        'div',
        { class: 'bar-row' },
        h('span', { text: monthLabel(m.month) }),
        h('div', { class: 'meter-bar' }, h('i', { style: 'width:' + Math.round((num(m.netUsd) / max) * 100) + '%' })),
        h('b', { text: usd(m.netUsd) })
      )
    );
  });

  const table = $('#rv-table');
  clear(table);
  s.months.forEach((m) => {
    table.append(
      h(
        'tr',
        {},
        h('td', { text: monthLabel(m.month) }),
        h('td', { text: String(m.paidCount) }),
        h('td', { text: usd(m.grossUsd) }),
        h('td', { text: usd(m.feeUsd) }),
        h('td', { text: usd(m.netUsd) })
      )
    );
  });

  const sel = $('#rv-month');
  if (sel && !sel.options.length) {
    s.months.forEach((m) => sel.append(h('option', { value: m.month, text: monthLabel(m.month) })));
  }
  renderCountries();
}

function renderCountries() {
  const s = state.stats;
  const sel = $('#rv-month');
  const body = $('#rv-country');
  if (!s || !sel || !body) return;
  clear(body);
  const m = s.months.find((x) => x.month === sel.value) || s.months[0];
  const entries = Object.keys(m.byCountry || {});
  if (!entries.length) {
    body.append(h('tr', {}, h('td', { colspan: '4', class: 'muted', text: 'Aucun paiement ce mois-là.' })));
    return;
  }
  entries.forEach((code) => {
    const d = m.byCountry[code] || {};
    body.append(
      h(
        'tr',
        {},
        h('td', { text: code }),
        h('td', { text: String(num(d.paidCount || d.count)) }),
        h('td', { text: local(d.gross && typeof d.gross === 'object' ? d.gross : {}) }),
        h('td', { text: local(d.net && typeof d.net === 'object' ? d.net : {}) })
      )
    );
  });
}

async function loadUsers(reset) {
  if (reset) {
    state.users = [];
    state.usersBefore = null;
  }
  let path = '/api/admin/users?limit=25';
  if (state.usersStatus) path += '&status=' + encodeURIComponent(state.usersStatus);
  if (!reset && state.usersBefore !== null) path += '&before=' + encodeURIComponent(state.usersBefore);
  const data = await api(path, { retry: true });
  state.users = state.users.concat(data.users || []);
  state.usersBefore = data.nextBefore;
  state.usersLoaded = true;
  renderUsers();
}

function renderUsers() {
  const q = String(($('#us-search') || {}).value || '').trim().toLowerCase();
  const list = $('#us-list');
  clear(list);
  const shown = state.users.filter(
    (u) => !q || String(u.email || '').toLowerCase().includes(q) || String(u.name || '').toLowerCase().includes(q)
  );
  $('#us-count').textContent = shown.length + ' affiché(s)';
  if (!shown.length) list.append(emptyBox('Aucun utilisateur.'));

  shown.forEach((u) => {
    const del = u.isAdmin
      ? h('span', { class: 'badge badge-dark', text: 'Admin' })
      : h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Supprimer', onclick: () => deleteUser(u) });
    list.append(
      row(
        u.email || u.uid,
        [PLAN_LABEL[u.planId] || u.planId, u.country, u.createdAtMs ? 'inscrit le ' + formatDate(u.createdAtMs) : null]
          .filter(Boolean)
          .join(' · '),
        STATUS_LABEL[u.status] || u.status,
        u.status === 'expired'
          ? u.daysUntilDelete !== null
            ? 'suppression dans ' + u.daysUntilDelete + ' j'
            : 'expiré'
          : u.daysLeft + ' j restants',
        del
      )
    );
  });
  setHidden($('#us-more'), state.usersBefore === null);
}

async function deleteUser(u) {
  const ok = await confirmDialog({
    title: 'Supprimer ce compte ?',
    text: (u.email || u.uid) + ' et toutes ses données seront supprimés définitivement.',
    ok: 'Supprimer',
    danger: true
  });
  if (!ok) return;
  try {
    await api('/api/admin/users/' + encodeURIComponent(u.uid) + '/delete', { method: 'POST', body: { confirm: true } });
    toast('Compte supprimé.');
    state.stats = null;
    await loadUsers(true);
  } catch (err) {
    handleApiError(err);
  }
}

async function loadPayments(reset) {
  if (reset) {
    state.payments = [];
    state.paymentsBefore = null;
  }
  let path = '/api/admin/payments?limit=25';
  if (!reset && state.paymentsBefore !== null) path += '&before=' + encodeURIComponent(state.paymentsBefore);
  const data = await api(path, { retry: true });
  state.payments = state.payments.concat(data.payments || []);
  state.paymentsBefore = data.nextBefore;
  state.paymentsLoaded = true;

  const list = $('#pay-list');
  clear(list);
  if (!state.payments.length) list.append(emptyBox('Aucun paiement.'));
  state.payments.forEach((p) => {
    list.append(
      row(
        num(p.amount).toLocaleString('fr-FR') + ' ' + (p.currency || ''),
        [PLAN_LABEL[p.planId] || p.planId, p.country, p.network].filter(Boolean).join(' · '),
        p.status || '—',
        p.createdAtMs ? formatDate(p.createdAtMs) : ''
      )
    );
  });
  setHidden($('#pay-more'), state.paymentsBefore === null);
}

async function loadAlerts() {
  const data = await api('/api/admin/alerts', { retry: true });
  state.alertsLoaded = true;

  const review = $('#al-review');
  const unmatched = $('#al-unmatched');
  clear(review);
  clear(unmatched);

  const dismiss = (id) =>
    h('button', {
      type: 'button',
      class: 'btn btn-ghost btn-sm',
      text: 'Ignorer',
      onclick: async () => {
        try {
          await api('/api/admin/payments/' + encodeURIComponent(id) + '/dismiss', { method: 'POST', body: {} });
          toast('Alerte ignorée.');
          await loadAlerts();
        } catch (err) {
          handleApiError(err);
        }
      }
    });

  if (!data.review.length) review.append(emptyBox('Rien à vérifier.'));
  data.review.forEach((p) =>
    review.append(
      row(
        num(p.amount).toLocaleString('fr-FR') + ' ' + (p.currency || ''),
        [PLAN_LABEL[p.planId] || p.planId, p.reason, p.saspayTxId].filter(Boolean).join(' · '),
        '',
        p.createdAtMs ? formatDate(p.createdAtMs) : '',
        dismiss(p.id)
      )
    )
  );

  if (!data.unmatched.length) unmatched.append(emptyBox('Aucun paiement orphelin.'));
  data.unmatched.forEach((p) =>
    unmatched.append(
      row(
        p.amount ? num(p.amount).toLocaleString('fr-FR') + ' ' + (p.currency || '') : 'Montant inconnu',
        [p.reason, p.country, p.network].filter(Boolean).join(' · '),
        '',
        p.createdAtMs ? formatDate(p.createdAtMs) : '',
        dismiss(p.id)
      )
    )
  );

  const count = data.review.length + data.unmatched.length;
  ['#side-alert-count', '#tab-alert-count'].forEach((sel) => {
    const b = $(sel);
    if (!b) return;
    b.textContent = String(count);
    setHidden(b, count === 0);
  });
}

/* ---------- Connexion ---------- */

async function enter(user) {
  const id = ++state.routeId;
  setSplash(true);
  try {
    if (!user.emailVerified) {
      showDenied('Confirmez d’abord l’email de ce compte.');
      return;
    }
    // Pose le droit « admin » sur le compte (côté serveur) puis rafraîchit le jeton.
    await completeLogin().catch((err) => {
      if (err && (err.code === 'terms_required' || err.status === 400)) return null;
      throw err;
    });
    await api('/api/admin/ping', { retry: true });
    if (id !== state.routeId) return;
    showApp(user);
    go(state.view);
  } catch (err) {
    if (id !== state.routeId) return;
    if (err && (err.status === 401 || err.status === 403)) {
      showDenied('Ce compte n’a pas accès à l’administration.');
    } else if (err && (err.code === 'timeout' || err.code === 'network')) {
      showDenied('Le serveur ne répond pas (il peut être en train de démarrer). Réessayez dans quelques secondes.');
    } else {
      showDenied(errorMessage(err));
    }
  }
}

async function submitEmail(event) {
  event.preventDefault();
  const email = $('#adm-email').value.trim();
  const password = $('#adm-password').value;
  const button = $('#adm-submit');
  setError('');
  if (!EMAIL_RE.test(email)) return setError('Adresse email invalide.');
  if (!password) return setError('Entrez votre mot de passe.');
  setLoading(button, true);
  try {
    await signInEmail(email, password);
  } catch (err) {
    setError(errorMessage(err));
  } finally {
    setLoading(button, false);
  }
  return undefined;
}

async function submitGoogle() {
  const button = $('#adm-google');
  setError('');
  setLoading(button, true);
  try {
    await signInGoogle();
  } catch (err) {
    setError(errorMessage(err));
  } finally {
    setLoading(button, false);
  }
}

async function signOutAll() {
  state.routeId += 1;
  state.stats = null;
  state.usersLoaded = false;
  state.paymentsLoaded = false;
  state.alertsLoaded = false;
  await logout().catch(() => {});
  showLogin();
}

/* ---------- Démarrage ---------- */

function bind() {
  $('#adm-form').addEventListener('submit', submitEmail);
  $('#adm-google').addEventListener('click', submitGoogle);
  $('#adm-out').addEventListener('click', signOutAll);
  $('#adm-logout-side').addEventListener('click', signOutAll);
  $('#adm-retry').addEventListener('click', () => {
    if (auth.currentUser) enter(auth.currentUser);
    else showLogin();
  });

  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => go(b.dataset.nav)));
  $$('[data-refresh]').forEach((b) =>
    b.addEventListener('click', async () => {
      state.stats = null;
      state.usersLoaded = false;
      state.paymentsLoaded = false;
      state.alertsLoaded = false;
      await loadView(state.view, true);
      toast('Chiffres actualisés.');
    })
  );

  $$('#us-chips .chip').forEach((chip) =>
    chip.addEventListener('click', async () => {
      $$('#us-chips .chip').forEach((c) => c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'));
      state.usersStatus = chip.dataset.status || '';
      try {
        await loadUsers(true);
      } catch (err) {
        handleApiError(err);
      }
    })
  );
  $('#us-search').addEventListener('input', renderUsers);
  $('#us-more').addEventListener('click', () => loadUsers(false).catch(handleApiError));
  $('#pay-more').addEventListener('click', () => loadPayments(false).catch(handleApiError));
  $('#rv-month').addEventListener('change', renderCountries);
}

function start() {
  initUI();
  watchNetwork();
  bind();

  // Filet de sécurité : si Firebase ne répond pas, on n'affiche jamais un écran de chargement infini.
  const guard = setTimeout(() => {
    if (!auth.currentUser) showLogin();
  }, 8000);

  finishRedirect().catch(() => null);

  onUser((user) => {
    clearTimeout(guard);
    if (!user) {
      state.routeId += 1;
      showLogin();
      return;
    }
    enter(user);
  });
}

window.addEventListener('unhandledrejection', () => setSplash(false));

try {
  start();
} catch (_err) {
  setSplash(false);
  showLogin();
  setError('Impossible de démarrer l’administration. Rechargez la page.');
}
