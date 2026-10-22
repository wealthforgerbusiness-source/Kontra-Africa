import { api, payments, refreshAfterPayment, errorMessage, ApiError } from './firebase.js';
import { $, $$, h, clear, toast, setLoading, lockScroll, money, formatDate } from './ui.js';

const PLAN_RANK = { starter: 1, business: 2, pro: 3 };
const PLAN_NAMES = { starter: 'Starter', business: 'Business', pro: 'Pro' };
const K_COUNTRY = 'kontra_country';
const CONTACT = 'optisitedigital@gmail.com';

const FALLBACK = {
  BJ: { flag: 'assets/flags/benin.png', currency: 'XOF', methods: ['MTN MoMo', 'Moov Money', 'Celtiis Cash'], prices: { starter: 2900, business: 6960, pro: 14500 } },
  BF: { flag: 'assets/flags/burkina-faso.png', currency: 'XOF', methods: ['Orange Money', 'Moov Money'], prices: { starter: 2900, business: 6960, pro: 14500 } },
  CM: { flag: 'assets/flags/cameroun.png', currency: 'XAF', methods: ['MTN MoMo', 'Orange Money'], prices: { starter: 2900, business: 6960, pro: 14500 } },
  CI: { flag: 'assets/flags/cote-ivoire.png', currency: 'XOF', methods: ['Orange Money', 'MTN MoMo', 'Wave', 'Moov Money'], prices: { starter: 2900, business: 6960, pro: 14500 } },
  ML: { flag: 'assets/flags/mali.png', currency: 'XOF', methods: ['Orange Money', 'Moov Money'], prices: { starter: 2900, business: 6960, pro: 14500 } },
  CD: { flag: 'assets/flags/rdc.png', currency: 'CDF', methods: ['Vodacom', 'Airtel Money', 'Orange Money'], prices: { starter: 11250, business: 27000, pro: 56250 } },
  SN: { flag: 'assets/flags/senegal.png', currency: 'XOF', methods: ['Orange Money', 'Wave', 'YAS'], prices: { starter: 2900, business: 6960, pro: 14500 } },
  TG: { flag: 'assets/flags/togo.png', currency: 'XOF', methods: ['Moov Money', 'MTN MoMo'], prices: { starter: 2900, business: 6960, pro: 14500 } }
};

const TIMEZONES = {
  'Africa/Kinshasa': 'CD',
  'Africa/Lubumbashi': 'CD',
  'Africa/Abidjan': 'CI',
  'Africa/Dakar': 'SN',
  'Africa/Lome': 'TG',
  'Africa/Porto-Novo': 'BJ',
  'Africa/Ouagadougou': 'BF',
  'Africa/Bamako': 'ML',
  'Africa/Douala': 'CM'
};

const TYPE_LABELS = {
  new: 'Nouvel abonnement',
  renew: 'Renouvellement',
  upgrade: 'Passage à une offre supérieure'
};

let ctx = null;
let data = FALLBACK;
let catalogLoaded = false;
let isOpen = false;
let busy = false;
let wired = false;
let country = 'CI';
let selected = '';
let quote = null;

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (_e) {
    return null;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_e) {
    return;
  }
}

function safeFlag(path) {
  return typeof path === 'string' && /^assets\/flags\/[a-z0-9-]+\.png$/.test(path) ? path : null;
}

function safeCheckoutUrl(value) {
  try {
    const url = new URL(String(value));
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return null;
    if (host !== 'saspay.me' && !host.endsWith('.saspay.me')) return null;
    return url.toString();
  } catch (_e) {
    return null;
  }
}

function activeSub() {
  const sub = ctx && ctx.subscription();
  if (!sub) return null;
  return sub.status === 'active' && Number(sub.expiresAtMs) > Date.now() ? sub : null;
}

function guessCountry() {
  const sub = ctx && ctx.subscription();
  if (sub && FALLBACK[sub.country]) return sub.country;
  const saved = lsGet(K_COUNTRY);
  if (saved && FALLBACK[saved]) return saved;
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && TIMEZONES[zone]) return TIMEZONES[zone];
  } catch (_e) {
    return 'CI';
  }
  return 'CI';
}

async function loadCatalog() {
  if (catalogLoaded) return;
  catalogLoaded = true;
  try {
    const json = await api('/api/catalog', { auth: false });
    if (!json || !Array.isArray(json.countries)) return;
    const next = {};
    json.countries.forEach((c) => {
      if (!c || !FALLBACK[c.code] || !Array.isArray(c.methods) || !c.prices) return;
      const prices = {};
      Object.keys(PLAN_RANK).forEach((id) => {
        const value = Number(c.prices[id]);
        if (Number.isFinite(value) && value > 0) prices[id] = value;
      });
      if (Object.keys(PLAN_RANK).some((id) => !(id in prices))) return;
      next[c.code] = {
        flag: safeFlag(c.flag) || FALLBACK[c.code].flag,
        currency: String(c.currency || FALLBACK[c.code].currency),
        methods: c.methods.map((m) => String(m)).slice(0, 6),
        prices
      };
    });
    if (Object.keys(next).length) data = Object.assign({}, FALLBACK, next);
  } catch (_e) {
    catalogLoaded = false;
  }
}

function setError(message) {
  const node = $('#pay-error');
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('hide', !message);
}

function setWaiting(on, text) {
  $('#pay-wait').classList.toggle('hide', !on);
  if (text) $('#pay-wait-text').textContent = text;
  busy = Boolean(on);
  $$('[data-choose]').forEach((b) => {
    if (on) b.setAttribute('data-wait', '1');
    else b.removeAttribute('data-wait');
  });
}

function renderHeader() {
  const sub = ctx && ctx.subscription();
  const eyebrow = $('#paywall-eyebrow');
  const title = $('#paywall-title');
  const text = $('#paywall-sub');
  const now = Date.now();
  const lapsed = !sub || sub.status === 'expired' || Number(sub.expiresAtMs) <= now;

  if (sub && sub.status === 'active' && !lapsed) {
    eyebrow.textContent = 'Votre offre : ' + (sub.planName || '');
    title.textContent = 'Renouveler ou changer d’offre';
    text.textContent = 'Valable jusqu’au ' + formatDate(sub.expiresAtMs) + '. Passer à une offre supérieure : le temps déjà payé est déduit.';
  } else if (lapsed) {
    eyebrow.textContent = 'Accès suspendu';
    title.textContent = 'Choisissez une offre pour continuer';
    text.textContent = 'Payez par Mobile Money dans votre monnaie. Vos données sont conservées tant que votre compte n’est pas supprimé.';
  } else {
    eyebrow.textContent = 'Essai gratuit';
    title.textContent = 'Passez à une offre payante';
    text.textContent = 'Payez par Mobile Money dans votre monnaie. Aucun renouvellement automatique.';
  }
}

function renderCountry() {
  const entry = data[country] || FALLBACK[country];
  if (!entry) return;
  const select = $('#pw-country');
  if (select.value !== country) select.value = country;

  const flag = $('#pw-flag');
  const path = safeFlag(entry.flag) || FALLBACK[country].flag;
  if (flag.getAttribute('src') !== path) {
    flag.setAttribute('src', path);
    const label = select.selectedOptions[0] ? select.selectedOptions[0].textContent : '';
    flag.setAttribute('alt', label ? 'Drapeau : ' + label : 'Drapeau du pays choisi');
  }
  $('#pw-methods').textContent = entry.methods.join(', ');

  Object.keys(PLAN_RANK).forEach((id) => {
    const node = $('[data-pw-price="' + id + '"]');
    const price = Number(entry.prices[id]);
    if (node && Number.isFinite(price)) {
      node.textContent = money(price, entry.currency);
      node.classList.remove('swap');
      void node.offsetWidth;
      node.classList.add('swap');
    }
  });
}

function renderCards() {
  const sub = activeSub();
  const currentRank = sub ? PLAN_RANK[sub.planId] || 0 : 0;

  Object.keys(PLAN_RANK).forEach((id) => {
    const card = $('[data-plan-card="' + id + '"]');
    const button = $('[data-choose="' + id + '"]');
    if (!card || !button) return;
    const old = $('.pw-tag', card);
    if (old) old.remove();

    button.disabled = false;
    button.textContent = 'Choisir ' + PLAN_NAMES[id];

    if (sub && id === sub.planId) {
      button.textContent = 'Renouveler ' + PLAN_NAMES[id];
      const tag = h('span', { class: 'badge badge-dark pw-tag', text: 'Offre actuelle', style: 'align-self:flex-start' });
      card.insertBefore(tag, card.firstElementChild);
    } else if (sub && PLAN_RANK[id] < currentRank) {
      button.disabled = true;
      button.textContent = 'Après votre offre actuelle';
    }
    card.classList.toggle('is-selected', id === selected);
  });
}

function clearSummary() {
  selected = '';
  quote = null;
  const box = $('#pay-summary');
  clear(box);
  box.classList.add('hide');
  renderCards();
}

function line(label, value, cls) {
  return h('div', { class: 'line' + (cls ? ' ' + cls : '') }, h('span', { text: label }), h('b', { text: value }));
}

function renderSummary() {
  const box = $('#pay-summary');
  clear(box);
  if (!quote || !selected) {
    box.classList.add('hide');
    return;
  }

  const sub = activeSub();
  const duration =
    quote.type === 'renew' && sub
      ? '30 jours ajoutés à la fin de votre période actuelle'
      : '30 jours à partir d’aujourd’hui';

  box.append(
    line('Offre', PLAN_NAMES[selected]),
    line('Type', TYPE_LABELS[quote.type] || 'Abonnement'),
    line('Durée', duration)
  );
  if (quote.credit > 0) box.append(line('Temps restant déduit', '− ' + money(quote.credit, quote.currency)));
  box.append(line('Total à payer', money(quote.amount, quote.currency), 'total'));

  const pay = h('button', {
    type: 'button',
    class: 'btn btn-lg btn-block',
    text: 'Payer ' + money(quote.amount, quote.currency),
    onclick: () => confirmPayment(pay)
  });
  const back = h('button', { type: 'button', class: 'btn btn-ghost btn-block', text: 'Changer d’offre', onclick: clearSummary });
  box.append(h('div', { class: 'stack', style: '--gap:.6rem;margin-top:.75rem' }, pay, back));
  box.classList.remove('hide');
  if (box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function pick(planId, button) {
  if (busy || !PLAN_RANK[planId]) return;
  setError('');
  selected = planId;
  quote = null;
  renderCards();

  const box = $('#pay-summary');
  clear(box);
  box.append(h('p', { class: 'muted', text: 'Calcul du montant…' }));
  box.classList.remove('hide');
  setLoading(button, true);

  try {
    const result = await payments.quote(planId, country);
    if (selected !== planId) return;
    quote = result;
    renderSummary();
  } catch (err) {
    clearSummary();
    setError(errorMessage(err));
  } finally {
    setLoading(button, false);
  }
}

async function confirmPayment(button) {
  if (busy || !selected || !quote) return;
  setError('');
  setLoading(button, true);
  try {
    const result = await payments.checkout(selected, country);
    const url = safeCheckoutUrl(result.checkoutUrl);
    if (!url) throw new ApiError('payment_provider_error', 0);

    if (Number(result.amount) !== Number(quote.amount) || result.currency !== quote.currency) {
      quote = {
        type: result.type,
        currency: result.currency,
        credit: result.credit,
        amount: result.amount
      };
      renderSummary();
      toast('Le montant a été mis à jour. Vérifiez puis confirmez à nouveau.', 'warn', 6000);
      return;
    }

    busy = true;
    $('#pay-summary').classList.add('hide');
    $('#pay-wait').classList.remove('hide');
    $('#pay-wait-text').textContent = 'Redirection vers la page de paiement sécurisée…';
    window.location.assign(url);
  } catch (err) {
    busy = false;
    $('#pay-wait').classList.add('hide');
    setLoading(button, false);
    setError(errorMessage(err));
  }
}

function show() {
  const overlay = $('#paywall');
  if (isOpen) return;
  isOpen = true;
  overlay.classList.remove('hide');
  lockScroll(true);
  overlay.scrollTop = 0;
}

function hide() {
  if (!isOpen) return;
  isOpen = false;
  $('#paywall').classList.add('hide');
  lockScroll(false);
  setError('');
  clearSummary();
  $('#pay-wait').classList.add('hide');
  busy = false;
}

function wire() {
  if (wired) return;
  wired = true;

  $('#paywall-close').addEventListener('click', () => {
    if (!busy) hide();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen && !busy) hide();
  });

  $('#pw-country').addEventListener('change', (event) => {
    if (busy) {
      event.target.value = country;
      return;
    }
    const code = event.target.value;
    if (!FALLBACK[code]) return;
    country = code;
    lsSet(K_COUNTRY, code);
    setError('');
    renderCountry();
    clearSummary();
  });

  $('#paywall').addEventListener('click', (event) => {
    const button = event.target.closest('[data-choose]');
    if (button && !button.disabled) pick(button.dataset.choose, button);
  });
}

export function init(context) {
  ctx = context;
  wire();
}

export async function open(options) {
  const o = options || {};
  await loadCatalog();
  country = guessCountry();
  setError('');
  clearSummary();
  renderHeader();
  renderCountry();
  renderCards();
  show();
  if (o.plan && PLAN_RANK[o.plan]) {
    const button = $('[data-choose="' + o.plan + '"]');
    if (button && !button.disabled) pick(o.plan, button);
  }
}

export async function handleReturn(paymentId) {
  await loadCatalog();
  country = guessCountry();
  clearSummary();
  renderHeader();
  renderCountry();
  renderCards();
  show();
  setError('');
  setWaiting(true, 'Confirmation du paiement en cours…');

  let result = 'PENDING';
  try {
    result = await refreshAfterPayment(paymentId, 12);
  } catch (err) {
    setWaiting(false);
    setError(errorMessage(err));
    return;
  }
  setWaiting(false);

  if (result === 'SUCCESS') {
    try {
      await ctx.refreshAccount();
    } catch (_e) {
      toast('Paiement confirmé. Actualisez la page si votre offre ne s’affiche pas.', 'warn', 6000);
    }
    hide();
    toast('Paiement confirmé. Merci !', 'ok', 5000);
    return;
  }

  if (result === 'FAILED' || result === 'CANCELLED') {
    setError('Le paiement n’a pas abouti. Vous pouvez réessayer. Si de l’argent a été débité, écrivez à ' + CONTACT + ' avec l’heure du paiement.');
    return;
  }

  if (result === 'REVIEW' || result === 'DISMISSED') {
    setError('Votre paiement a bien été reçu, mais il demande une vérification. Écrivez à ' + CONTACT + ' avec l’email de votre compte, la date et le montant.');
    return;
  }

  setError('Le paiement n’est pas encore confirmé. Votre accès s’activera automatiquement dès la confirmation. Vous pouvez fermer cette page.');
}
