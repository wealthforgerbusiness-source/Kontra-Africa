import { initUI, $, $$, watchScroll, lockScroll, money } from './ui.js';
import { API_URL, BACKEND_READY } from './config.js';

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

const PLAN_IDS = ['starter', 'business', 'pro'];
const STORAGE_KEY = 'kontra_country';
let data = FALLBACK;

function readSaved() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (_err) {
    return null;
  }
}

function saveChoice(code) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch (_err) {
    return;
  }
}

function guessCountry() {
  const saved = readSaved();
  if (saved && FALLBACK[saved]) return saved;
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && TIMEZONES[zone]) return TIMEZONES[zone];
  } catch (_err) {
    return 'CI';
  }
  return 'CI';
}

function safeFlag(path) {
  return typeof path === 'string' && /^assets\/flags\/[a-z0-9-]+\.png$/.test(path) ? path : null;
}

function renderCountry(code, animate) {
  const entry = data[code] || FALLBACK[code];
  if (!entry) return;

  const flag = $('#country-flag');
  const flagPath = safeFlag(entry.flag) || FALLBACK[code].flag;
  if (flag && flag.getAttribute('src') !== flagPath) {
    flag.setAttribute('src', flagPath);
    const select = $('#country');
    const label = select && select.selectedOptions[0] ? select.selectedOptions[0].textContent : '';
    flag.setAttribute('alt', label ? 'Drapeau : ' + label : 'Drapeau du pays choisi');
  }

  const methods = $('#methods');
  if (methods) methods.textContent = entry.methods.join(', ');

  PLAN_IDS.forEach((id) => {
    const node = $('[data-plan="' + id + '"]');
    const price = entry.prices ? Number(entry.prices[id]) : NaN;
    if (!node || !Number.isFinite(price)) return;
    node.textContent = money(price, entry.currency);
    if (animate) {
      node.classList.remove('swap');
      void node.offsetWidth;
      node.classList.add('swap');
    }
  });
}

function setupCountry() {
  const select = $('#country');
  if (!select) return;

  const initial = guessCountry();
  select.value = initial;
  renderCountry(initial, false);

  select.addEventListener('change', () => {
    saveChoice(select.value);
    renderCountry(select.value, true);
  });
}

async function loadCatalog() {
  if (!BACKEND_READY) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(API_URL + '/api/catalog', { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const json = await response.json();
    if (!json || !Array.isArray(json.countries)) return;

    const next = {};
    json.countries.forEach((c) => {
      if (!c || !FALLBACK[c.code] || !Array.isArray(c.methods) || !c.prices) return;
      const prices = {};
      PLAN_IDS.forEach((id) => {
        const value = Number(c.prices[id]);
        if (Number.isFinite(value) && value > 0) prices[id] = value;
      });
      if (PLAN_IDS.some((id) => !(id in prices))) return;
      next[c.code] = {
        flag: safeFlag(c.flag) || FALLBACK[c.code].flag,
        currency: String(c.currency || FALLBACK[c.code].currency),
        methods: c.methods.map((m) => String(m)).slice(0, 6),
        prices
      };
    });

    if (Object.keys(next).length) {
      data = Object.assign({}, FALLBACK, next);
      const select = $('#country');
      if (select) renderCountry(select.value, false);
    }
  } catch (_err) {
    return;
  } finally {
    clearTimeout(timer);
  }
}

function setupDrawer() {
  const burger = $('#burger');
  const drawer = $('#drawer');
  const backdrop = $('#drawer-backdrop');
  const closeBtn = $('#drawer-close');
  if (!burger || !drawer || !backdrop) return;

  let isOpen = false;
  let hideTimer = 0;

  function open() {
    if (isOpen) return;
    isOpen = true;
    clearTimeout(hideTimer);
    backdrop.hidden = false;
    requestAnimationFrame(() => {
      backdrop.classList.add('open');
      drawer.classList.add('open');
    });
    drawer.setAttribute('aria-hidden', 'false');
    burger.setAttribute('aria-expanded', 'true');
    burger.setAttribute('aria-label', 'Fermer le menu');
    lockScroll(true);
    setTimeout(() => closeBtn && closeBtn.focus({ preventScroll: true }), 60);
  }

  function close(restoreFocus) {
    if (!isOpen) return;
    isOpen = false;
    backdrop.classList.remove('open');
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Ouvrir le menu');
    lockScroll(false);
    hideTimer = setTimeout(() => {
      backdrop.hidden = true;
    }, 400);
    if (restoreFocus) burger.focus({ preventScroll: true });
  }

  burger.addEventListener('click', () => (isOpen ? close(true) : open()));
  if (closeBtn) closeBtn.addEventListener('click', () => close(true));
  backdrop.addEventListener('click', () => close(true));

  $$('[data-drawer-link]', drawer).forEach((link) => link.addEventListener('click', () => close(false)));

  document.addEventListener('keydown', (event) => {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      close(true);
      return;
    }
    if (event.key !== 'Tab') return;
    const items = $$('a[href], button:not([disabled])', drawer);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.matchMedia('(min-width: 900px)').addEventListener('change', (event) => {
    if (event.matches) close(false);
  });
}

function wakeBackend() {
  if (!BACKEND_READY) return;
  fetch(API_URL + '/health', { cache: 'no-store', mode: 'cors' }).catch(() => {});
}

function boot() {
  initUI();
  watchScroll($('#nav'), 'scrolled', 8);
  setupDrawer();
  setupCountry();
  loadCatalog();
  wakeBackend();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
