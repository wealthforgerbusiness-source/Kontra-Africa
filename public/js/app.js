import {
  auth,
  db,
  api,
  onUser,
  signUpEmail,
  signInEmail,
  signInGoogle,
  finishRedirect,
  resetPassword,
  resendVerification,
  refreshVerification,
  logout,
  loadAccount,
  errorMessage
} from './firebase.js';
import { terminate, clearIndexedDbPersistence } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import * as store from './store.js';
import {
  $,
  $$,
  h,
  clear,
  getParam,
  toast,
  setLoading,
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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PANES = ['auth', 'reset', 'verify', 'terms', 'error'];
const VIEWS = ['home', 'stock', 'sale', 'debts', 'more', 'history', 'finance', 'account'];
const TITLES = {
  home: 'Accueil',
  stock: 'Stock',
  sale: 'Nouvelle vente',
  debts: 'Dettes clients',
  more: 'Plus',
  history: 'Ventes',
  finance: 'Finances',
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
  account: './views/more.js'
};
const ACTIONS = {
  'add-product': { path: './views/stock.js', write: true },
  'add-customer': { path: './views/debts.js', write: true },
  'add-tx': { path: './views/more.js', write: true }
};

const K_PENDING = 'kontra_terms_pending';
const K_OK = 'kontra_terms_ok';
const K_PLAN = 'kontra_plan';
const K_PAYMENT = 'kontra_payment';
const PENDING_MS = 5 * 60 * 1000;
const ACCEPT_MS = 3 * DAY_MS;

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
function lsDel(key) {
  try {
    localStorage.removeItem(key);
  } catch (_e) {
    return;
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
    return;
  }
}
function ssDel(key) {
  try {
    sessionStorage.removeItem(key);
  } catch (_e) {
    return;
  }
}

const startMode = getParam('mode') === 'signup' ? 'signup' : 'login';
const planParam = getParam('plan');
if (PLAN_IDS.includes(planParam)) lsSet(K_PLAN, planParam);
const payParam = getParam('payment');
if (payParam && PAYMENT_RE.test(payParam)) ssSet(K_PAYMENT, payParam);
if (window.location.search) history.replaceState(null, '', window.location.pathname + window.location.hash);

let mode = 'login';
let session = null;
let current = 'home';
let routeId = 0;
let renderToken = 0;
let tickTimer = 0;
let verifyTimer = 0;
let resendTimer = 0;
let resendUntil = 0;
let lastRefresh = 0;
let installEvent = null;
const modules = new Map();

function setHidden(node, hidden) {
  if (node) node.classList.toggle('hide', Boolean(hidden));
}

function setError(node, message) {
  if (!node) return;
  node.textContent = message || '';
  setHidden(node, !message);
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

function openPane(name) {
  PANES.forEach((p) => setHidden($('#pane-' + p), p !== name));
  ['#auth-error', '#reset-error', '#verify-error', '#terms-error'].forEach((id) => setError($(id), ''));
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

function setPending() {
  lsSet(K_PENDING, String(Date.now()));
}
function clearPending() {
  lsDel(K_PENDING);
}
function takePending() {
  const at = Number(lsGet(K_PENDING));
  clearPending();
  return Number.isFinite(at) && at > 0 && Date.now() - at < PENDING_MS;
}
function saveAcceptance(email) {
  lsSet(K_OK, JSON.stringify({ email: String(email || '').toLowerCase(), at: Date.now() }));
}
function hasRecentAcceptance(email) {
  try {
    const data = JSON.parse(lsGet(K_OK) || 'null');
    return Boolean(data) && data.email === String(email || '').toLowerCase() && Date.now() - Number(data.at) < ACCEPT_MS;
  } catch (_e) {
    return false;
  }
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

async function initAccount(accept) {
  const data = await api('/api/auth/init', { method: 'POST', body: { acceptTerms: accept === true }, retry: true });
  if (data.refreshToken && auth.currentUser) await auth.currentUser.getIdToken(true);
  return data;
}

async function createAccount(user) {
  try {
    return await initAccount(hasRecentAcceptance(user.email));
  } catch (err) {
    if (err && err.code === 'terms_required') return null;
    throw err;
  }
}

function fail(err) {
  $('#error-text').textContent = errorMessage(err);
  showAuthScreen('error');
}

async function routeUser(user) {
  const rid = ++routeId;
  stopVerifyPolling();
  stopTimers();

  if (!user) {
    session = null;
    showAuthScreen('auth');
    return;
  }

  if (takePending() && user.email) saveAcceptance(user.email);
  setSplash(true, '');

  if (!user.emailVerified) {
    try {
      await user.reload();
    } catch (_e) {
      /* hors ligne */
    }
    if (rid !== routeId) return;
  }

  if (!user.emailVerified) {
    $('#verify-email').textContent = user.email || '';
    showAuthScreen('verify');
    startVerifyPolling();
    return;
  }

  try {
    const result = await user.getIdTokenResult();
    if (result.claims.email_verified !== true) await user.getIdToken(true);
  } catch (_e) {
    /* hors ligne */
  }
  if (rid !== routeId) return;

  await enter(user, rid);
}

async function enter(user, rid) {
  const slow = setTimeout(() => setSplash(true, 'Le serveur se réveille, quelques secondes…'), 6000);
  let data = null;
  let offline = false;

  try {
    try {
      data = await loadAccount();
      writeCached(user.uid, data);
    } catch (err) {
      if (err && (err.status === 404 || err.code === 'no_subscription')) {
        data = await createAccount(user);
        if (data) writeCached(user.uid, data);
      } else if (err && (err.code === 'network' || err.code === 'timeout')) {
        const cached = readCached(user.uid);
        if (!cached) throw err;
        data = cached;
        offline = true;
      } else {
        throw err;
      }
    }
  } catch (err) {
    clearTimeout(slow);
    if (rid !== routeId) return;
    fail(err);
    return;
  }

  clearTimeout(slow);
  if (rid !== routeId) return;

  if (!data || (data.subscription && data.subscription.needsTerms)) {
    showAuthScreen('terms');
    return;
  }

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
  const tabName = ['history', 'finance', 'account'].includes(name) ? 'more' : name;
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
    await routeUser(auth.currentUser);
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
  stopVerifyPolling();
  store.reset();
  try {
    await logout();
  } catch (_e) {
    /* déjà déconnecté */
  }
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (_e) {
    /* cache déjà vide */
  }
  window.location.replace('app.html?mode=login');
}

async function doLogout() {
  const ok = await confirmDialog({
    title: 'Se déconnecter ?',
    text: 'Vos données restent enregistrées dans votre compte. Elles seront effacées de cet appareil.',
    ok: 'Se déconnecter'
  });
  if (ok) await hardLogout();
}

function startVerifyPolling() {
  stopVerifyPolling();
  verifyTimer = setInterval(async () => {
    if (document.hidden) return;
    try {
      if (await refreshVerification()) {
        stopVerifyPolling();
        routeUser(auth.currentUser);
      }
    } catch (_e) {
      return;
    }
  }, 5000);
}

function stopVerifyPolling() {
  clearInterval(verifyTimer);
  verifyTimer = 0;
}

function startCooldown(button, seconds) {
  clearInterval(resendTimer);
  resendUntil = Date.now() + seconds * 1000;
  button.disabled = true;
  const tick = () => {
    const left = Math.ceil((resendUntil - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(resendTimer);
      button.disabled = false;
      button.textContent = 'Renvoyer l’email';
      return;
    }
    button.textContent = 'Renvoyer l’email (' + left + ' s)';
  };
  tick();
  resendTimer = setInterval(tick, 1000);
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

function syncGate() {
  const blocked = mode === 'signup' && !$('#accept-terms').checked;
  $('#btn-submit').disabled = blocked;
  $('#btn-google').disabled = blocked;
}

function setMode(next) {
  mode = next === 'signup' ? 'signup' : 'login';
  const signup = mode === 'signup';
  $('#tab-login').setAttribute('aria-selected', String(!signup));
  $('#tab-signup').setAttribute('aria-selected', String(signup));
  $('#auth-title').textContent = signup ? 'Créez votre compte' : 'Bon retour';
  $('#auth-sub').textContent = signup
    ? 'Essai gratuit de 14 jours, sans carte bancaire.'
    : 'Connectez-vous pour retrouver votre boutique.';
  setHidden($('#field-name'), !signup);
  setHidden($('#terms-wrap'), !signup);
  setHidden($('#pw-hint'), !signup);
  setHidden($('#btn-forgot').parentElement, signup);
  $('#auth-password').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
  $('#btn-submit').textContent = signup ? 'Créer mon compte' : 'Se connecter';
  $('#btn-google-label').textContent = signup ? 'S’inscrire avec Google' : 'Continuer avec Google';
  setError($('#auth-error'), '');
  $('#terms-wrap').classList.remove('has-error');
  syncGate();
}

function wireAuth() {
  const accept = $('#accept-terms');
  const authError = $('#auth-error');
  const submit = $('#btn-submit');
  const google = $('#btn-google');

  $('#tab-login').addEventListener('click', () => setMode('login'));
  $('#tab-signup').addEventListener('click', () => setMode('signup'));
  accept.addEventListener('change', () => {
    $('#terms-wrap').classList.remove('has-error');
    setError(authError, '');
    syncGate();
  });

  google.addEventListener('click', async () => {
    setError(authError, '');
    if (mode === 'signup') {
      if (!accept.checked) {
        $('#terms-wrap').classList.add('has-error');
        setError(authError, 'Acceptez les conditions pour créer un compte.');
        return;
      }
      setPending();
    } else {
      clearPending();
    }
    setLoading(google, true);
    try {
      await signInGoogle();
    } catch (err) {
      clearPending();
      const code = err && err.code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        setError(authError, errorMessage(err));
      }
    } finally {
      setLoading(google, false);
      syncGate();
    }
  });

  $('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    setError(authError, '');
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    const name = $('#auth-name').value.trim();
    const signup = mode === 'signup';

    if (!EMAIL_RE.test(email)) return setError(authError, 'Adresse email invalide.');
    if (signup && name.length < 2) return setError(authError, 'Entrez votre nom ou le nom de votre boutique.');
    if (!password) return setError(authError, 'Entrez votre mot de passe.');
    if (signup && password.length < 8) return setError(authError, 'Mot de passe trop faible : 8 caractères minimum.');
    if (signup && !accept.checked) {
      $('#terms-wrap').classList.add('has-error');
      return setError(authError, 'Acceptez les conditions pour créer un compte.');
    }

    if (signup) setPending();
    else clearPending();
    setLoading(submit, true);
    try {
      if (signup) await signUpEmail(name, email, password);
      else await signInEmail(email, password);
    } catch (err) {
      clearPending();
      setError(authError, errorMessage(err));
    } finally {
      setLoading(submit, false);
      syncGate();
    }
  });

  $('#btn-forgot').addEventListener('click', () => {
    openPane('reset');
    $('#reset-email').value = $('#auth-email').value.trim();
  });
  $('#btn-reset-back').addEventListener('click', () => openPane('auth'));

  $('#reset-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('#reset-error');
    const button = $('#btn-reset');
    const email = $('#reset-email').value.trim();
    setError(error, '');
    if (!EMAIL_RE.test(email)) return setError(error, 'Adresse email invalide.');
    setLoading(button, true);
    try {
      await resetPassword(email);
      toast('Si un compte existe avec cet email, un lien vient d’être envoyé.', 'ok', 6000);
      openPane('auth');
    } catch (err) {
      if (err && err.code === 'auth/too-many-requests') setError(error, errorMessage(err));
      else {
        toast('Si un compte existe avec cet email, un lien vient d’être envoyé.', 'ok', 6000);
        openPane('auth');
      }
    } finally {
      setLoading(button, false);
    }
  });

  const verified = $('#btn-verified');
  verified.addEventListener('click', async () => {
    const error = $('#verify-error');
    setError(error, '');
    setLoading(verified, true);
    try {
      if (await refreshVerification()) {
        stopVerifyPolling();
        routeUser(auth.currentUser);
      } else {
        setError(error, 'Email pas encore confirmé. Ouvrez le lien reçu, puis réessayez.');
      }
    } catch (err) {
      setError(error, errorMessage(err));
    } finally {
      setLoading(verified, false);
    }
  });

  const resend = $('#btn-resend');
  resend.addEventListener('click', async () => {
    if (Date.now() < resendUntil) return;
    const error = $('#verify-error');
    setError(error, '');
    try {
      await resendVerification();
      toast('Email renvoyé.');
      startCooldown(resend, 60);
    } catch (err) {
      setError(error, errorMessage(err));
    }
  });

  $('#btn-verify-out').addEventListener('click', hardLogout);
  $('#btn-terms-out').addEventListener('click', hardLogout);
  $('#btn-error-out').addEventListener('click', hardLogout);
  $('#btn-retry').addEventListener('click', () => routeUser(auth.currentUser));

  const accept2 = $('#accept-terms2');
  accept2.addEventListener('change', () => {
    $('#terms2-wrap').classList.remove('has-error');
    setError($('#terms-error'), '');
  });

  const termsButton = $('#btn-terms');
  termsButton.addEventListener('click', async () => {
    const user = auth.currentUser;
    const error = $('#terms-error');
    if (!user) return routeUser(null);
    if (!accept2.checked) {
      $('#terms2-wrap').classList.add('has-error');
      return setError(error, 'Cochez la case pour continuer.');
    }
    setError(error, '');
    setLoading(termsButton, true);
    try {
      const data = await initAccount(true);
      saveAcceptance(user.email);
      writeCached(user.uid, data);
      finishEntry(user, data);
      afterBoot();
    } catch (err) {
      setError(error, errorMessage(err));
    } finally {
      setLoading(termsButton, false);
    }
  });
}

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
    if (Date.now() - lastRefresh > 5 * 60 * 1000) refreshAccount().catch(() => {});
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
      return;
    }
  });
}

function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

function boot() {
  initUI();
  watchNetwork();
  wireAuth();
  wireApp();
  registerWorker();
  setMode(startMode);
  finishRedirect();
  onUser((user) => {
    routeUser(user);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
