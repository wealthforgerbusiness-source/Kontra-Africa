import { $, h, clear, money, countUp, toast } from '../ui.js';
import { fxMoney, renderFxBar, onFxChange } from '../fx.js';

const TZ_CURRENCY = {
  'Africa/Kinshasa': 'CDF',
  'Africa/Lubumbashi': 'CDF',
  'Africa/Douala': 'XAF'
};

let ctx = null;
let active = false;
let token = 0;
let offStore = null;

function currency() {
  const profile = ctx.store.getProfile();
  if (profile.currency) return profile.currency;
  const sub = ctx.subscription();
  if (sub && sub.currency) return sub.currency;
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return TZ_CURRENCY[zone] || 'XOF';
  } catch (_e) {
    return 'XOF';
  }
}

function firstName() {
  const profile = ctx.store.getProfile();
  if (profile.businessName) return profile.businessName;
  const user = ctx.user();
  const name = user && user.displayName ? user.displayName.trim() : '';
  return name ? name.split(/\s+/)[0] : '';
}

function saleTime(ms) {
  const date = new Date(ms);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return 'Aujourd’hui · ' + time;
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ' · ' + time;
}

function stat(label, value, cls, key) {
  return h(
    'div',
    { class: 'stat' + (cls ? ' ' + cls : '') },
    h('small', { text: label }),
    h('strong', { 'data-key': key || '', text: value })
  );
}

function skeletons() {
  const box = $('#home-stats');
  clear(box);
  box.append(
    h('div', { class: 'stat hero skeleton', style: 'min-height:96px' }),
    h('div', { class: 'stat skeleton', style: 'min-height:78px' }),
    h('div', { class: 'stat skeleton', style: 'min-height:78px' }),
    h('div', { class: 'stat skeleton', style: 'min-height:78px' }),
    h('div', { class: 'stat skeleton', style: 'min-height:78px' })
  );
}

function renderGreeting() {
  const name = firstName();
  $('#home-greet').textContent = name ? 'Bonjour, ' + name : 'Bonjour';
  $('#home-eyebrow').textContent = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
}

function renderStats(animate) {
  const s = ctx.store;
  const cur = currency();
  const f = (v) => fxMoney(v, cur, s.getProfile());
  renderFxBar($('#home-fx'), ctx, cur);
  const stats = s.getStats();
  const day = stats ? stats.day : { revenue: 0, profit: 0, salesCount: 0 };
  const month = stats ? stats.month : { revenue: 0, profit: 0, salesCount: 0 };

  const values = {
    dayRevenue: day.revenue,
    dayProfit: day.profit,
    monthRevenue: month.revenue,
    monthProfit: month.profit,
    debt: s.totalDebt()
  };

  const hero = stat('Ventes aujourd’hui', f(values.dayRevenue), 'hero', 'dayRevenue');
  hero.append(h('em', { style: 'font-style:normal;font-size:.82rem;color:var(--gold)', text: day.salesCount + (day.salesCount > 1 ? ' ventes' : ' vente') + ' · bénéfice ' + f(values.dayProfit) }));

  const box = $('#home-stats');
  clear(box);
  box.append(
    hero,
    stat('Ventes du mois', f(values.monthRevenue), 'gold', 'monthRevenue'),
    stat('Bénéfice du mois', f(values.monthProfit), '', 'monthProfit'),
    stat('Dettes à encaisser', f(values.debt), values.debt > 0 ? 'danger' : '', 'debt'),
    stat('Stock bas', String(s.lowStock().length), s.lowStock().length ? 'warn' : '', 'low')
  );

  if (animate) {
    Object.keys(values).forEach((key) => {
      const node = $('[data-key="' + key + '"]', box);
      if (node) countUp(node, values[key], 800, (v) => f(v));
    });
  }
}

function emptyBlock(title, text, action, label) {
  return h(
    'div',
    { class: 'empty' },
    h('h3', { text: title }),
    h('p', { text }),
    action ? h('button', { type: 'button', class: 'btn btn-sm', 'data-action': action, text: label }) : null
  );
}

function renderLow() {
  const s = ctx.store;
  const box = $('#home-low');
  clear(box);
  const products = s.getProducts();

  if (!products.length) {
    box.append(emptyBlock('Aucun produit', 'Ajoutez votre premier produit pour suivre votre stock.', 'add-product', 'Ajouter un produit'));
    return;
  }
  const low = s.lowStock().slice(0, 5);
  if (!low.length) {
    box.append(h('div', { class: 'empty' }, h('p', { text: 'Tout est en ordre : aucun produit en stock bas.' })));
    return;
  }
  low.forEach((p) => {
    box.append(
      h(
        'button',
        { type: 'button', class: 'item', onclick: () => ctx.navigate('stock') },
        h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: p.name }), h('div', { class: 'item-sub', text: 'Alerte à ' + p.alertAt })),
        h('div', { class: 'item-end low', text: p.qty <= 0 ? 'Épuisé' : p.qty + ' en stock' })
      )
    );
  });
}

function renderRecent() {
  const s = ctx.store;
  const cur = currency();
  const box = $('#home-recent');
  clear(box);
  const sales = s.getSales().slice(0, 5);

  if (!sales.length) {
    box.append(emptyBlock('Aucune vente', 'Votre première vente apparaîtra ici.', null, ''));
    return;
  }
  sales.forEach((sale) => {
    const count = sale.items.reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
    const who = sale.customerName || 'Vente comptant';
    let tag = '';
    if (sale.status === 'credit') tag = 'À crédit';
    else if (sale.status === 'cancelled') tag = 'Annulée';
    box.append(
      h(
        'button',
        { type: 'button', class: 'item', onclick: () => ctx.navigate('history') },
        h('div', { class: 'item-main' }, h('div', { class: 'item-title', text: who }), h('div', { class: 'item-sub', text: saleTime(sale.createdAtMs) + ' · ' + count + ' article' + (count > 1 ? 's' : '') })),
        h('div', { class: 'item-end' }, money(sale.total, cur), tag ? h('small', { text: tag }) : null)
      )
    );
  });
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

function renderUsage() {
  const box = $('#home-usage');
  clear(box);
  const sub = ctx.subscription();
  const u = ctx.store.usage();
  if (!sub) return;

  const rows = [
    ['Produits', u.products],
    ['Clients à crédit', u.customers],
    ['Ventes ce mois-ci', u.sales],
    ['Relances ce mois-ci', u.reminders]
  ].filter((r) => r[1].max > 0);

  let pressed = false;
  rows.forEach(([label, v]) => {
    if (v.max > 0 && v.used / v.max >= 0.8) pressed = true;
    box.append(meter(label, v.used, v.max));
  });

  if (pressed) {
    box.append(
      h(
        'div',
        { style: 'padding:.75rem 1rem' },
        h('button', { type: 'button', class: 'btn btn-gold btn-sm btn-block', 'data-action': 'open-paywall', text: 'Augmenter mes limites' })
      )
    );
  }
}

function renderAll(animate) {
  renderGreeting();
  renderStats(animate);
  renderLow();
  renderRecent();
  renderUsage();
}

export function init(context) {
  ctx = context;
  offStore = ctx.store.subscribe(() => {
    if (active) renderAll(false);
  });
  onFxChange(() => {
    if (active) renderStats(false);
  });
}

export async function show(_name, context) {
  ctx = context || ctx;
  active = true;
  const mine = ++token;
  const s = ctx.store;

  const hasData = s.getStats() !== null;
  if (hasData) renderAll(false);
  else {
    renderGreeting();
    skeletons();
  }

  const results = await Promise.allSettled([
    s.loadProfile(),
    s.loadStats(),
    s.loadProducts(),
    s.loadCustomers(),
    s.loadSales(false)
  ]);
  if (mine !== token) return;

  renderAll(!hasData);

  const failed = results.find((r) => r.status === 'rejected');
  if (failed) toast(s.storeError(failed.reason), 'error', 5000);
}

export function hide() {
  active = false;
}

export function dispose() {
  if (offStore) offStore();
  offStore = null;
}
