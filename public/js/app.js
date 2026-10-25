import { auth, db, onUser, logout, loadAccount, errorMessage } from './firebase.js';
import { terminate, clearIndexedDbPersistence } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import * as store from './store.js';
import {
  $,
  $$,
  h,
  clear,
  getParam,
  toast,
  openOverlay,
  closeOverlay,
  confirmDialog,
  formatDate,
  initUI,
  watchNetwork
} from './ui.js';

const DAY_MS = 86400000;
const PLAN_IDS = ['starter', 'business', 'pro'];
const PAYMENT_RE = /^[A-Za-z0-9_-]{16,64}$/;
const VIEWS = ['home', 'stock', 'sale', 'debts', 'more', 'history', 'finance', 'closing', 'account'];
const TITLES = {
  home: 'Accueil',
  stock: 'Stock',
  sale: 'Nouvelle vente',
  debts: 'Dettes clients',
  more: 'Plus',
  history: 'Ventes',
  finance: 'Finances',
  closing: 'Clôture',
  account: 'Compte et offre'
};
const ROUTES = {
  home: './views/home.js',
  stock: './views/stock.js',
  sale: './views/sale.js',
  debts: './views/debts.js',
  more: './views/more.js',
  history: './views/more.js',
  finance: './views/more.js',
  closing: './views/closing.js',
  account: './views/more.js'
};
const ACTIONS = {
  'add-product': { path: './views/stock.js', write: true },
  'add-customer': { path: './views/debts.js', write: true },
  'add-tx': { path: './views/more.js', write: true }
};

const K_PLAN = 'kontra_plan';
const K_PAYMENT = 'kontra_payment';
const K_LOOP = 'kontra_loop';

const ignore = () => undefined;

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
    ignore();
  }
}
function lsDel(key) {
  try {
    localStorage.removeItem(key);
  } catch (_e) {
    ignore();
  }
}
function ssGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch (_e) {
    return null;
  }
}
function ssSet(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch (_e) {
    ignore();
  }
}
function ssDel(key) {
  try {
    sessionStorage.removeItem(key);
  } catch (_e) {
    ignore();
  }
}

const planParam = getParam('plan');
if (PLAN_IDS.includes(planParam)) lsSet(K_PLAN, planParam);
const payParam = getParam('payment');
if (payParam && PAYMENT_RE.test(payParam)) ssSet(K_PAYMENT, payParam);

const loginParams = new URLSearchParams();
if (getParam('mode') === 'signup') loginParams.set('mode', 'signup');
if (PLAN_IDS.includes(planParam)) loginParams.set('plan', planParam);
const LOGIN_URL = 'login.html' + (loginParams.toString() ? '?' + loginParams.toString() : '');

if (window.location.search) history.replaceState(null, '', window.location.pathname + window.location.hash);

let session = null;
let current = 'home';
let routeId = 0;
let renderToken = 0;
let tickTimer = 0;
let lastRefresh = 0;
let installEvent = null;
const modules = new Map();

function setHidden(node, hidden) {
  if (node) node.classList.toggle('hide', Boolean(hidden));
}

function plural(n, word) {
  return n + ' ' + word + (n > 1 ? 's' : '');
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

function showAppScreen() {
  setHidden($('#app'), false);
  document.body.classList.remove('is-auth');
  setSplash(false);
}

function loopBlocked() {
  const now = Date.now();
  let list = [];
  try {
    list = JSON.parse(ssGet(K_LOOP) || '[]');
  } catch (_e) {
    list = [];
  }
  list = list.filter((t) => now - t < 60000);
  list.push(now);
  ssSet(K_LOOP, JSON.stringify(list));
  return list.length > 3;
}

function goLogin() {
  window.location.replace(LOGIN_URL);
}

function goLoginGuarded() {
  if (loopBlocked()) {
    fail(new Error('redirect_loop'));
    return;
  }
  goLogin();
}

function fail(err) {
  console.error('Application indisponible:', err);
  const splash = $('#splash');
  setSplash(true, '');
  const loader = $('.square-loader', splash);
  if (loader) loader.classList.add('hide');

  const code = err && err.code ? String(err.code) : err && err.message ? String(err.message) : '';
  const status = err && err.status ? ' · HTTP ' + err.status : '';
  let box = $('#splash-error');
  if (!box) {
    box = h('div', { id: 'splash-error', class: 'stack', style: '--gap:.75rem;text-align:center;padding:0 1.25rem;max-width:380px' });
    splash.append(box);
  }
  clear(box);
  box.append(
    h('h2', { text: 'Connexion impossible' }),
    h('p', { class: 'muted', text: errorMessage(err) }),
    code ? h('p', { class: 'muted', style: 'font-size:.78rem;word-break:break-all', text: 'Code technique : ' + code + status }) : null,
    h('button', { type: 'button', class: 'btn btn-block', text: 'Réessayer', onclick: () => window.location.reload() }),
    h('button', { type: 'button', class: 'link-btn', text: 'Se déconnecter', onclick: hardLogout })
  );
}

function readCached(uid) {
  try {
    const data = JSON.parse(lsGet('kontra_acct_' + uid) || 'null');
    return data && data.subscription && typeof data.subscription === 'object' ? data : null;
  } catch (_e) {
    return null;
  }
}

function writeCached(uid, data) {
  lsSet('kontra_acct_' + uid, JSON.stringify({ isAdmin: data.isAdmin === true, subscription: data.subscription }));
}

async function routeUser(user) {
  const rid = ++routeId;
  stopTimers();

  if (!user) {
    session = null;
    goLogin();
    return;
  }

  setSplash(true, '');

  if (!user.emailVerified) {
    try {
      await user.reload();
    } catch (_e) {
      ignore();
    }
    if (rid !== routeId) return;
  }

  if (!user.emailVerified) {
    goLogin();
    return;
  }

  try {
    const result = await user.getIdTokenResult();
    if (result.claims.email_verified !== true) await user.getIdToken(true);
  } catch (_e) {
    ignore();
  }
  if (rid !== routeId) return;

  await enter(user, rid);
}

async function enter(user, rid) {
  const slow = setTimeout(() => setSplash(true, 'Le serveur se réveille, quelques secondes…'), 6000);
  let data = null;
  let offline = false;

  try {
    data = await loadAccount();
    writeCached(user.uid, data);
  } catch (err) {
    clearTimeout(slow);
    if (rid !== routeId) return;
    if (err && (err.status === 404 || err.code === 'no_subscription')) {
      goLoginGuarded();
      return;
    }
    if (err && (err.code === 'network' || err.code === 'timeout')) {
      const cached = readCached(user.uid);
      if (!cached) {
        fail(err);
        return;
      }
      data = cached;
      offline = true;
    } else {
      fail(err);
      return;
    }
  }

  clearTimeout(slow);
  if (rid !== routeId) return;

  if (data.subscription && data.subscription.needsTerms) {
    goLoginGuarded();
    return;
  }

  ssDel(K_LOOP);
  finishEntry(user, data);
  if (offline) toast('Mode hors ligne : consultation uniquement.', 'warn', 5000);
  afterBoot();
}

function hashName() {
  return window.location.hash.slice(1);
}

function guardName(name) {
  if (!VIEWS.includes(name)) return 'home';
  if (name === 'sale' && !store.canWrite()) return 'home';
  return name;
}

function finishEntry(user, data) {
  session = { user, isAdmin: data.isAdmin === true, sub: data.subscription };
  lastRefresh = Date.now();
  $('#side-email').textContent = user.email || '';
  setHidden($('#link-admin'), !session.isAdmin);
  applySubscription(data.subscription);
  showAppScreen();
  startTimers();

  const first = guardName(hashName());
  current = first;
  history.replaceState(null, '', window.location.pathname + '#' + first);
  showView(first);
}

async function afterBoot() {
  const paymentId = ssGet(K_PAYMENT);
  if (paymentId && PAYMENT_RE.test(paymentId)) {
    ssDel(K_PAYMENT);
    try {
      const mod = await loadModule('./paywall.js');
      await mod.handleReturn(paymentId);
    } catch (_e) {
      toast('Impossible de vérifier le paiement. Actualisez la page dans un instant.', 'error', 6000);
    }
    return;
  }
  const plan = lsGet(K_PLAN);
  if (plan && PLAN_IDS.includes(plan)) {
    lsDel(K_PLAN);
    openPaywall({ plan });
  }
}

function applySubscription(sub) {
  const now = Date.now();
  const active = Boolean(sub) && (sub.status === 'trial' || sub.status === 'active') && Number(sub.expiresAtMs) > now;
  store.configure({ limits: sub ? sub.limits : null, canWrite: active });
  renderPill();
  renderNotices();
}

function renderPill() {
  const pill = $('#plan-pill');
  const sub = session && session.sub;
  if (!pill || !sub) return;
  const now = Date.now();
  const left = Math.max(0, Math.ceil((Number(sub.expiresAtMs) - now) / DAY_MS));
  const lapsed = sub.status === 'expired' || Number(sub.expiresAtMs) <= now;
  let label = sub.planName || 'Offre';
  let cls = 'plan-pill';
  if (lapsed) {
    label = 'Expiré';
    cls += ' expired';
  } else if (sub.status === 'trial') {
    label = 'Essai · ' + left + ' j';
    cls += ' trial';
  }
  pill.className = cls;
  pill.textContent = label;
}

function notice(cls, content, label, onClick) {
  return h(
    'div',
    { class: 'banner notice ' + cls },
    h('span', {}, content),
    label ? h('button', { type: 'button', class: 'btn btn-sm', onclick: onClick, text: label }) : null
  );
}

function renderNotices() {
  const box = $('#notices');
  const sub = session && session.sub;
  if (!box) return;
  clear(box);
  if (!sub) return;

  const now = Date.now();
  const expiresAt = Number(sub.expiresAtMs);
  const left = Math.max(0, Math.ceil((expiresAt - now) / DAY_MS));
  const lapsed = sub.status === 'expired' || expiresAt <= now;

  if (lapsed) {
    const parts = [h('b', { text: 'Accès suspendu. ' }), 'Vous pouvez consulter vos données, mais plus en ajouter.'];
    if (sub.deleteAtMs) {
      const days = Math.max(0, Math.ceil((Number(sub.deleteAtMs) - now) / DAY_MS));
      parts.push(
        ' Sans abonnement, votre compte et toutes vos données seront supprimés dans ' +
          plural(days, 'jour') +
          ' (le ' +
          formatDate(sub.deleteAtMs) +
          ').'
      );
    }
    box.append(notice('banner-danger', parts, 'Choisir une offre', () => openPaywall()));
    return;
  }

  if (sub.status === 'trial') {
    const cls = left <= 3 ? '' : 'banner-ok';
    box.append(
      notice(
        cls,
        [h('b', { text: 'Essai gratuit : ' }), plural(left, 'jour') + ' restant' + (left > 1 ? 's' : '') + '.'],
        'Choisir une offre',
        () => openPaywall()
      )
    );
    return;
  }

  if (sub.status === 'active' && left <= 5) {
    box.append(
      notice(
        '',
        ['Votre offre ' + (sub.planName || '') + ' se termine dans ' + plural(left, 'jour') + '.'],
        'Renouveler',
        () => openPaywall()
      )
    );
  }
}

function updateNav(name) {
  const tabName = ['history', 'finance', 'closing', 'account'].includes(name) ? 'more' : name;
  const mark = (node, on) => (on ? node.setAttribute('aria-current', 'page') : node.removeAttribute('aria-current'));
  $$('.tabbar .tab').forEach((b) => mark(b, b.dataset.nav === tabName));
  $$('.side-nav button').forEach((b) => mark(b, b.dataset.nav === name));
  const title = $('#topbar-title');
  if (title) title.textContent = TITLES[name] || '';
}

function loadModule(path) {
  if (!modules.has(path)) {
    const promise = import(path).then(async (mod) => {
      if (typeof mod.init === 'function') await mod.init(ctx);
      return mod;
    });
    modules.set(path, promise);
    promise.catch(() => modules.delete(path));
  }
  return modules.get(path);
}

async function renderView(name) {
  const token = ++renderToken;
  try {
    const mod = await loadModule(ROUTES[name]);
    if (token !== renderToken) return;
    await mod.show(name, ctx);
  } catch (err) {
    console.error('Écran indisponible:', name, err && err.message ? err.message : err);
    if (token === renderToken) toast('Impossible de charger cet écran. Vérifiez votre connexion.', 'error');
  }
}

function showView(name) {
  current = name;
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  updateNav(name);
  window.scrollTo(0, 0);
  renderView(name);
}

function navigate(name) {
  if (!session) return;
  if (name === 'sale' && !store.canWrite()) {
    toast('Votre accès est suspendu. Choisissez une offre pour vendre.', 'warn');
    openPaywall();
    return;
  }
  const target = VIEWS.includes(name) ? name : 'home';
  if (target !== current && hashName() !== target) history.pushState(null, '', window.location.pathname + '#' + target);
  showView(target);
}

function openSheet(content) {
  const body = $('#sheet-body');
  if (!body) return;
  clear(body);
  body.append(...[].concat(content));
  openOverlay($('#sheet'));
}

function closeSheet() {
  closeOverlay($('#sheet'));
}

async function openPaywall(options) {
  try {
    const mod = await loadModule('./paywall.js');
    await mod.open(options || {});
  } catch (err) {
    console.error('Paiement indisponible:', err && err.message ? err.message : err);
    toast('Le paiement est momentanément indisponible. Réessayez.', 'error');
  }
}

async function runAction(name) {
  if (name === 'open-paywall') {
    openPaywall();
    return;
  }
  const entry = ACTIONS[name];
  if (!entry) return;
  if (entry.write && !store.canWrite()) {
    toast('Votre accès est suspendu. Choisissez une offre pour continuer.', 'warn');
    openPaywall();
    return;
  }
  try {
    const mod = await loadModule(entry.path);
    await mod.action(name, ctx);
  } catch (err) {
    console.error('Action indisponible:', name, err && err.message ? err.message : err);
    toast('Action indisponible. Vérifiez votre connexion.', 'error');
  }
}

async function refreshAccount() {
  const data = await loadAccount();
  if (data.subscription && data.subscription.needsTerms) {
    goLoginGuarded();
    return null;
  }
  if (session) {
    session.isAdmin = data.isAdmin === true;
    session.sub = data.subscription;
    if (auth.currentUser) writeCached(auth.currentUser.uid, data);
    setHidden($('#link-admin'), !session.isAdmin);
  }
  lastRefresh = Date.now();
  applySubscription(data.subscription);
  renderView(current);
  return data.subscription;
}

function startTimers() {
  stopTimers();
  tickTimer = setInterval(checkExpiry, 60000);
}

function stopTimers() {
  clearInterval(tickTimer);
  tickTimer = 0;
}

function checkExpiry() {
  if (!session || !session.sub) return;
  const was = store.canWrite();
  applySubscription(session.sub);
  if (was && !store.canWrite()) {
    toast('Votre accès est arrivé à échéance.', 'warn', 6000);
    if (current === 'sale') navigate('home');
    else renderView(current);
  }
}

async function hardLogout() {
  stopTimers();
  store.reset();
  try {
    await logout();
  } catch (_e) {
    ignore();
  }
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (_e) {
    ignore();
  }
  window.location.replace('login.html');
}

async function doLogout() {
  const ok = await confirmDialog({
    title: 'Se déconnecter ?',
    text: 'Vos données restent enregistrées dans votre compte. Elles seront effacées de cet appareil.',
    ok: 'Se déconnecter'
  });
  if (ok) await hardLogout();
}

const ctx = {
  store,
  navigate,
  notify: toast,
  confirm: confirmDialog,
  openSheet,
  closeSheet,
  openPaywall,
  refreshAccount,
  logout: doLogout,
  session: () => session,
  subscription: () => (session ? session.sub : null),
  user: () => (session ? session.user : null),
  canWrite: () => store.canWrite()
};

function wireApp() {
  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      event.preventDefault();
      navigate(nav.dataset.nav);
      return;
    }
    const action = event.target.closest('[data-action]');
    if (action) {
      event.preventDefault();
      runAction(action.dataset.action);
    }
  });

  $('#btn-logout').addEventListener('click', doLogout);
  $('#btn-logout-side').addEventListener('click', doLogout);
  $('#plan-pill').addEventListener('click', () => openPaywall());

  window.addEventListener('popstate', () => {
    if (session) showView(guardName(hashName()));
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !session) return;
    checkExpiry();
    if (Date.now() - lastRefresh > 5 * 60 * 1000) refreshAccount().catch(ignore);
  });

  const banner = $('#install-banner');
  const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installEvent = event;
    if (!standalone) setHidden(banner, false);
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    setHidden(banner, true);
  });
  $('#btn-install').addEventListener('click', async () => {
    if (!installEvent) return;
    const prompt = installEvent;
    installEvent = null;
    setHidden(banner, true);
    try {
      await prompt.prompt();
    } catch (_e) {
      ignore();
    }
  });
}

function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(ignore);
  });
}

function boot() {
  initUI();
  watchNetwork();
  wireApp();
  registerWorker();
  onUser((user) => {
    routeUser(user);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
