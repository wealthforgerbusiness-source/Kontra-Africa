import {
  auth,
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
import { $, h, getParam, toast, setLoading, initUI, watchNetwork } from './ui.js';

const PLAN_IDS = ['starter', 'business', 'pro'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PANES = ['auth', 'reset', 'verify', 'terms', 'error'];
const K_PENDING = 'kontra_terms_pending';
const K_OK = 'kontra_terms_ok';
const K_PLAN = 'kontra_plan';
const PENDING_MS = 5 * 60 * 1000;
const ACCEPT_MS = 3 * 24 * 60 * 60 * 1000;

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

const startMode = getParam('mode') === 'signup' ? 'signup' : 'login';
const planParam = getParam('plan');
if (PLAN_IDS.includes(planParam)) lsSet(K_PLAN, planParam);
if (window.location.search) history.replaceState(null, '', window.location.pathname);

let mode = 'login';
let routeId = 0;
let verifyTimer = 0;
let resendTimer = 0;
let resendUntil = 0;

function setHidden(node, hidden) {
  if (node) node.classList.toggle('hide', Boolean(hidden));
}

function setError(node, message) {
  if (!node) return;
  node.textContent = message || '';
  setHidden(node, !message);
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
  setHidden($('#auth'), false);
  document.body.classList.add('is-auth');
  openPane(pane);
}

function goApp() {
  window.location.replace('app.html');
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

function hasCachedAccount(uid) {
  try {
    const data = JSON.parse(lsGet('kontra_acct_' + uid) || 'null');
    return Boolean(data && data.subscription);
  } catch (_e) {
    return false;
  }
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
  console.error('Connexion impossible:', err);
  $('#error-text').textContent = errorMessage(err);
  const code = err && err.code ? String(err.code) : err && err.message ? String(err.message) : '';
  const status = err && err.status ? ' · HTTP ' + err.status : '';
  const line = $('#error-code');
  line.textContent = code ? 'Code technique : ' + code + status : '';
  setHidden(line, !code);
  showAuthScreen('error');
}

async function enter(user, rid) {
  const slow = setTimeout(() => setSplash(true, 'Le serveur se réveille, quelques secondes…'), 6000);
  let data = null;

  try {
    try {
      data = await loadAccount();
    } catch (err) {
      if (err && (err.status === 404 || err.code === 'no_subscription')) {
        data = await createAccount(user);
      } else if (err && (err.code === 'network' || err.code === 'timeout') && hasCachedAccount(user.uid)) {
        clearTimeout(slow);
        goApp();
        return;
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
  goApp();
}

async function routeUser(user) {
  const rid = ++routeId;
  stopVerifyPolling();

  if (!user) {
    showAuthScreen('auth');
    return;
  }

  if (takePending() && user.email) saveAcceptance(user.email);
  setSplash(true, '');

  if (!user.emailVerified) {
    try {
      await user.reload();
    } catch (_e) {
      lsGet('kontra_noop');
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
    lsGet('kontra_noop');
  }
  if (rid !== routeId) return;

  await enter(user, rid);
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

async function signOutNow() {
  stopVerifyPolling();
  clearPending();
  try {
    await logout();
  } catch (_e) {
    return;
  }
}

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

  $('#btn-verify-out').addEventListener('click', signOutNow);
  $('#btn-terms-out').addEventListener('click', signOutNow);
  $('#btn-error-out').addEventListener('click', signOutNow);
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
      await initAccount(true);
      saveAcceptance(user.email);
      goApp();
    } catch (err) {
      setError(error, errorMessage(err));
      setLoading(termsButton, false);
    }
  });
}

function boot() {
  initUI();
  watchNetwork();
  wireAuth();
  setMode(startMode);
  finishRedirect();
  onUser((user) => {
    routeUser(user);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
