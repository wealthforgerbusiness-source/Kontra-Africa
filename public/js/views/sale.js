import { $, $$, h, clear, money, toast, setLoading, debounce } from '../ui.js';
import { rateOf, symbol, openRateSheet } from '../fx.js';

const SHOW_MAX = 120;
const TZ_CURRENCY = { 'Africa/Kinshasa': 'CDF', 'Africa/Lubumbashi': 'CDF', 'Africa/Douala': 'XAF' };

let ctx = null;
let active = false;
let token = 0;
let wired = false;
let term = '';
let mode = 'paid';
let customerId = '';
let creditSignature = '';
let busy = false;
let givenCur = 'local';
let backCur = 'local';
const cart = new Map();

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

function norm(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function qtyText(n) {
  return Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function isLimit(err) {
  return Boolean(err) && typeof err.code === 'string' && err.code.startsWith('limit_');
}

function cleanCart() {
  cart.forEach((qty, id) => {
    const p = ctx.store.findProduct(id);
    if (!p || p.qty <= 0) cart.delete(id);
    else if (qty > p.qty) cart.set(id, Math.max(1, Math.floor(p.qty)) > p.qty ? p.qty : Math.floor(p.qty) || p.qty);
  });
}

function cartTotal() {
  let total = 0;
  cart.forEach((qty, id) => {
    const p = ctx.store.findProduct(id);
    if (p) total += p.sellPrice * qty;
  });
  return Math.round(total * 100) / 100;
}

/* ---------- Monnaie à rendre ---------- */

function round2(n) {
  return Math.round(n * 100) / 100;
}

function showIn(localAmount, which, rate, cur) {
  if (which === 'usd' && rate > 0) return money(round2(localAmount / rate), 'USD');
  return money(round2(localAmount), cur);
}

function cashInfo() {
  const input = $('#cash-given');
  const raw = input ? input.value.trim() : '';
  if (mode !== 'paid' || raw === '') return { typed: false };
  const rate = rateOf(ctx.store.getProfile());
  const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return { typed: true, invalid: true };
  if (givenCur === 'usd' && !rate) return { typed: true, invalid: true };
  const givenLocal = givenCur === 'usd' ? n * rate : n;
  const diff = round2(givenLocal - cartTotal());
  return { typed: true, n, rate, givenLocal, diff, short: diff < -0.005 };
}

function ensureChangeBox() {
  if ($('#change-box')) return;

  const mkSeg = (id, label, onPick) => {
    const wrap = h('div', { class: 'seg', id, role: 'group', 'aria-label': label });
    wrap.addEventListener('click', (event) => {
      const button = event.target.closest('[data-cur]');
      if (button) onPick(button.dataset.cur);
    });
    return wrap;
  };

  const box = h(
    'div',
    { id: 'change-box', class: 'change-box' },
    h('div', { class: 'change-head' }, h('b', { text: 'Monnaie à rendre' }), h('button', { type: 'button', class: 'link-btn', id: 'change-rate', 'data-act-rate': '1', text: '' })),
    h(
      'label',
      { class: 'field' },
      h('span', { text: 'Le client donne' }),
      h('input', { id: 'cash-given', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0' })
    ),
    mkSeg('given-cur', 'Monnaie donnée par le client', (value) => pickCurrency('given', value)),
    h('span', { class: 'change-label', text: 'Vous rendez en' }),
    mkSeg('back-cur', 'Monnaie rendue au client', (value) => pickCurrency('back', value)),
    h('div', { id: 'change-result', class: 'change-result', 'aria-live': 'polite' })
  );

  $('#btn-checkout').before(box);

  $('#cash-given').addEventListener('input', () => {
    updateChange();
    updateCheckout();
  });
  $('#change-rate').addEventListener('click', () => openRateSheet(ctx, currency(), false));
}

function pickCurrency(which, value) {
  const rate = rateOf(ctx.store.getProfile());
  if (value === 'usd' && !rate) {
    openRateSheet(ctx, currency(), false);
    return;
  }
  const next = value === 'usd' ? 'usd' : 'local';
  if (which === 'given') givenCur = next;
  else backCur = next;
  updateChange();
  updateCheckout();
}

function updateChange() {
  const box = $('#change-box');
  if (!box) return;
  box.classList.toggle('hide', mode !== 'paid');
  if (mode !== 'paid') return;

  const cur = currency();
  const sym = symbol(cur);
  const rate = rateOf(ctx.store.getProfile());
  if (!rate) {
    givenCur = 'local';
    backCur = 'local';
  }

  const paint = (id, selected) => {
    const wrap = $(id);
    clear(wrap);
    [
      ['local', sym],
      ['usd', '$']
    ].forEach(([value, label]) =>
      wrap.append(h('button', { type: 'button', 'data-cur': value, 'aria-pressed': String(selected === value), text: label }))
    );
  };
  paint('#given-cur', givenCur);
  paint('#back-cur', backCur);

  $('#change-rate').textContent = rate > 0 ? '1 $ = ' + new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(rate) + ' ' + sym + ' · Modifier' : 'Définir le taux de change';

  const out = $('#change-result');
  clear(out);
  const total = cartTotal();

  if (!cart.size) {
    out.append(h('p', { class: 'muted', text: 'Ajoutez des produits pour calculer la monnaie.' }));
    return;
  }

  const totalLine = showIn(total, 'local', rate, cur) + (rate > 0 ? ' · ' + showIn(total, 'usd', rate, cur) : '');
  out.append(h('div', { class: 'kv' }, h('small', { text: 'Total à payer' }), h('b', { text: totalLine })));

  const info = cashInfo();
  if (!info.typed) {
    out.append(h('p', { class: 'muted', text: 'Saisissez le montant donné par le client.' }));
    return;
  }
  if (info.invalid) {
    out.append(h('p', { class: 'error', text: givenCur === 'usd' && !rate ? 'Définissez d’abord le taux de change.' : 'Montant invalide.' }));
    return;
  }
  if (info.short) {
    out.append(h('div', { class: 'kv' }, h('small', { text: 'Il manque' }), h('b', { class: 'change-short', text: showIn(-info.diff, givenCur, rate, cur) })));
    return;
  }
  if (info.diff === 0) {
    out.append(h('div', { class: 'kv' }, h('small', { text: 'Monnaie à rendre' }), h('b', { class: 'change-ok', text: 'Compte exact, rien à rendre' })));
    return;
  }
  out.append(
    h(
      'div',
      { class: 'kv' },
      h('small', { text: 'Monnaie à rendre' }),
      h('b', { class: 'change-ok', text: showIn(info.diff, backCur, rate, cur) }),
      rate > 0 ? h('small', { text: '≈ ' + showIn(info.diff, backCur === 'usd' ? 'local' : 'usd', rate, cur) }) : null
    )
  );
}

/* ---------- Produits et panier ---------- */

function renderProducts() {
  const box = $('#pos-products');
  clear(box);
  const cur = currency();
  let list = ctx.store.getProducts();

  if (!list.length) {
    box.append(
      h(
        'div',
        { class: 'empty', style: 'grid-column:1/-1' },
        h('div', { class: 'icon-box gold', text: 'S' }),
        h('h3', { text: 'Aucun produit à vendre' }),
        h('p', { text: 'Ajoutez d’abord vos produits dans le stock.' }),
        h('button', { type: 'button', class: 'btn', 'data-action': 'add-product', text: 'Ajouter un produit' })
      )
    );
    return;
  }

  if (term) {
    const t = norm(term);
    list = list.filter((p) => norm(p.name).includes(t) || norm(p.sku).includes(t));
  }
  if (!list.length) {
    box.append(h('div', { class: 'empty', style: 'grid-column:1/-1' }, h('h3', { text: 'Aucun résultat' }), h('p', { text: 'Essayez un autre nom.' })));
    return;
  }

  list.slice(0, SHOW_MAX).forEach((p) => {
    const inCart = cart.get(p.id) || 0;
    const left = Math.max(0, p.qty - inCart);
    const button = h(
      'button',
      { type: 'button', class: 'pos-product', 'data-add': p.id },
      h('b', { text: p.name }),
      h('span', { text: left <= 0 ? (p.qty <= 0 ? 'Épuisé' : 'Tout dans le panier') : qtyText(left) + ' dispo' + (inCart ? ' · ' + inCart + ' au panier' : '') }),
      h('em', { text: money(p.sellPrice, cur) })
    );
    if (left < 1 && !(left > 0)) button.setAttribute('disabled', '');
    box.append(button);
  });

  if (list.length > SHOW_MAX) {
    box.append(h('p', { class: 'muted', style: 'grid-column:1/-1;font-size:.85rem', text: 'Affinez la recherche pour voir les ' + (list.length - SHOW_MAX) + ' autres produits.' }));
  }
}

function renderCart() {
  const box = $('#cart-lines');
  clear(box);
  const cur = currency();

  if (!cart.size) {
    box.append(h('div', { class: 'empty', style: 'padding:1.5rem 1rem' }, h('p', { text: 'Le panier est vide. Touchez un produit pour l’ajouter.' })));
  } else {
    cart.forEach((qty, id) => {
      const p = ctx.store.findProduct(id);
      if (!p) return;
      box.append(
        h(
          'div',
          { class: 'cart-line' },
          h('div', {}, h('b', { text: p.name }), h('div', { class: 'item-sub', text: money(p.sellPrice, cur) + ' × ' + qtyText(qty) })),
          h('div', { class: 'item-end', text: money(p.sellPrice * qty, cur) }),
          h(
            'div',
            { class: 'qty', role: 'group', 'aria-label': 'Quantité de ' + p.name },
            h('button', { type: 'button', 'data-act': 'dec', 'data-id': id, 'aria-label': 'Retirer un', text: '−' }),
            h('span', { text: qtyText(qty) }),
            h('button', { type: 'button', 'data-act': 'inc', 'data-id': id, 'aria-label': 'Ajouter un', text: '+' })
          ),
          h('button', { type: 'button', class: 'link-btn', 'data-act': 'del', 'data-id': id, style: 'justify-self:end;font-size:.85rem', text: 'Retirer' })
        )
      );
    });
  }

  $('#cart-total').textContent = money(cartTotal(), cur);
  ensureChangeBox();
  updateChange();
  updateCheckout();
}

function renderCredit() {
  const wrap = $('#credit-fields');
  wrap.classList.toggle('hide', mode !== 'credit');
  if (mode !== 'credit') return;

  const customers = ctx.store.getCustomers();
  const signature = customers.map((c) => c.id + ':' + c.name).join('|');
  if (signature === creditSignature && $('#credit-paid')) return;
  creditSignature = signature;

  const select = $('#credit-customer');
  clear(select);
  select.append(h('option', { value: '', text: customers.length ? 'Choisir un client' : 'Aucun client enregistré' }));
  customers.forEach((c) => select.append(h('option', { value: c.id, text: c.name })));
  if (customerId && customers.some((c) => c.id === customerId)) select.value = customerId;
  else customerId = '';

  let extra = $('#credit-extra');
  if (!extra) {
    extra = h(
      'div',
      { id: 'credit-extra' },
      h('button', { type: 'button', class: 'link-btn', 'data-action': 'add-customer', text: '+ Nouveau client', style: 'font-size:.88rem' }),
      h(
        'label',
        { class: 'field' },
        h('span', { text: 'Acompte payé maintenant (facultatif)' }),
        h('input', { id: 'credit-paid', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0' })
      )
    );
    wrap.append(extra);
  }
}

function updateCheckout() {
  const button = $('#btn-checkout');
  if (busy) return;
  const total = cartTotal();
  const missing = mode === 'credit' && !customerId;
  const cash = cashInfo();
  const cashBad = cash.typed && (cash.invalid || cash.short);
  button.disabled = !cart.size || missing || cashBad;
  button.textContent = !cart.size
    ? 'Valider la vente'
    : missing
      ? 'Choisissez le client'
      : cashBad
        ? cash.invalid
          ? 'Montant reçu invalide'
          : 'Montant reçu insuffisant'
        : 'Valider · ' + money(total, currency());
}

function setMode(next) {
  mode = next === 'credit' ? 'credit' : 'paid';
  $$('#pay-mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  renderCredit();
  updateChange();
  updateCheckout();
}

function addToCart(id) {
  const p = ctx.store.findProduct(id);
  if (!p) return;
  const current = cart.get(id) || 0;
  if (current + 1 > p.qty) {
    toast('Stock maximum atteint pour ' + p.name + '.', 'warn');
    return;
  }
  cart.set(id, current + 1);
  renderProducts();
  renderCart();
}

function changeQty(id, delta) {
  const p = ctx.store.findProduct(id);
  const current = cart.get(id) || 0;
  const next = current + delta;
  if (!p || next <= 0) cart.delete(id);
  else if (next > p.qty) {
    toast('Stock maximum atteint pour ' + p.name + '.', 'warn');
    return;
  } else cart.set(id, next);
  renderProducts();
  renderCart();
}

function receiptText(sale, paidNow, cash) {
  const cur = currency();
  const profile = ctx.store.getProfile();
  const lines = ['*' + (profile.businessName || 'Kontra Africa') + '*', 'Reçu n° ' + sale.invoiceNo, new Date(sale.createdAtMs).toLocaleString('fr-FR'), ''];
  sale.items.forEach((i) => lines.push(qtyText(i.qty) + ' × ' + i.name + ' : ' + money(i.price * i.qty, cur)));
  lines.push('', 'Total : ' + money(sale.total, cur));
  if (cash) lines.push('Reçu : ' + cash.given, 'Rendu : ' + cash.change);
  if (sale.status === 'credit') {
    lines.push('Payé : ' + money(paidNow, cur), 'Reste à payer : ' + money(sale.total - paidNow, cur));
  }
  lines.push('', 'Merci de votre confiance.');
  return lines.join('\n');
}

function showReceipt(sale, paidNow, cash) {
  const cur = currency();
  const share = h('a', {
    class: 'btn btn-gold btn-block',
    href: 'https://wa.me/?text=' + encodeURIComponent(receiptText(sale, paidNow, cash)),
    target: '_blank',
    rel: 'noopener',
    text: 'Envoyer le reçu par WhatsApp'
  });
  ctx.openSheet([
    h('div', { class: 'icon-box', style: 'margin-bottom:.75rem', text: '✓' }),
    h('h3', { text: 'Vente enregistrée' }),
    h('p', { class: 'muted', style: 'margin:.25rem 0 1rem', text: 'Reçu n° ' + sale.invoiceNo }),
    h(
      'div',
      { class: 'panel', style: 'margin:0 0 1rem' },
      h('div', { class: 'kv' }, h('small', { text: 'Total' }), h('b', { text: money(sale.total, cur) })),
      cash ? h('div', { class: 'kv' }, h('small', { text: 'Reçu du client' }), h('b', { text: cash.given })) : null,
      cash ? h('div', { class: 'kv' }, h('small', { text: 'Monnaie à rendre' }), h('b', { text: cash.change })) : null,
      sale.status === 'credit'
        ? h('div', { class: 'kv' }, h('small', { text: 'Reste à payer par ' + sale.customerName }), h('b', { text: money(sale.total - paidNow, cur) }))
        : null
    ),
    h('div', { class: 'stack', style: '--gap:.6rem' }, share, h('button', { type: 'button', class: 'btn btn-ghost btn-block', text: 'Nouvelle vente', onclick: () => ctx.closeSheet() }))
  ]);
}

async function checkout() {
  if (busy || !cart.size) return;
  const button = $('#btn-checkout');
  const paidInput = $('#credit-paid');
  const lines = [];
  cart.forEach((qty, productId) => lines.push({ productId, qty }));
  const paidNow = mode === 'credit' && paidInput ? paidInput.value.trim() : '';

  let cash = null;
  const info = cashInfo();
  if (info.typed) {
    if (info.invalid || info.short) {
      toast('Vérifiez le montant donné par le client.', 'warn');
      return;
    }
    const cur = currency();
    cash = {
      given: givenCur === 'usd' ? money(info.n, 'USD') : money(info.n, cur),
      change: info.diff === 0 ? 'Aucune' : showIn(info.diff, backCur, info.rate, cur)
    };
  }

  busy = true;
  setLoading(button, true);
  try {
    const sale = await ctx.store.createSale({
      lines,
      mode,
      customerId: mode === 'credit' ? customerId : '',
      paidNow: paidNow === '' ? 0 : paidNow
    });
    cart.clear();
    if (paidInput) paidInput.value = '';
    const cashInput = $('#cash-given');
    if (cashInput) cashInput.value = '';
    showReceipt(sale, sale.paid, cash);
  } catch (err) {
    toast(ctx.store.storeError(err), 'error', 5000);
    if (isLimit(err)) ctx.openPaywall();
    else if (err && err.code === 'subscription_expired') ctx.navigate('home');
  } finally {
    busy = false;
    setLoading(button, false);
    cleanCart();
    renderProducts();
    renderCart();
  }
}

function wire() {
  if (wired) return;
  wired = true;

  $('#pos-search').addEventListener(
    'input',
    debounce((event) => {
      term = event.target.value.trim();
      renderProducts();
    }, 200)
  );
  $('#pos-products').addEventListener('click', (event) => {
    const button = event.target.closest('[data-add]');
    if (button) addToCart(button.dataset.add);
  });
  $('#cart-lines').addEventListener('click', (event) => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const id = button.dataset.id;
    if (button.dataset.act === 'inc') changeQty(id, 1);
    else if (button.dataset.act === 'dec') changeQty(id, -1);
    else {
      cart.delete(id);
      renderProducts();
      renderCart();
    }
  });
  $('#pay-mode').addEventListener('click', (event) => {
    const button = event.target.closest('[data-mode]');
    if (button) setMode(button.dataset.mode);
  });
  $('#credit-customer').addEventListener('change', (event) => {
    customerId = event.target.value;
    updateCheckout();
  });
  $('#btn-checkout').addEventListener('click', checkout);
}

export function init(context) {
  ctx = context;
  wire();
  ctx.store.subscribe(() => {
    if (!active || busy) return;
    cleanCart();
    renderProducts();
    renderCart();
    renderCredit();
  });
}

export async function show(_name, context) {
  ctx = context || ctx;
  if (!ctx.canWrite()) {
    ctx.navigate('home');
    return;
  }
  active = true;
  const mine = ++token;
  renderProducts();
  renderCart();
  setMode(mode);
  try {
    await Promise.all([ctx.store.loadProducts(), ctx.store.loadCustomers(), ctx.store.loadStats(), ctx.store.loadProfile()]);
  } catch (err) {
    if (mine === token) toast(ctx.store.storeError(err), 'error', 5000);
    return;
  }
  if (mine !== token) return;
  cleanCart();
  renderProducts();
  renderCart();
  renderCredit();
}

export function hide() {
  active = false;
}
