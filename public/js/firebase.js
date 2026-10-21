import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { FIREBASE_CONFIG, API_URL, APP_URL, LIMITS, BACKEND_READY } from './config.js';

export {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  writeBatch,
  serverTimestamp,
  onSnapshot,
  increment,
  Timestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
auth.languageCode = 'fr';

let firestore;
try {
  firestore = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (_err) {
  firestore = initializeFirestore(app, {});
}
export const db = firestore;

export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status || 0;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.requestTimeoutMs);
  try {
    const response = await fetch(API_URL + path, Object.assign({}, options, { signal: controller.signal }));
    const json = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError((json && json.error) || 'server_error', response.status);
    return json || {};
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err && err.name === 'AbortError') throw new ApiError('timeout', 0);
    throw new ApiError('network', 0);
  } finally {
    clearTimeout(timer);
  }
}

export async function api(path, opts) {
  const o = opts || {};
  if (!BACKEND_READY) throw new ApiError('backend_not_configured', 0);

  const headers = { Accept: 'application/json' };
  if (o.auth !== false) {
    const user = auth.currentUser;
    if (!user) throw new ApiError('unauthorized', 401);
    headers.Authorization = 'Bearer ' + (await user.getIdToken());
  }

  const init = { method: o.method || 'GET', headers, cache: 'no-store' };
  if (o.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(o.body);
  }

  const attempts = o.retry ? 2 : 1;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await request(path, init);
    } catch (err) {
      const transient = err instanceof ApiError && (err.code === 'timeout' || err.code === 'network' || err.status >= 502);
      if (i === attempts || !transient) throw err;
      await wait(2500);
    }
  }
  throw new ApiError('server_error', 0);
}

export function wakeBackend() {
  if (!BACKEND_READY) return;
  fetch(API_URL + '/health', { cache: 'no-store', mode: 'cors' }).catch(() => {});
}

export function onUser(callback) {
  return onAuthStateChanged(auth, callback);
}

export function currentUser() {
  return auth.currentUser;
}

export async function getClaims(force) {
  const user = auth.currentUser;
  if (!user) return {};
  const result = await user.getIdTokenResult(Boolean(force));
  return result.claims || {};
}

export async function isAdminSession() {
  const claims = await getClaims(false);
  return claims.admin === true;
}

const actionSettings = () => ({ url: APP_URL + '/app.html', handleCodeInApp: false });

export async function signUpEmail(name, email, password) {
  const cleanName = String(name || '').trim().slice(0, 60);
  const cleanEmail = String(email || '').trim();
  if (String(password || '').length < 8) throw Object.assign(new Error('weak'), { code: 'auth/weak-password' });
  const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
  if (cleanName) await updateProfile(cred.user, { displayName: cleanName });
  await sendEmailVerification(cred.user, actionSettings());
  return cred.user;
}

export async function signInEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, String(email || '').trim(), password);
  return cred.user;
}

export async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const cred = await signInWithPopup(auth, provider);
    return cred.user;
  } catch (err) {
    const code = err && err.code;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw err;
  }
}

export async function finishRedirect() {
  try {
    const result = await getRedirectResult(auth);
    return result ? result.user : null;
  } catch (_err) {
    return null;
  }
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, String(email || '').trim(), actionSettings());
}

export async function resendVerification() {
  const user = auth.currentUser;
  if (!user) throw new ApiError('unauthorized', 401);
  await sendEmailVerification(user, actionSettings());
}

export async function refreshVerification() {
  const user = auth.currentUser;
  if (!user) return false;
  await user.reload();
  if (user.emailVerified) await user.getIdToken(true);
  return user.emailVerified;
}

export async function logout() {
  await signOut(auth);
}

export async function completeLogin() {
  const user = auth.currentUser;
  if (!user) throw new ApiError('unauthorized', 401);
  if (!user.emailVerified) return { verified: false };

  const data = await api('/api/auth/init', { method: 'POST', body: {}, retry: true });
  if (data.refreshToken) await user.getIdToken(true);
  return { verified: true, isAdmin: data.isAdmin === true, subscription: data.subscription };
}

export async function loadAccount() {
  const data = await api('/api/auth/me', { retry: true });
  if (data.refreshToken && auth.currentUser) await auth.currentUser.getIdToken(true);
  return { isAdmin: data.isAdmin === true, subscription: data.subscription };
}

export const payments = Object.freeze({
  quote: (planId, country) => api('/api/payments/quote', { method: 'POST', body: { planId, country }, retry: true }),
  checkout: (planId, country) => api('/api/payments/checkout', { method: 'POST', body: { planId, country } }),
  status: (id) => api('/api/payments/status/' + encodeURIComponent(id), { retry: true })
});

export async function refreshAfterPayment(paymentId, tries) {
  const max = tries || 12;
  for (let i = 0; i < max; i += 1) {
    const state = await payments.status(paymentId);
    if (state.status === 'SUCCESS') {
      if (auth.currentUser) await auth.currentUser.getIdToken(true);
      return 'SUCCESS';
    }
    if (['FAILED', 'CANCELLED', 'REVIEW', 'DISMISSED'].includes(state.status)) return state.status;
    await wait(2500);
  }
  return 'PENDING';
}

const MESSAGES = {
  'auth/invalid-credential': 'Email ou mot de passe incorrect.',
  'auth/wrong-password': 'Email ou mot de passe incorrect.',
  'auth/user-not-found': 'Email ou mot de passe incorrect.',
  'auth/invalid-email': 'Adresse email invalide.',
  'auth/email-already-in-use': 'Cet email est déjà utilisé. Connectez-vous.',
  'auth/weak-password': 'Mot de passe trop faible : 8 caractères minimum.',
  'auth/too-many-requests': 'Trop de tentatives. Réessayez dans quelques minutes.',
  'auth/network-request-failed': 'Pas de connexion internet.',
  'auth/popup-closed-by-user': 'Connexion annulée.',
  'auth/cancelled-popup-request': 'Connexion annulée.',
  'auth/unauthorized-domain': 'Ce site n\'est pas autorisé dans Firebase.',
  'auth/user-disabled': 'Ce compte est désactivé.',
  'auth/requires-recent-login': 'Reconnectez-vous pour continuer.',
  email_not_verified: 'Confirmez d\'abord votre email.',
  email_required: 'Un email est nécessaire sur ce compte.',
  slow_down: 'Patientez quelques secondes avant de réessayer.',
  too_many_requests: 'Trop de demandes. Patientez un instant.',
  timeout: 'Le serveur met du temps à répondre. Réessayez.',
  network: 'Pas de connexion au serveur. Vérifiez votre internet.',
  unauthorized: 'Session expirée. Reconnectez-vous.',
  forbidden: 'Accès refusé.',
  payment_provider_error: 'Le paiement est momentanément indisponible. Réessayez.',
  downgrade_at_renewal: 'Le passage à une offre inférieure se fait au prochain renouvellement.',
  no_price: 'Cette offre n\'est pas disponible dans votre pays.',
  invalid: 'Demande invalide.',
  backend_not_configured: 'Le serveur n\'est pas configuré.',
  server_error: 'Erreur du serveur. Réessayez.'
};

export function errorMessage(err) {
  const code = err && err.code ? err.code : err && err.message;
  return MESSAGES[code] || 'Une erreur est survenue. Réessayez.';
}
