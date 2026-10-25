import { $, h, clear, money, formatDate, toast, setLoading } from '../ui.js';
import { fxMoney, renderFxBar, onFxChange, symbol } from '../fx.js';

const DAY_MS = 86400000;
const CONTACT = 'optisitedigital@gmail.com';
const DEBT_PREFIX = 'Dette payée - ';
const TZ_CURRENCY = { 'Africa/Kinshasa': 'CDF', 'Africa/Lubumbashi': 'CDF', 'Africa/Douala': 'XAF' };
const CURRENCIES = [
  ['XOF', 'FCFA (Afrique de l’Ouest)'],
  ['XAF', 'FCFA (Afrique centrale)'],
  ['CDF', 'Franc congolais (FC)']
];
const ARROW =
  "background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='9' viewBox='0 0 14 9'%3E%3Cpath d='M0 0h14L7 9z' fill='%230F172A'/%3E%3C/svg%3E\");background-repeat:no-repeat;background-position:right .9rem center;padding-right:2.6rem";

let ctx = null;
let current = 'more';
let token = 0;
let wired = false;
let historyDone = true;

function currency() {
  const profile = ctx.store.getProfile();
  if (profile.currency) return profile.currency;
  const sub = ctx.subscription();
  if (sub && sub.currency) return sub.currency;
  try {
    return TZ_CURRENCY[Intl.DateTimeFormat().resolvedOptions().timeZone] || 'XOF';
  } catch (_e) {
    return 'XOF';
  }
}

function qtyText(n) {
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function dayStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayLabel(ms) {
  const date = new Date(ms);
  const diff = Math.round((dayStart(new Date()) - dayStart(date)) / DAY_MS);
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 1) return 'Hier';
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function timeLabel(ms) {
  return new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function kv(label, value) {
  return h('div', { class: 'kv' }, h('small', { text: label }), h('b', { text: value }));
}

function field(label, id, attrs, value, hint) {
  const input = h('input', Object.assign({ id, type: 'text', autocomplete: 'off' }, attrs || {}));
  if (value !== undefined && value !== null && value !== '') input.value = String(value);
  return h('label', { class: 'field' }, h('span', { text: label }), input, hint ? h('small', { class: 'hint', text: hint }) : null);
}

function statCard(label, value, cls) {
  return h('div', { class: 'stat' + (cls ? ' ' + cls : '') }, h('small', { text: label }), h('strong', { text: value }));
}

function meter(label, used, max) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const cls = pct >= 100 ? ' full' : pct >= 80 ? ' near' : '';
  return h(
    'div',
    { class: 'meter' + cls },
    h('div', { class: 'meter-top' }, h('span', { text: label }), h('b', { text: used.toLocaleString('fr-FR') + ' / ' + max.toLocaleString('fr-FR') })),
    h('div', { class: 'meter-bar' }, h('i', { style: 'width:' + pct + '%' }))
  );
}

function statusText(status) {
  if (status === 'credit') return 'À crédit';
  if (status === 'cancelled') return 'Annulée';
  return 'Payée';
}

function receiptText(sale) {
  const cur = currency();
  const profile = ctx.store.getProfile();
  const lines = ['*' + (profile.businessName || 'Kontra Africa') + '*', 'Reçu n° ' + sale.invoiceNo, new Date(sale.createdAtMs).toLocaleString('fr-FR'), ''];
  sale.items.forEach((i) => {
    lines.push(qtyText(Number(i.qty) || 0) + ' × ' + String(i.name || '') + ' : ' + money((Number(i.price) || 0) * (Number(i.qty) || 0), cur));
  });
  lines.push('', 'Total : ' + money(sale.total, cur));
  if (sale.status === 'credit') {
    lines.push('Payé : ' + money(sale.paid, cur), 'Reste à payer : ' + money(sale.total - sale.paid, cur));
  }
  lines.push('', 'Merci de votre confiance.');
  return lines.join('\n');
}

function renderHistory() {
  const box = $('#history-list');
  const more = $('#history-more');
  clear(box);
  const sales = ctx.store.getSales();
  const cur = currency();

  if (!sales.length) {
    more.classList.add('hide');
    box.append(
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'icon-box gold', text: 'V' }),
        h('h3', { text: 'Aucune vente pour le moment' }),
        h('p', { text: 'Vos ventes apparaîtront ici dès la première vente enregistrée.' }),
        ctx.canWrite() ? h('button', { type: 'button', class: 'btn', 'data-nav': 'sale', text: 'Faire une vente' }) : null
      )
    );
    return;
  }

  let last = '';
  sales.forEach((sale) => {
    const label = dayLabel(sale.createdAtMs);
    if (label !== last) {
      last = label;
      box.append(h('div', { style: 'padding:.5rem 1rem;background:var(--bg-soft);font-size:.78rem;font-weight:600;color:var(--muted);text-transform:capitalize', text: label }));
    }
    const count = sale.items.reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
    const tag = sale.status === 'paid' ? '' : statusText(sale.status);
    box.append(
      h(
        'button',
        { type: 'button', class: 'item', onclick: () => openSale(sale.id) },
        h(
          'div',
          { class: 'item-main' },
          h('div', { class: 'item-title', text: sale.customerName || 'Vente comptant' }),
          h('div', { class: 'item-sub', text: timeLabel(sale.createdAtMs) + ' · ' + qtyText(count) + (count > 1 ? ' articles' : ' article') })
        ),
        h('div', { class: 'item-end' + (sale.status === 'cancelled' ? ' low' : '') }, money(sale.total, cur), tag ? h('small', { text: tag }) : null)
      )
    );
  });
  more.classList.toggle('hide', historyDone);
}

function openSale(saleId) {
  const sale = ctx.store.getSales().find((s) => s.id === saleId);
  if (!sale) return;
  const cur = currency();

  const rows = sale.items.map((i) => {
    const qty = Number(i.qty) || 0;
    const price = Number(i.price) || 0;
    return h(
      'div',
      { class: 'item', style: 'min-height:56px' },
      h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: String(i.name || '') }), h('div', { class: 'item-sub', text: qtyText(qty) + ' × ' + money(price, cur) })),
      h('div', { class: 'item-end', text: money(price * qty, cur) })
    );
  });

  const body = [
    h('h3', { text: 'Reçu n° ' + sale.invoiceNo }),
    h('p', { class: 'muted', style: 'margin:.25rem 0 1rem;font-size:.9rem', text: dayLabel(sale.createdAtMs) + ' à ' + timeLabel(sale.createdAtMs) }),
    h('div', { class: 'panel', style: 'margin:0' }, ...rows),
    h(
      'div',
      { class: 'panel', style: 'margin:1rem 0 0' },
      kv('Total', money(sale.total, cur)),
      kv('Bénéfice de la vente', money(sale.profit, cur)),
      kv('Statut', statusText(sale.status)),
      sale.customerName ? kv('Client', sale.customerName) : null,
      sale.status === 'credit' ? kv('Déjà payé', money(sale.paid, cur)) : null,
      sale.status === 'credit' ? kv('Reste à payer', money(Math.max(0, sale.total - sale.paid), cur)) : null
    ),
    h(
      'div',
      { class: 'stack', style: '--gap:.6rem;margin-top:1.25rem' },
      h('a', {
        class: 'btn btn-gold btn-block',
        href: 'https://wa.me/?text=' + encodeURIComponent(receiptText(sale)),
        target: '_blank',
        rel: 'noopener',
        text: 'Envoyer le reçu par WhatsApp'
      }),
      h('button', { type: 'button', class: 'btn btn-ghost btn-block', text: 'Fermer', onclick: () => ctx.closeSheet() })
    )
  ];
  ctx.openSheet(body);
}

function renderFinance() {
  const s = ctx.store;
  const cur = currency();
  const f = (v) => fxMoney(v, cur, s.getProfile());
  renderFxBar($('#finance-fx'), ctx, cur);
  const stats = s.getStats();
  const m = stats ? stats.month : { revenue: 0, profit: 0, expenses: 0, income: 0 };
  const net = Math.round((m.profit - m.expenses) * 100) / 100;

  const hero = statCard('Résultat du mois', f(net), 'hero');
  hero.append(h('em', { style: 'font-style:normal;font-size:.82rem;color:var(--gold)', text: 'Bénéfice des ventes moins les dépenses' }));
  const box = $('#finance-stats');
  clear(box);
  box.append(
    hero,
    statCard('Ventes du mois', f(m.revenue), 'gold'),
    statCard('Bénéfice des ventes', f(m.profit)),
    statCard('Dépenses du mois', f(m.expenses), m.expenses > 0 ? 'warn' : ''),
    statCard('Entrées d’argent', f(m.income))
  );

  let goalPanel = $('#finance-goal');
  if (!goalPanel) {
    goalPanel = h('div', { id: 'finance-goal', class: 'panel' });
    box.after(goalPanel);
  }
  clear(goalPanel);
  const goal = Number(s.getProfile().savingsGoal) || 0;
  goalPanel.classList.toggle('hide', goal <= 0);
  if (goal > 0) {
    const done = Math.max(0, net);
    const pct = Math.min(100, Math.round((done / goal) * 100));
    goalPanel.append(
      h(
        'div',
        { class: 'meter' },
        h('div', { class: 'meter-top' }, h('span', { text: 'Objectif d’épargne' }), h('b', { text: f(done) + ' / ' + f(goal) })),
        h('div', { class: 'meter-bar' }, h('i', { style: 'width:' + pct + '%' }))
      )
    );
  }

  const list = $('#finance-list');
  clear(list);
  const txs = s.getTransactions();
  if (!txs.length) {
    list.append(
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'icon-box gold', text: 'F' }),
        h('h3', { text: 'Aucune opération' }),
        h('p', { text: 'Notez vos dépenses (loyer, transport, achats) et vos entrées d’argent pour connaître votre vrai résultat.' }),
        ctx.canWrite() ? h('button', { type: 'button', class: 'btn', 'data-action': 'add-tx', text: 'Ajouter une opération' }) : null
      )
    );
    return;
  }
  txs.forEach((tx) => {
    list.append(
      h(
        'button',
        { type: 'button', class: 'item', onclick: () => openTx(tx.id) },
        h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: tx.label }), h('div', { class: 'item-sub', text: dayLabel(tx.createdAtMs) + ' · ' + timeLabel(tx.createdAtMs) })),
        h('div', { class: 'item-end ' + (tx.type === 'in' ? 'ok' : 'low'), text: (tx.type === 'in' ? '+ ' : '− ') + money(tx.amount, cur) })
      )
    );
  });
}

function openTx(txId) {
  const tx = ctx.store.getTransactions().find((t) => t.id === txId);
  if (!tx) return;
  const cur = currency();
  const fromDebt = tx.label.startsWith(DEBT_PREFIX);

  const body = [
    h('h3', { text: tx.label }),
    h(
      'div',
      { class: 'panel', style: 'margin:1rem 0 0' },
      kv('Type', tx.type === 'in' ? 'Entrée d’argent' : 'Dépense'),
      kv('Montant', money(tx.amount, cur)),
      kv('Date', dayLabel(tx.createdAtMs) + ' à ' + timeLabel(tx.createdAtMs))
    )
  ];

  if (fromDebt) {
    body.push(h('p', { class: 'muted', style: 'margin-top:1rem;font-size:.88rem', text: 'Cette entrée vient d’un encaissement de dette. Elle ne peut pas être supprimée.' }));
  } else if (ctx.canWrite()) {
    body.push(
      h(
        'div',
        { class: 'form-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost', text: 'Fermer', onclick: () => ctx.closeSheet() }),
        h('button', {
          type: 'button',
          class: 'btn btn-danger',
          text: 'Supprimer',
          onclick: async () => {
            const ok = await ctx.confirm({ title: 'Supprimer cette opération ?', text: 'Les chiffres du mois seront corrigés.', ok: 'Supprimer', danger: true });
            if (!ok) return;
            try {
              await ctx.store.removeTransaction(tx.id);
              ctx.closeSheet();
              toast('Opération supprimée.');
            } catch (err) {
              toast(ctx.store.storeError(err), 'error', 5000);
            }
          }
        })
      )
    );
  }
  ctx.openSheet(body);
}

function openTxForm() {
  let type = 'out';
  const seg = h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'Type d’opération' },
    h('button', { type: 'button', 'data-type': 'out', 'aria-pressed': 'true', text: 'Dépense' }),
    h('button', { type: 'button', 'data-type': 'in', 'aria-pressed': 'false', text: 'Entrée d’argent' })
  );
  seg.addEventListener('click', (event) => {
    const button = event.target.closest('[data-type]');
    if (!button) return;
    type = button.dataset.type;
    Array.from(seg.children).forEach((c) => c.setAttribute('aria-pressed', String(c === button)));
  });

  const form = h(
    'form',
    { novalidate: true },
    h('div', { class: 'field' }, h('span', { text: 'Type' }), seg),
    field('Montant', 'tx-a', { inputmode: 'decimal' }),
    field('Libellé', 'tx-l', { maxlength: 100, placeholder: 'Ex. loyer, transport, achat de sacs' }),
    h('p', { class: 'error hide', id: 'tx-error', role: 'alert' }),
    h(
      'div',
      { class: 'form-actions' },
      h('button', { type: 'button', class: 'btn btn-ghost', text: 'Annuler', onclick: () => ctx.closeSheet() }),
      h('button', { type: 'submit', class: 'btn', id: 'tx-save', text: 'Enregistrer' })
    )
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#tx-save');
    const error = $('#tx-error');
    error.classList.add('hide');
    setLoading(button, true);
    try {
      await ctx.store.addTransaction({ type, amount: $('#tx-a').value, label: $('#tx-l').value });
      ctx.closeSheet();
      toast('Opération enregistrée.');
    } catch (err) {
      error.textContent = ctx.store.storeError(err);
      error.classList.remove('hide');
    } finally {
      setLoading(button, false);
    }
  });

  ctx.openSheet([h('h3', { text: 'Nouvelle opération' }), h('div', { style: 'height:1rem' }), form]);
  setTimeout(() => $('#tx-a') && $('#tx-a').focus({ preventScroll: true }), 80);
}

function renderAccount() {
  const box = $('#account-info');
  clear(box);
  const sub = ctx.subscription();
  if (!sub) return;
  const now = Date.now();
  const expiresAt = Number(sub.expiresAtMs);
  const lapsed = sub.status === 'expired' || expiresAt <= now;
  const left = Math.max(0, Math.ceil((expiresAt - now) / DAY_MS));
  const user = ctx.user();

  const status = lapsed ? 'Accès suspendu' : sub.status === 'trial' ? 'Essai gratuit' : 'Actif';
  const dateLabel = lapsed ? 'Expirée le' : sub.status === 'trial' ? 'Fin de l’essai' : 'Valable jusqu’au';
  const dateValue = formatDate(expiresAt) + (lapsed ? '' : ' · ' + left + (left > 1 ? ' jours restants' : ' jour restant'));

  box.append(kv('Offre', sub.planName || '—'), kv('Statut', status), kv(dateLabel, dateValue));
  if (lapsed && sub.deleteAtMs) {
    box.append(kv('Suppression du compte', formatDate(sub.deleteAtMs) + ' sans abonnement'));
  }
  if (user && user.email) box.append(kv('Email du compte', user.email));

  const u = ctx.store.usage();
  [
    ['Produits', u.products],
    ['Clients à crédit', u.customers],
    ['Ventes ce mois-ci', u.sales],
    ['Relances ce mois-ci', u.reminders]
  ].forEach(([label, v]) => {
    if (v.max > 0) box.append(meter(label, v.used, v.max));
  });

  box.append(
    h('div', { class: 'kv' }, h('small', { text: 'Besoin d’aide ?' }), h('a', { class: 'accent', href: 'mailto:' + CONTACT, style: 'font-weight:600;word-break:break-all', text: CONTACT }))
  );
}

function fillProfile() {
  const p = ctx.store.getProfile();
  const set = (id, value) => {
    const node = $('#' + id);
    if (node) node.value = value === undefined || value === null ? '' : String(value);
  };
  set('pf-name', p.businessName);
  set('pf-phone', p.phone);
  set('pf-address', p.address);
  set('pf-goal', p.savingsGoal);
  set('pf-rate', p.rate);
  syncRateLabel();
  const select = $('#pf-cur');
  if (select) select.value = CURRENCIES.some(([code]) => code === p.currency) ? p.currency : currency();
}

function syncRateLabel() {
  const select = $('#pf-cur');
  const label = $('#pf-rate-cur');
  if (label) label.textContent = symbol(select ? select.value : currency());
}

function injectCurrency() {
  if ($('#pf-cur')) return;
  const goal = $('#pf-goal');
  const anchor = goal ? goal.closest('label') : null;
  if (!anchor) return;
  const select = h('select', { id: 'pf-cur', style: ARROW }, ...CURRENCIES.map(([code, label]) => h('option', { value: code, text: label })));
  anchor.before(h('label', { class: 'field' }, h('span', { text: 'Monnaie utilisée' }), select));
}

function profileError(err) {
  if (err && err.code === 'invalid_savingsGoal') return 'Objectif d’épargne invalide.';
  return ctx.store.storeError(err);
}

function renderCurrent() {
  if (current === 'history') renderHistory();
  else if (current === 'finance') renderFinance();
  else if (current === 'account') renderAccount();
}

function wire() {
  if (wired) return;
  wired = true;
  injectCurrency();
  const curSelect = $('#pf-cur');
  if (curSelect) curSelect.addEventListener('change', syncRateLabel);

  const more = $('#history-more');
  more.addEventListener('click', async () => {
    setLoading(more, true);
    try {
      const result = await ctx.store.loadSales(true);
      historyDone = result.done;
    } catch (err) {
      toast(ctx.store.storeError(err), 'error', 5000);
    } finally {
      setLoading(more, false);
      renderHistory();
    }
  });

  $('#profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#btn-profile');
    setLoading(button, true);
    try {
      await ctx.store.saveProfile({
        businessName: $('#pf-name').value,
        phone: $('#pf-phone').value,
        address: $('#pf-address').value,
        savingsGoal: $('#pf-goal').value,
        rate: $('#pf-rate').value.replace(',', '.'),
        currency: $('#pf-cur').value
      });
      toast('Boutique enregistrée.');
    } catch (err) {
      toast(profileError(err), 'error', 5000);
    } finally {
      setLoading(button, false);
    }
  });
}

export function init(context) {
  ctx = context;
  wire();
  onFxChange(() => {
    if (current === 'finance') renderFinance();
  });
  ctx.store.subscribe(() => {
    const view = $('#view-' + current);
    if (view && view.classList.contains('active')) renderCurrent();
  });
}

export async function show(name, context) {
  ctx = context || ctx;
  current = name;
  const mine = ++token;
  const s = ctx.store;

  try {
    if (name === 'history') {
      renderHistory();
      const result = await s.loadSales(false);
      historyDone = result.done;
    } else if (name === 'finance') {
      renderFinance();
      await Promise.all([s.loadStats(), s.loadTransactions(), s.loadProfile()]);
    } else if (name === 'account') {
      renderAccount();
      await Promise.all([s.loadProfile(), s.loadStats(), s.loadProducts(), s.loadCustomers()]);
    } else {
      return;
    }
  } catch (err) {
    if (mine === token) toast(s.storeError(err), 'error', 5000);
    return;
  }
  if (mine !== token) return;

  renderCurrent();
  if (name === 'account') fillProfile();
}

export async function action(name, context) {
  ctx = context || ctx;
  if (name !== 'add-tx') return;
  try {
    await ctx.store.loadStats();
  } catch (err) {
    toast(ctx.store.storeError(err), 'error');
    return;
  }
  openTxForm();
}
