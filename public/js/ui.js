const doc = document;

doc.documentElement.classList.add('js');

export const $ = (selector, root) => (root || doc).querySelector(selector);
export const $$ = (selector, root) => Array.from((root || doc).querySelectorAll(selector));

export function h(tag, props, ...kids) {
  const node = doc.createElement(tag);
  const p = props || {};
  Object.keys(p).forEach((key) => {
    const value = p[key];
    if (value === undefined || value === null || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if ((key === 'href' || key === 'src') && /^\s*(javascript|data):/i.test(String(value))) {
      return;
    } else node.setAttribute(key, value === true ? '' : String(value));
  });
  kids.flat().forEach((kid) => {
    if (kid === null || kid === undefined || kid === false) return;
    node.append(kid.nodeType ? kid : doc.createTextNode(String(kid)));
  });
  return node;
}

export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function debounce(fn, ms) {
  let timer;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms || 250);
  };
}

const reducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function splitWords(root) {
  $$('.words', root).forEach((node) => {
    if (node.dataset.split) return;
    node.dataset.split = '1';
    node.setAttribute('aria-label', node.textContent.trim());

    const walker = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);

    let index = 0;
    texts.forEach((textNode) => {
      const frag = doc.createDocumentFragment();
      textNode.nodeValue.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) {
          frag.append(doc.createTextNode(' '));
          return;
        }
        const span = h('span', { class: 'w', 'aria-hidden': 'true' }, part);
        span.style.setProperty('--i', String(index));
        index += 1;
        frag.append(span);
      });
      textNode.replaceWith(frag);
    });
  });
}

let revealObserver = null;

export function initReveal(root) {
  const scope = root || doc;

  $$('[data-stagger]', scope).forEach((parent) => {
    Array.from(parent.children).forEach((child, i) => {
      child.classList.add('reveal');
      child.style.setProperty('--d', (i * 0.08).toFixed(2) + 's');
    });
  });

  const items = $$('.reveal:not(.in)', scope);
  if (!items.length) return;

  if (!('IntersectionObserver' in window) || reducedMotion()) {
    items.forEach((item) => item.classList.add('in'));
    return;
  }

  if (!revealObserver) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('in');
          revealObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    );
  }
  items.forEach((item) => revealObserver.observe(item));
}

export function watchScroll(target, className, offset) {
  const node = target || doc.body;
  const limit = typeof offset === 'number' ? offset : 12;
  let ticking = false;
  const update = () => {
    node.classList.toggle(className || 'scrolled', window.scrollY > limit);
    ticking = false;
  };
  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    },
    { passive: true }
  );
  update();
}

export function countUp(node, to, ms, format) {
  if (!node) return;
  const end = Number(to);
  const fmt = typeof format === 'function' ? format : (v) => Math.round(v).toLocaleString('fr-FR');
  if (!Number.isFinite(end) || reducedMotion()) {
    node.textContent = Number.isFinite(end) ? fmt(end) : '—';
    return;
  }
  const duration = ms || 900;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = fmt(end * eased);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let toastBox = null;

export function toast(message, type, ms) {
  if (!toastBox || !toastBox.isConnected) {
    toastBox =
      $('.toasts') ||
      doc.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  }
  const cls = type === 'error' ? ' error' : type === 'warn' ? ' warn' : '';
  const node = h('div', { class: 'toast' + cls, text: String(message) });
  while (toastBox.children.length >= 3) toastBox.firstElementChild.remove();
  toastBox.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity 0.3s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 320);
  }, ms || 3800);
}

export function setLoading(button, on) {
  if (!button) return;
  const state = Boolean(on);
  button.classList.toggle('is-loading', state);
  button.disabled = state;
  button.setAttribute('aria-busy', state ? 'true' : 'false');
}

export async function withLoading(button, task) {
  setLoading(button, true);
  try {
    return await task();
  } finally {
    setLoading(button, false);
  }
}

let scrollLocks = 0;
const openStack = [];

export function lockScroll(on) {
  scrollLocks = Math.max(0, scrollLocks + (on ? 1 : -1));
  doc.body.classList.toggle('lock', scrollLocks > 0);
}

export function openOverlay(overlay) {
  if (!overlay || overlay.classList.contains('open')) return;
  overlay._returnFocus = doc.activeElement;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  openStack.push(overlay);
  lockScroll(true);
  const dialog = $('.dialog', overlay);
  if (dialog) {
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('tabindex', '-1');
    dialog.focus({ preventScroll: true });
  }
}

export function closeOverlay(overlay) {
  if (!overlay || !overlay.classList.contains('open')) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  const index = openStack.indexOf(overlay);
  if (index !== -1) openStack.splice(index, 1);
  lockScroll(false);
  const back = overlay._returnFocus;
  if (back && typeof back.focus === 'function' && back.isConnected) back.focus({ preventScroll: true });
  overlay.dispatchEvent(new CustomEvent('overlayclose'));
}

export function confirmDialog(options) {
  const o = options || {};
  return new Promise((resolve) => {
    let finished = false;
    let overlay = null;

    const finish = (value) => {
      if (finished) return;
      finished = true;
      closeOverlay(overlay);
      setTimeout(() => overlay.remove(), 60);
      resolve(value);
    };

    const cancel = h('button', {
      type: 'button',
      class: 'btn btn-ghost',
      text: o.cancel || 'Annuler',
      onclick: () => finish(false)
    });
    const ok = h('button', {
      type: 'button',
      class: 'btn' + (o.danger ? ' btn-danger' : ''),
      text: o.ok || 'Confirmer',
      onclick: () => finish(true)
    });

    overlay = h(
      'div',
      { class: 'overlay', 'aria-hidden': 'true' },
      h(
        'div',
        { class: 'dialog stack', style: '--gap:1rem' },
        h('h3', { text: o.title || 'Confirmer' }),
        o.text ? h('p', { class: 'muted', text: o.text }) : null,
        h('div', { class: 'row', style: 'justify-content:flex-end' }, cancel, ok)
      )
    );
    overlay.addEventListener('overlayclose', () => finish(false));
    doc.body.append(overlay);
    openOverlay(overlay);
    (o.danger ? cancel : ok).focus({ preventScroll: true });
  });
}

function trapFocus(event) {
  const top = openStack[openStack.length - 1];
  if (!top || event.key !== 'Tab') return;
  const items = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', top);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && doc.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && doc.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

const CURRENCY_LABEL = { XOF: 'FCFA', XAF: 'FCFA', CDF: 'FC', USD: '$' };
const NO_DECIMALS = ['XOF', 'XAF', 'CDF'];

/* Symbole choisi par le commerçant (ex. « FC », « FCFA », « CFA », « F »).
   Vide = symbole par défaut de la monnaie. */
let customSymbol = '';

export function setCustomSymbol(value) {
  customSymbol = String(value === undefined || value === null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8);
}

export const getCustomSymbol = () => customSymbol;

function formatMoney(amount, currency, useCustom) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  const cur = String(currency || '').toUpperCase();
  const digits = NO_DECIMALS.includes(cur) ? 0 : 2;
  const text = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(n);
  const label = useCustom && customSymbol && cur !== 'USD' ? customSymbol : CURRENCY_LABEL[cur] || cur;
  return text + (cur ? ' ' + label : '');
}

/* Montants de la boutique : utilisent le symbole personnalisé s'il existe. */
export function money(amount, currency) {
  return formatMoney(amount, currency, true);
}

/* Montants fixes (prix des abonnements) : toujours le symbole officiel. */
export function moneyPlain(amount, currency) {
  return formatMoney(amount, currency, false);
}

export function formatDate(ms) {
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function daysLabel(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return 'Expiré';
  return n === 1 ? '1 jour' : n + ' jours';
}

export function monthIdUtc(date) {
  return (date || new Date()).toISOString().slice(0, 7);
}

export function dayIdUtc(date) {
  return (date || new Date()).toISOString().slice(0, 10);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text));
    toast('Copié.');
    return true;
  } catch (_err) {
    toast('Copie impossible.', 'error');
    return false;
  }
}

export function watchNetwork() {
  window.addEventListener('offline', () => toast('Vous êtes hors ligne. Vous pouvez continuer à vendre, tout sera synchronisé plus tard.', 'warn', 5000));
  window.addEventListener('online', () => toast('Connexion rétablie.'));
}

let ready = false;

export function initUI() {
  if (ready) return;
  ready = true;

  splitWords();
  initReveal();

  doc.addEventListener('click', (event) => {
    const opener = event.target.closest('[data-open]');
    if (opener) {
      event.preventDefault();
      openOverlay(doc.getElementById(opener.getAttribute('data-open')));
      return;
    }
    const closer = event.target.closest('[data-close]');
    if (closer) {
      event.preventDefault();
      closeOverlay(closer.closest('.overlay'));
      return;
    }
    if (event.target.classList && event.target.classList.contains('overlay')) {
      closeOverlay(event.target);
    }
  });

  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openStack.length) {
      closeOverlay(openStack[openStack.length - 1]);
      return;
    }
    trapFocus(event);
  });
}
