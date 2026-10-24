import { auth, api, onUser, signInEmail, signInGoogle, finishRedirect, logout, errorMessage } from './firebase.js';
import {
  $,
  $$,
  h,
  clear,
  money,
  formatDate,
  toast,
  setLoading,
  openOverlay,
  closeOverlay,
  confirmDialog,
  copyText,
  countUp,
  debounce,
  initUI,
  watchNetwork
} from './ui.js';

const VIEWS = ['overview', 'users', 'revenue', 'alerts'];
const TITLES = { overview: 'Vue d’ensemble', users: 'Utilisateurs', revenue: 'Revenus', alerts: 'Alertes' };
const PANES = ['login', 'denied'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PLAN = { trial: 'Essai', starter: 'Starter', business: 'Business', pro: 'Pro' };
const COUNTRY = {
  BJ: { name: 'Bénin', flag: 'assets/flags/benin.png' },
  BF: { name: 'Burkina Faso', flag: 'assets/flags/burkina-faso.png' },
  CM: { name: 'Cameroun', flag: 'assets/flags/cameroun.png' },
  CI: { name: 'Côte d’Ivoire', flag: 'assets/flags/cote-ivoire.png' },
  ML: { name: 'Mali', flag: 'assets/flags/mali.png' },
  CD: { name: 'RD Congo', flag: 'assets/flags/rdc.png' },
  SN: { name: 'Sénégal', flag: 'assets/flags/senegal.png' },
  TG: { name: 'Togo', flag: 'assets/flags/togo.png' }
};
const USER_STATUS = {
  trial: { label: 'Essai', cls: 'badge badge-gold' },
  active: { label: 'Payant', cls: 'badge' },
  expired: { label: 'Expiré', cls: 'badge badge-danger' }
};
const PAY_STATUS = {
  SUCCESS: { label: 'Payé', cls: 'ok' },
  PENDING: { label: 'En attente', cls: '' },
  FAILED: { label: 'Échoué', cls: 'low' },
  CANCELLED: { label: 'Annulé', cls: 'low' },
  REVIEW: { label: 'À vérifier', cls: 'low' },
  DISMISSED: { label: 'Traité', cls: '' }
};
const PAY_TYPE = { new: 'Nouvel abonnement', renew: 'Renouvellement', upgrade: 'Passage à l’offre supérieure' };
const REASON = {
  amount_mismatch: 'Montant différent de celui demandé',
  currency_mismatch: 'Devise différente de celle demandée',
  no_matching_payment: 'Aucun compte lié à ce paiement',
  provider_rejected: 'Refusé par SasPay',
  provider_unreachable: 'SasPay injoignable'
};

let stats = null;
let alerts = null;
let alertsAt = 0;
let current = 'overview';
let routeId = 0;
let refreshing = false;
let lastRefresh = 0;
let firstPaint = true;
const users = { list: [], next: null, status: '', loaded: false, busy: false, term: '' };
const payments = { list: [], next: null, loaded: false, busy: false };

function setHidden(node, hidden) {
  if (node) node.classList.toggle('hide', Boolean(hidden));
}

function setError(node, message) {
  if (!node) return;
  node.textContent = message || '';
  setHidden(node, !message);
}

function num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString('fr-FR') : '0';
}

function dateTime(ms) {
  const d = new Date(Number(ms));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function monthName(id) {
  const parts = String(id).split('-').map(Number);
  if (!parts[0] || !parts[1]) return String(id);
  return new Date(Date.UTC(parts[0], parts[1] - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function fmtMap(map) {
  const parts = Object.keys(map || {})
    .filter((c) => Number(map[c]) !== 0)
    .map((c) => money(map[c], c));
  return parts.length ? parts.join(' + ') : '0';
}

function countryName(code) {
  return COUNTRY[code] ? COUNTRY[code].name : code || '—';
}

function initials(text) {
  const base = String(text || '?').split('@')[0];
  return base.slice(0, 2).toUpperCase() || '?';
}

function kv(label, value) {
  return h('div', { class: 'kv' }, h('small', { text: label }), h('b', { text: value }));
}

function kvCopy(label, value) {
  return h(
    'div',
    { class: 'kv' },
    h('small', { text: label }),
    h(
      'div',
      { class: 'row', style: 'flex-wrap:nowrap;justify-content:space-between;gap:.5rem' },
      h('b', { text: value, style: 'font-size:.8rem;word-break:break-all' }),
      h('button', { type: 'button', class: 'mini', text: 'Copier', onclick: () => copyText(value) })
    )
  );
}

function statCard(label, value, cls, note) {
  const strong = h('strong', { text: value });
  const card = h('div', { class: 'stat' + (cls ? ' ' + cls : '') }, h('small', { text: label }), strong);
  if (note) {
    card.append(h('em', { style: 'font-style:normal;font-size:.78rem;color:' + (cls === 'hero' ? 'var(--gold)' : 'var(--muted)'), text: note }));
  }
  card._value = strong;
  return card;
}

function emptyBlock(title, text) {
  return h('div', { class: 'empty' }, h('h3', { text: title }), h('p', { text }));
}

function setSplash(on, text) {
  const splash = $('#splash');
  if (!splash) return;
  splash.classList.toggle('done', !on);
  let line = $('#splash-text');
  if (!line) {
    line = h('p', { id: 'splash-text', class: 'muted', style: 'text-align:center;padding:0 1rem;font-size:.9rem' });
    splash.append(line);
  }
  line.textContent = on && text ? text : '';
}

function openPane(name) {
  PANES.forEach((p) => setHidden($('#pane-' + p), p !== name));
  setError($('#adm-error'), '');
  window.scrollTo(0, 0);
}

function showAuthScreen(pane) {
  setSplash(false);
  setHidden($('#app'), true);
  setHidden($('#auth'), false);
  document.body.classList.add('is-auth');
  openPane(pane);
}

function showAppScreen() {
  setHidden($('#auth'), true);
  setHidden($('#app'), false);
  document.body.classList.remove('is-auth');
  setSplash(false);
}

function deny(text) {
  $('#denied-text').textContent = text;
  showAuthScreen('denied');
}

function hashName() {
  return window.location.hash.slice(1);
}

function openSheet(content) {
  const body = $('#sheet-body');
  clear(body);
  body.append(...[].concat(content));
  openOverlay($('#sheet'));
}

function closeSheet() {
  closeOverlay($('#sheet'));
}

function liveStatus(u) {
  if (u.status === 'expired') return 'expired';
  if (Number(u.expiresAtMs) <= Date.now()) return 'expired';
  return u.status === 'trial' ? 'trial' : 'active';
}

function totalFor(status) {
  if (!stats) return null;
  const c = stats.counters;
  if (status === 'trial') return c.trial;
  if (status === 'expired') return c.expired;
  if (status === 'active') return payingCount();
  return c.total;
}

function payingCount() {
  const p = stats ? stats.mrr.activeByPlan : {};
  return (Number(p.starter) || 0) + (Number(p.business) || 0) + (Number(p.pro) || 0);
}

function renderOverview(animate) {
  if (!stats) return;
  const c = stats.counters;
  const mrr = stats.mrr;
  const month = stats.thisMonth;

  const grid = $('#ov-users');
  clear(grid);
  [
    ['Utilisateurs', c.total, ''],
    ['En essai gratuit', c.trial, 'gold'],
    ['Payants', payingCount(), ''],
    ['Expirés (inactifs)', c.expired, c.expired > 0 ? 'danger' : '']
  ].forEach(([label, value, cls]) => {
    const card = statCard(label, '0', cls);
    grid.append(card);
    if (animate) countUp(card._value, value, 800);
    else card._value.textContent = num(value);
  });

  let hint = $('#ov-hint');
  if (!hint) {
    hint = h('p', { id: 'ov-hint', class: 'muted', style: 'font-size:.8rem;margin-top:.6rem' });
    grid.after(hint);
  }
  hint.textContent = stats.countsAtMs
    ? 'Essais, expirés et total recalculés la nuit : dernier calcul le ' + dateTime(stats.countsAtMs) + '. Les payants sont comptés en direct.'
    : 'Les compteurs d’essais et d’expirés sont recalculés par la tâche quotidienne, qui n’a pas encore tourné. Les payants sont comptés en direct.';

  const money$ = $('#ov-mrr');
  clear(money$);
  money$.append(statCard('Revenu mensuel récurrent (MRR)', money(mrr.mrrUsd, 'USD'), 'hero', 'équivalent en dollars, selon vos taux de plans.js'));
  ['XOF', 'XAF', 'CDF'].forEach((cur) => {
    const value = Number(mrr.mrr[cur]) || 0;
    const subs = Number(mrr.activeByCurrency[cur]) || 0;
    if (value > 0 || subs > 0) money$.append(statCard('MRR · ' + cur, money(value, cur), '', subs + (subs > 1 ? ' abonnés' : ' abonné')));
  });
  money$.append(
    statCard('Votre net du mois', money(month.netUsd, 'USD'), 'gold', 'après frais SasPay'),
    statCard('Frais SasPay du mois', money(month.feeUsd, 'USD'))
  );

  $('#ov-month-title').textContent = 'Ce mois-ci · ' + monthName(month.month);
  const mBox = $('#ov-month');
  clear(mBox);
  mBox.append(
    kv('Paiements reçus', num(month.paidCount)),
    kv('Brut encaissé', fmtMap(month.gross)),
    kv('Frais SasPay', fmtMap(month.fee)),
    kv('Votre net', fmtMap(month.net)),
    kv('Net équivalent', money(month.netUsd, 'USD')),
    kv('Comptes supprimés', num(month.deletedCount))
  );

  const pBox = $('#ov-plans');
  clear(pBox);
  ['starter', 'business', 'pro'].forEach((id) => {
    const n = Number(mrr.activeByPlan[id]) || 0;
    pBox.append(kv(PLAN[id], n + (n > 1 ? ' abonnés' : ' abonné')));
  });
  pBox.append(kv('Essai gratuit', num(c.trial)));

  const dBox = $('#ov-deleted');
  clear(dBox);
  dBox.append(
    kv('Total supprimés', num(c.deleted)),
    kv('Essais jamais convertis', num(c.deletedTrial)),
    kv('Abonnés qui n’ont pas renouvelé', num(c.deletedPaid)),
    kv('Suppressions manuelles', num(c.deletedManual))
  );

  $('#adm-updated').textContent = 'Actualisé à ' + new Date(stats.generatedAtMs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function renderRevenue() {
  if (!stats) return;
  const newest = stats.months;
  const oldest = newest.slice().reverse();
  const max = Math.max(0, ...oldest.map((m) => Number(m.netUsd) || 0));

  const bars = $('#rv-bars');
  clear(bars);
  oldest.forEach((m) => {
    const pct = max > 0 ? Math.round(((Number(m.netUsd) || 0) / max) * 100) : 0;
    bars.append(
      h(
        'div',
        { class: 'bar-row' },
        h('span', { text: m.month.slice(2) }),
        h('div', { class: 'meter-bar' }, h('i', { style: 'width:' + pct + '%' })),
        h('b', { text: money(m.netUsd, 'USD') })
      )
    );
  });

  const body = $('#rv-table');
  clear(body);
  newest.forEach((m) => {
    body.append(
      h(
        'tr',
        {},
        h('td', { text: monthName(m.month) }),
        h('td', { text: num(m.paidCount) }),
        h('td', { text: fmtMap(m.gross) }),
        h('td', { text: fmtMap(m.fee) }),
        h('td', {}, h('div', { text: fmtMap(m.net) }), h('small', { class: 'muted', text: '≈ ' + money(m.netUsd, 'USD') }))
      )
    );
  });

  const select = $('#rv-month');
  const keep = select.value;
  clear(select);
  newest.forEach((m) => select.append(h('option', { value: m.month, text: monthName(m.month) })));
  if (keep && newest.some((m) => m.month === keep)) select.value = keep;
  renderCountries();
}

function renderCountries() {
  const body = $('#rv-country');
  clear(body);
  if (!stats) return;
  const month = stats.months.find((m) => m.month === $('#rv-month').value) || stats.months[0];
  const codes = Object.keys(month.byCountry || {}).filter((code) => month.byCountry[code] && typeof month.byCountry[code] === 'object');

  if (!codes.length) {
    body.append(h('tr', {}, h('td', { colspan: '4', class: 'muted', text: 'Aucun paiement ce mois-là.' })));
    return;
  }

  codes
    .map((code) => {
      let count = 0;
      const gross = {};
      const net = {};
      Object.keys(month.byCountry[code]).forEach((cur) => {
        const e = month.byCountry[code][cur] || {};
        count += Number(e.count) || 0;
        gross[cur] = Number(e.gross) || 0;
        net[cur] = Number(e.net) || 0;
      });
      return { code, count, gross, net };
    })
    .sort((a, b) => b.count - a.count)
    .forEach((row) => {
      const c = COUNTRY[row.code];
      body.append(
        h(
          'tr',
          {},
          h(
            'td',
            {},
            h(
              'div',
              { class: 'row', style: 'flex-wrap:nowrap;gap:.6rem' },
              c ? h('img', { class: 'flag flag-sm', src: c.flag, alt: '', width: '40', height: '23' }) : null,
              h('span', { text: countryName(row.code) })
            )
          ),
          h('td', { text: num(row.count) }),
          h('td', { text: fmtMap(row.gross) }),
          h('td', { text: fmtMap(row.net) })
        )
      );
    });
}

function renderUsers(loadingFirst) {
  const box = $('#us-list');
  clear(box);
  const more = $('#us-more');

  if (loadingFirst) {
    for (let i = 0; i < 4; i += 1) box.append(h('div', { class: 'skeleton', style: 'min-height:64px;margin:.5rem 1rem' }));
    setHidden(more, true);
    return;
  }

  const t = users.term.toLowerCase();
  const list = t ? users.list.filter((u) => String(u.email || '').toLowerCase().includes(t) || String(u.name || '').toLowerCase().includes(t)) : users.list;
  const total = totalFor(users.status);
  $('#us-count').textContent = list.length + (list.length > 1 ? ' affichés' : ' affiché') + (total !== null && !t ? ' sur ' + num(total) : '');

  if (!list.length) {
    box.append(emptyBlock('Aucun utilisateur', users.loaded ? 'Aucun compte ne correspond à ce filtre.' : 'Chargement impossible pour le moment.'));
  }

  list.forEach((u) => {
    const st = liveStatus(u);
    const meta = USER_STATUS[st];
    let note = '';
    if (st === 'expired') {
      note = u.daysUntilDelete !== null && u.daysUntilDelete !== undefined ? 'suppression dans ' + u.daysUntilDelete + ' j' : 'accès suspendu';
    } else {
      note = u.daysLeft + ' j restants';
    }
    box.append(
      h(
        'button',
        { type: 'button', class: 'item', onclick: () => openUser(u.uid) },
        h('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(u.email || u.name) }),
        h(
          'div',
          { class: 'item-main' },
          h('div', { class: 'item-title', text: u.email || u.uid }),
          h('div', { class: 'item-sub', text: (PLAN[u.planId] || u.planId) + ' · ' + countryName(u.country) + ' · inscrit le ' + formatDate(u.createdAtMs) })
        ),
        h('div', { class: 'item-end' }, h('span', { class: meta.cls, text: meta.label }), h('small', { text: note }))
      )
    );
  });

  setHidden(more, users.next === null || users.next === undefined);
}

async function loadUsers(reset) {
  if (users.busy) return;
  users.busy = true;
  const more = $('#us-more');
  if (reset) {
    users.list = [];
    users.next = null;
    renderUsers(true);
  } else setLoading(more, true);

  try {
    const q = ['limit=25'];
    if (users.status) q.push('status=' + encodeURIComponent(users.status));
    if (!reset && users.next !== null && users.next !== undefined) q.push('before=' + encodeURIComponent(users.next));
    const data = await api('/api/admin/users?' + q.join('&'), { retry: true });
    users.list = reset ? data.users : users.list.concat(data.users);
    users.next = data.nextBefore;
    users.loaded = true;
  } catch (err) {
    toast(errorMessage(err), 'error', 5000);
  } finally {
    users.busy = false;
    setLoading(more, false);
    renderUsers();
  }
}

function openUser(uid) {
  const u = users.list.find((x) => x.uid === uid);
  if (!u) return;
  const st = liveStatus(u);
  const meta = USER_STATUS[st];

  const body = [
    h('div', { class: 'row', style: 'flex-wrap:nowrap;gap:.75rem' }, h('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(u.email || u.name) }), h('h3', { text: u.email || 'Compte', style: 'word-break:break-all' })),
    h(
      'div',
      { class: 'panel', style: 'margin:1rem 0 0' },
      kv('Statut', meta.label),
      kv('Offre', PLAN[u.planId] || u.planId),
      u.name ? kv('Nom', u.name) : null,
      kv('Pays', countryName(u.country)),
      kv('Inscrit le', formatDate(u.createdAtMs)),
      kv(st === 'expired' ? 'Expiré le' : 'Expire le', formatDate(u.expiresAtMs)),
      u.deleteAtMs ? kv('Suppression automatique', formatDate(u.deleteAtMs)) : null,
      kvCopy('Identifiant (UID)', u.uid)
    )
  ];

  if (u.isAdmin) {
    body.push(
      h('div', { class: 'banner', style: 'margin-top:1rem', text: 'C’est votre compte administrateur : il ne peut pas être supprimé.' }),
      h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn btn-ghost', text: 'Fermer', onclick: closeSheet }))
    );
    openSheet(body);
    return;
  }

  const allow = h('input', { type: 'checkbox', id: 'del-trial' });
  body.push(
    h('label', { class: 'check' }, allow, h('span', { text: 'Autoriser cette personne à refaire un essai gratuit (utile pour vos comptes de test).' })),
    h(
      'div',
      { class: 'form-actions' },
      h('button', { type: 'button', class: 'btn btn-ghost', text: 'Fermer', onclick: closeSheet }),
      h('button', {
        type: 'button',
        class: 'btn btn-danger',
        text: 'Supprimer le compte',
        onclick: (event) => deleteUser(u, allow.checked, event.currentTarget)
      })
    )
  );
  openSheet(body);
}

async function deleteUser(u, allowNewTrial, button) {
  const ok = await confirmDialog({
    title: 'Supprimer ce compte ?',
    text: (u.email || u.uid) + ' : ses produits, ventes, clients, dettes et son compte de connexion seront supprimés définitivement. Cette action est irréversible.',
    ok: 'Supprimer définitivement',
    danger: true
  });
  if (!ok) return;

  setLoading(button, true);
  try {
    await api('/api/admin/users/' + encodeURIComponent(u.uid) + '/delete', {
      method: 'POST',
      body: { confirm: true, allowNewTrial: allowNewTrial === true }
    });
    users.list = users.list.filter((x) => x.uid !== u.uid);
    closeSheet();
    renderUsers();
    toast('Compte supprimé.');
    loadStats().catch(() => {});
  } catch (err) {
    toast(errorMessage(err), 'error', 5000);
  } finally {
    setLoading(button, false);
  }
}

function renderPayments(loadingFirst) {
  const box = $('#pay-list');
  clear(box);
  const more = $('#pay-more');

  if (loadingFirst) {
    for (let i = 0; i < 3; i += 1) box.append(h('div', { class: 'skeleton', style: 'min-height:64px;margin:.5rem 1rem' }));
    setHidden(more, true);
    return;
  }

  if (!payments.list.length) box.append(emptyBlock('Aucun paiement', payments.loaded ? 'Les paiements apparaîtront ici dès le premier abonnement.' : 'Chargement impossible pour le moment.'));

  payments.list.forEach((p) => {
    const st = PAY_STATUS[p.status] || { label: p.status, cls: '' };
    box.append(
      h(
        'button',
        { type: 'button', class: 'item', onclick: () => openPayment(p.id) },
        h(
          'div',
          { class: 'item-main' },
          h('div', { class: 'item-title', text: (PLAN[p.planId] || p.planId) + ' · ' + countryName(p.country) }),
          h('div', { class: 'item-sub', text: dateTime(p.createdAtMs) + (p.network ? ' · ' + p.network : '') })
        ),
        h('div', { class: 'item-end ' + st.cls }, money(p.amount, p.currency), h('small', { text: st.label }))
      )
    );
  });
  setHidden(more, payments.next === null || payments.next === undefined);
}

async function loadPayments(reset) {
  if (payments.busy) return;
  payments.busy = true;
  const more = $('#pay-more');
  if (reset) {
    payments.list = [];
    payments.next = null;
    renderPayments(true);
  } else setLoading(more, true);

  try {
    const q = ['limit=25'];
    if (!reset && payments.next !== null && payments.next !== undefined) q.push('before=' + encodeURIComponent(payments.next));
    const data = await api('/api/admin/payments?' + q.join('&'), { retry: true });
    payments.list = reset ? data.payments : payments.list.concat(data.payments);
    payments.next = data.nextBefore;
    payments.loaded = true;
  } catch (err) {
    toast(errorMessage(err), 'error', 5000);
  } finally {
    payments.busy = false;
    setLoading(more, false);
    renderPayments();
  }
}

function openPayment(id) {
  const p = payments.list.find((x) => x.id === id);
  if (!p) return;
  const st = PAY_STATUS[p.status] || { label: p.status };
  openSheet([
    h('h3', { text: 'Paiement · ' + money(p.amount, p.currency) }),
    h(
      'div',
      { class: 'panel', style: 'margin:1rem 0 0' },
      kv('Statut', st.label),
      kv('Type', PAY_TYPE[p.type] || p.type || '—'),
      kv('Offre', PLAN[p.planId] || p.planId),
      kv('Pays', countryName(p.country)),
      p.network ? kv('Réseau', p.network) : null,
      p.fee !== null && p.fee !== undefined ? kv('Frais SasPay', money(p.fee, p.currency)) : null,
      p.net !== null && p.net !== undefined ? kv('Net reçu', money(p.net, p.currency)) : null,
      kv('Créé le', dateTime(p.createdAtMs)),
      p.paidAtMs ? kv('Payé le', dateTime(p.paidAtMs)) : null,
      kvCopy('Référence du paiement', p.id),
      kvCopy('Utilisateur (UID)', p.uid)
    ),
    h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn btn-ghost', text: 'Fermer', onclick: closeSheet }))
  ]);
}

function setBadge(id, count) {
  const node = $('#' + id);
  if (!node) return;
  node.textContent = count > 9 ? '9+' : String(count);
  setHidden(node, count <= 0);
}

function renderAlerts() {
  const review = $('#al-review');
  const unmatched = $('#al-unmatched');
  clear(review);
  clear(unmatched);
  const r = alerts ? alerts.review : [];
  const u = alerts ? alerts.unmatched : [];

  if (!r.length) review.append(emptyBlock('Rien à vérifier', 'Tous les paiements reçus correspondent au montant demandé.'));
  r.forEach((p) => {
    review.append(
      h(
        'div',
        { class: 'item' },
        h(
          'div',
          { class: 'item-main' },
          h('div', { class: 'item-title', text: (PLAN[p.planId] || p.planId) + ' · ' + money(p.amount, p.currency) }),
          h('div', { class: 'item-sub', text: (REASON[p.reason] || 'À vérifier') + ' · ' + dateTime(p.createdAtMs) })
        ),
        h(
          'div',
          { class: 'row-actions' },
          h('button', { type: 'button', class: 'mini', text: 'Détails', onclick: () => openAlert(p) }),
          h('button', { type: 'button', class: 'mini', text: 'Traité', onclick: () => dismiss(p.id, 'review') })
        )
      )
    );
  });

  if (!u.length) unmatched.append(emptyBlock('Aucun paiement orphelin', 'Chaque paiement reçu est lié à un compte.'));
  u.forEach((p) => {
    unmatched.append(
      h(
        'div',
        { class: 'item' },
        h(
          'div',
          { class: 'item-main' },
          h('div', { class: 'item-title', text: (p.amount ? money(p.amount, p.currency) : 'Montant inconnu') + (p.country ? ' · ' + countryName(p.country) : '') }),
          h('div', { class: 'item-sub', text: (REASON[p.reason] || 'À vérifier') + (p.network ? ' · ' + p.network : '') + (p.createdAtMs ? ' · ' + dateTime(p.createdAtMs) : '') })
        ),
        h(
          'div',
          { class: 'row-actions' },
          h('button', { type: 'button', class: 'mini', text: 'Copier l’ID', onclick: () => copyText(p.id) }),
          h('button', { type: 'button', class: 'mini', text: 'Traité', onclick: () => dismiss(p.id, 'unmatched') })
        )
      )
    );
  });

  const total = r.length + u.length;
  setBadge('side-alert-count', total);
  setBadge('tab-alert-count', total);
}

function openAlert(p) {
  openSheet([
    h('h3', { text: 'Paiement à vérifier' }),
    h('p', { class: 'muted', style: 'margin:.25rem 0 1rem;font-size:.9rem', text: (REASON[p.reason] || 'À vérifier') + '. Comparez avec votre tableau de bord SasPay, puis contactez le client avec la référence ci-dessous.' }),
    h(
      'div',
      { class: 'panel', style: 'margin:0' },
      kv('Montant demandé', money(p.amount, p.currency)),
      kv('Offre', PLAN[p.planId] || p.planId),
      kv('Reçu le', dateTime(p.createdAtMs)),
      p.saspayTxId ? kvCopy('ID de transaction SasPay', p.saspayTxId) : null,
      kvCopy('Référence interne', p.id),
      kvCopy('Utilisateur (UID)', p.uid)
    ),
    h(
      'div',
      { class: 'form-actions' },
      h('button', { type: 'button', class: 'btn btn-ghost', text: 'Fermer', onclick: closeSheet }),
      h('button', { type: 'button', class: 'btn', text: 'Marquer comme traité', onclick: () => { closeSheet(); dismiss(p.id, 'review'); } })
    )
  ]);
}

async function dismiss(id, kind) {
  const ok = await confirmDialog({
    title: 'Marquer comme traité ?',
    text: 'L’alerte disparaîtra de cette liste. Assurez-vous d’avoir réglé le cas avec le client.',
    ok: 'Marquer comme traité'
  });
  if (!ok) return;
  try {
    await api('/api/admin/payments/' + encodeURIComponent(id) + '/dismiss', { method: 'POST', body: {} });
    if (alerts) {
      if (kind === 'review') alerts.review = alerts.review.filter((p) => p.id !== id);
      else alerts.unmatched = alerts.unmatched.filter((p) => p.id !== id);
    }
    renderAlerts();
    toast('Alerte traitée.');
  } catch (err) {
    toast(errorMessage(err), 'error', 5000);
  }
}

async function loadStats() {
  stats = await api('/api/admin/stats', { retry: true });
  renderOverview(false);
  renderRevenue();
  if (users.loaded) renderUsers();
  return stats;
}

async function loadAlerts() {
  alerts = await api('/api/admin/alerts', { retry: true });
  alertsAt = Date.now();
  renderAlerts();
  return alerts;
}

function updateNav(name) {
  const mark = (node, on) => (on ? node.setAttribute('aria-current', 'page') : node.removeAttribute('aria-current'));
  $$('.tabbar .tab').forEach((b) => mark(b, b.dataset.nav === name));
  $$('.side-nav button').forEach((b) => mark(b, b.dataset.nav === name));
  const title = $('#topbar-title');
  if (title) title.textContent = TITLES[name] || '';
}

function showView(name) {
  current = VIEWS.includes(name) ? name : 'overview';
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === current));
  updateNav(current);
  window.scrollTo(0, 0);

  if (current === 'users' && !users.loaded) loadUsers(true);
  if (current === 'revenue' && !payments.loaded) loadPayments(true);
  if (current === 'alerts' && Date.now() - alertsAt > 30000) loadAlerts().catch((err) => toast(errorMessage(err), 'error', 5000));
}

function navigate(name) {
  const target = VIEWS.includes(name) ? name : 'overview';
  if (target !== current && hashName() !== target) history.pushState(null, '', window.location.pathname + '#' + target);
  showView(target);
}

async function refresh() {
  if (refreshing) return;
  if (Date.now() - lastRefresh < 5000) {
    toast('Patientez quelques secondes avant d’actualiser à nouveau.', 'warn');
    return;
  }
  refreshing = true;
  lastRefresh = Date.now();
  const buttons = $$('[data-refresh]');
  buttons.forEach((b) => (b.disabled = true));
  try {
    await Promise.all([loadStats(), loadAlerts()]);
    if (current === 'users') await loadUsers(true);
    if (current === 'revenue') await loadPayments(true);
    toast('Chiffres actualisés.');
  } catch (err) {
    toast(errorMessage(err), 'error', 5000);
  } finally {
    refreshing = false;
    buttons.forEach((b) => (b.disabled = false));
  }
}

async function hardLogout() {
  try {
    await logout();
  } catch (_e) {
    /* déjà déconnecté */
  }
  window.location.replace('admin.html');
}

async function bootstrapAdmin() {
  try {
    await api('/api/auth/init', { method: 'POST', body: {} });
  } catch (_e) {
    /* ignoré : un compte non admin sera refusé juste après */
  }
  if (auth.currentUser) await auth.currentUser.getIdToken(true);
}

async function route(user) {
  const rid = ++routeId;
  if (!user) {
    showAuthScreen('login');
    return;
  }
  setSplash(true, '');
  if (!user.emailVerified) {
    deny('Confirmez d’abord l’adresse email de ce compte, puis reconnectez-vous.');
    return;
  }

  const slow = setTimeout(() => setSplash(true, 'Le serveur se réveille, quelques secondes…'), 6000);
  try {
    let data;
    try {
      data = await api('/api/admin/stats', { retry: true });
    } catch (err) {
      if (err && err.status === 403) {
        await bootstrapAdmin();
        data = await api('/api/admin/stats');
      } else throw err;
    }
    clearTimeout(slow);
    if (rid !== routeId) return;

    stats = data;
    $('#side-email').textContent = user.email || '';
    showAppScreen();
    const first = VIEWS.includes(hashName()) ? hashName() : 'overview';
    history.replaceState(null, '', window.location.pathname + '#' + first);
    renderOverview(firstPaint);
    firstPaint = false;
    renderRevenue();
    showView(first);
    if (first !== 'alerts') loadAlerts().catch(() => {});
  } catch (err) {
    clearTimeout(slow);
    if (rid !== routeId) return;
    if (err && err.status === 403) deny('Ce compte n’a pas accès à l’administration.');
    else if (err && err.status === 401) deny('Session expirée. Reconnectez-vous.');
    else deny(errorMessage(err));
  }
}

function wireAuth() {
  const error = $('#adm-error');
  const submit = $('#adm-submit');
  const google = $('#adm-google');

  $('#adm-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    setError(error, '');
    const email = $('#adm-email').value.trim();
    const password = $('#adm-password').value;
    if (!EMAIL_RE.test(email)) return setError(error, 'Adresse email invalide.');
    if (!password) return setError(error, 'Entrez votre mot de passe.');
    setLoading(submit, true);
    try {
      await signInEmail(email, password);
    } catch (err) {
      setError(error, errorMessage(err));
    } finally {
      setLoading(submit, false);
    }
  });

  google.addEventListener('click', async () => {
    setError(error, '');
    setLoading(google, true);
    try {
      await signInGoogle();
    } catch (err) {
      const code = err && err.code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') setError(error, errorMessage(err));
    } finally {
      setLoading(google, false);
    }
  });

  $('#adm-retry').addEventListener('click', () => route(auth.currentUser));
  $('#adm-out').addEventListener('click', hardLogout);
}

function wireApp() {
  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      event.preventDefault();
      navigate(nav.dataset.nav);
      return;
    }
    const refreshButton = event.target.closest('[data-refresh]');
    if (refreshButton) {
      event.preventDefault();
      refresh();
    }
  });

  const logoutNow = async () => {
    const ok = await confirmDialog({ title: 'Se déconnecter ?', text: 'Vous quitterez l’espace administrateur.', ok: 'Se déconnecter' });
    if (ok) hardLogout();
  };
  $('#adm-logout-side').addEventListener('click', logoutNow);

  const topbar = $('.topbar');
  if (topbar) topbar.append(h('button', { type: 'button', class: 'plan-pill hide-desktop', id: 'adm-logout-top', text: 'Quitter', onclick: logoutNow }));

  window.addEventListener('popstate', () => {
    if (!$('#app').classList.contains('hide')) showView(hashName());
  });

  $('#us-search').addEventListener(
    'input',
    debounce((event) => {
      users.term = event.target.value.trim();
      renderUsers();
    }, 200)
  );

  $('#us-chips').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-status]');
    if (!chip) return;
    users.status = chip.dataset.status;
    $$('#us-chips .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    loadUsers(true);
  });

  $('#us-more').addEventListener('click', () => loadUsers(false));
  $('#pay-more').addEventListener('click', () => loadPayments(false));
  $('#rv-month').addEventListener('change', renderCountries);
}

function boot() {
  initUI();
  watchNetwork();
  wireAuth();
  wireApp();
  finishRedirect();
  onUser((user) => {
    route(user);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
