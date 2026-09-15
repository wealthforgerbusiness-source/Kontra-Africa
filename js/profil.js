import { auth, db } from './firebase-config.js';
import { requireAppAccess } from './auth-guard.js';
import { signOut } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { renderAppNav } from './app-nav.js';
import { buildCountryOptionsHtml, cleanPhoneDigits } from './phone-countries.js';

renderAppNav('profil'); // sidebar desktop + bottom nav mobile

const API_BASE = 'https://kontra-africa.onrender.com';
const CHECKOUT_TIMEOUT_MS = 60000; // le backend Render (plan gratuit) peut mettre jusqu'à ~50s à répondre après une inactivité (cold start)

// Délai avant d'abandonner l'attente automatique après un retour de
// paiement (?payment=success) et de proposer la saisie manuelle de la clé
// en secours. Couvre : le webhook Chariow qui peut mettre plusieurs
// secondes à arriver, ET un éventuel cold start de Render pendant que le
// webhook traite la requête côté serveur.
const PAYMENT_RETURN_TIMEOUT_MS = 45000;

// ---------- Éléments DOM ----------
const profilePhoto = document.getElementById('profile-photo');
const profileName = document.getElementById('profile-name');
const profileEmail = document.getElementById('profile-email');

const paymentPendingBanner = document.getElementById('payment-pending-banner');
const paymentPendingText = document.getElementById('payment-pending-text');

const subscriptionMessage = document.getElementById('subscription-message');
const btnResubscribe = document.getElementById('btn-resubscribe');
const subscriptionError = document.getElementById('subscription-error');
const resubscribePhoneRow = document.getElementById('resubscribe-phone-row');
const resubscribeCountry = document.getElementById('resubscribe-country');
const resubscribePhone = document.getElementById('resubscribe-phone');
const licenseKeyRow = document.getElementById('license-key-row');
const licenseKeyInput = document.getElementById('license-key-input');
const btnVerifyLicense = document.getElementById('btn-verify-license');

if (resubscribeCountry) {
  resubscribeCountry.innerHTML = buildCountryOptionsHtml();
}

const btnLogout = document.getElementById('btn-logout');

let currentUser = null;

// ---------- Retour de paiement Chariow (?payment=success) ----------
// IMPORTANT : ce paramètre d'URL n'est qu'un signal d'affichage. N'importe
// qui peut le taper dans la barre d'adresse sans avoir payé — il ne
// débloque JAMAIS rien par lui-même. La seule source de vérité pour
// activer un compte est le champ subscriptionStatus dans Firestore, écrit
// par le webhook côté serveur (functions/src/webhook.js). Ce bloc se
// contente d'attendre, en lecture seule, que ce champ passe à "active" via
// le même onSnapshot temps réel que listenToSubscription() utilise déjà.
let paymentReturnTimeoutId = null;
let awaitingPaymentActivation = false;

function isReturningFromPayment() {
  const params = new URLSearchParams(window.location.search);
  return params.get('payment') === 'success';
}

function startPaymentPendingUI() {
  awaitingPaymentActivation = true;

  // Nettoie l'URL tout de suite : un refresh de page ne doit pas relancer
  // le bandeau indéfiniment.
  const cleanUrl = window.location.pathname + window.location.hash;
  window.history.replaceState({}, document.title, cleanUrl);

  if (!paymentPendingBanner) return;
  paymentPendingText.textContent = 'Paiement reçu, activation de ton abonnement en cours…';
  paymentPendingBanner.hidden = false;

  paymentReturnTimeoutId = setTimeout(() => {
    if (!awaitingPaymentActivation) return; // déjà résolu entre-temps
    paymentPendingText.textContent =
      "Ça prend plus de temps que prévu. Si tu as reçu ta clé de licence par email, tu peux l'activer directement ci-dessous.";
    // On force l'affichage du champ clé même si le statut Firestore
    // n'est pas encore "expired"/"cancelled" (cas normal ici : il est
    // probablement encore "trial" ou l'ancien statut expiré), car
    // renderSubscriptionStatus() ne le révèle pas dans ce cas.
    if (licenseKeyRow) licenseKeyRow.hidden = false;
  }, PAYMENT_RETURN_TIMEOUT_MS);
}

function resolvePaymentPendingUI() {
  if (!awaitingPaymentActivation) return;
  awaitingPaymentActivation = false;
  if (paymentReturnTimeoutId) {
    clearTimeout(paymentReturnTimeoutId);
    paymentReturnTimeoutId = null;
  }
  if (paymentPendingBanner) paymentPendingBanner.hidden = true;
}

// ---------- Auth + garde d'accès (paywall si essai/abonnement terminé) ----------
async function init() {
  const session = await requireAppAccess();
  if (!session) return; // redirection vers /login.html ou paywall déjà affiché

  currentUser = session.user;
  renderIdentity(session.user);

  if (isReturningFromPayment()) {
    startPaymentPendingUI();
  }

  listenToSubscription(session.user.uid);
}

init();

function renderIdentity(user) {
  profilePhoto.src = user.photoURL || '/icons/icon-192.png';
  profilePhoto.alt = user.displayName ? `Photo de ${user.displayName}` : '';
  profileName.textContent = user.displayName || 'Utilisateur';
  profileEmail.textContent = user.email || '';
}

// ---------- Statut abonnement ----------
function listenToSubscription(uid) {
  onSnapshot(doc(db, 'users', uid), (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    // Dès que le webhook a fait son travail (statut actif), on referme le
    // bandeau d'attente, quel que soit son état (banner normal ou message
    // "ça prend plus de temps").
    if (data.subscriptionStatus === 'active') {
      resolvePaymentPendingUI();
    }
    renderSubscriptionStatus(data);
  });
}

function renderSubscriptionStatus(data) {
  const status = data.subscriptionStatus;
  subscriptionMessage.classList.remove('status-trial', 'status-active', 'status-expired');
  btnResubscribe.hidden = true;
  if (resubscribePhoneRow) resubscribePhoneRow.hidden = true;
  // Ne pas re-masquer licenseKeyRow s'il vient d'être révélé par le
  // fallback "ça prend plus de temps que prévu" ci-dessus, tant qu'on
  // attend encore une activation.
  if (licenseKeyRow && !awaitingPaymentActivation) licenseKeyRow.hidden = true;
  subscriptionError.hidden = true;

  if (status === 'trial') {
    const date = formatDate(data.trialEndDate);
    subscriptionMessage.textContent = date
      ? `Essai gratuit — expire le ${date}`
      : 'Essai gratuit en cours';
    subscriptionMessage.classList.add('status-trial');
  } else if (status === 'active') {
    const date = formatDate(data.subscriptionExpiresAt);
    subscriptionMessage.textContent = date
      ? `Abonnement actif — prochain renouvellement le ${date}`
      : 'Abonnement actif';
    subscriptionMessage.classList.add('status-active');
  } else if (status === 'expired' || status === 'cancelled') {
    subscriptionMessage.textContent = 'Abonnement expiré';
    subscriptionMessage.classList.add('status-expired');
    btnResubscribe.hidden = false;
    if (resubscribePhoneRow) resubscribePhoneRow.hidden = false;
    // Filet de secours : si le paiement a réussi côté opérateur mais que le
    // webhook Chariow n'est jamais arrivé, l'utilisateur peut débloquer son
    // compte lui-même avec la clé de licence reçue après paiement.
    if (licenseKeyRow) licenseKeyRow.hidden = false;
  } else {
    subscriptionMessage.textContent = 'Statut d’abonnement inconnu.';
  }
}

function formatDate(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date ? date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : null;
}

// ---------- Réabonnement ----------
btnResubscribe.addEventListener('click', handleResubscribe);

async function handleResubscribe() {
  if (!currentUser) return;
  subscriptionError.hidden = true;

  const phoneNumber = cleanPhoneDigits(resubscribePhone ? resubscribePhone.value : '');
  const countryCode = resubscribeCountry ? resubscribeCountry.value : 'CD';

  if (phoneNumber.length < 8) {
    subscriptionError.textContent = 'Entrez un numéro Mobile Money valide pour continuer.';
    subscriptionError.hidden = false;
    return;
  }

  btnResubscribe.disabled = true;
  btnResubscribe.textContent = 'Redirection en cours…';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHECKOUT_TIMEOUT_MS);

  try {
    const idToken = await currentUser.getIdToken();
    const res = await fetch(`${API_BASE}/api/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        firstName: currentUser.displayName ? currentUser.displayName.split(' ')[0] : 'Client',
        lastName: currentUser.displayName ? currentUser.displayName.split(' ').slice(1).join(' ') || 'Inconnu' : 'Inconnu',
        phone: { number: phoneNumber, countryCode }
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || body.message || "Impossible de lancer le paiement.");
    }

    const result = await res.json();

    if (result.checkoutUrl) {
      window.location.href = result.checkoutUrl;
      return;
    }

    throw new Error("Réponse inattendue du serveur de paiement.");
  } catch (error) {
    subscriptionError.textContent =
      error.name === 'AbortError'
        ? 'Le serveur met trop de temps à répondre. Réessaie dans quelques instants.'
        : (error.message || "Erreur lors du lancement du paiement.");
    subscriptionError.hidden = false;
  } finally {
    clearTimeout(timeoutId);
    btnResubscribe.disabled = false;
    btnResubscribe.textContent = 'Se réabonner';
  }
}

// ---------- Vérification manuelle de la clé de licence ----------
if (btnVerifyLicense) {
  btnVerifyLicense.addEventListener('click', handleVerifyLicense);
}

async function handleVerifyLicense() {
  if (!currentUser || !licenseKeyInput) return;
  subscriptionError.hidden = true;

  const key = licenseKeyInput.value.trim();

  if (!key) {
    subscriptionError.textContent = 'Entre ta clé de licence pour continuer.';
    subscriptionError.hidden = false;
    return;
  }

  btnVerifyLicense.disabled = true;
  const originalLabel = btnVerifyLicense.textContent;
  btnVerifyLicense.textContent = 'Vérification…';

  try {
    const idToken = await currentUser.getIdToken();
    const res = await fetch(`${API_BASE}/api/verify-license`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ licenseKey: key }),
    });

    const result = await res.json().catch(() => ({}));

    if (!res.ok || !result.valid) {
      throw new Error(result.error || "Clé de licence invalide.");
    }

    // La confirmation visuelle vient du onSnapshot (subscriptionStatus
    // passe à "active" en direct) — resolvePaymentPendingUI() s'en charge
    // déjà si on était en attente après un paiement.
    licenseKeyInput.value = '';
  } catch (error) {
    subscriptionError.textContent = error.message || "Erreur lors de la vérification de la clé.";
    subscriptionError.hidden = false;
  } finally {
    btnVerifyLicense.disabled = false;
    btnVerifyLicense.textContent = originalLabel;
  }
}

// ---------- Déconnexion ----------
btnLogout.addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = '/login.html';
});
