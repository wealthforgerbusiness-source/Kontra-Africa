import { auth, db } from './firebase-config.js';
import { requireAppAccess } from './auth-guard.js';
import { signOut } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { renderAppNav } from './app-nav.js';
import { buildCountryOptionsHtml, cleanPhoneDigits } from './phone-countries.js';

renderAppNav('profil'); // sidebar desktop + bottom nav mobile

const API_BASE = 'https://kontra-africa.onrender.com';
const CHECKOUT_TIMEOUT_MS = 60000; // le backend Render (plan gratuit) peut mettre jusqu'à ~50s à répondre après une inactivité (cold start)

// Clé localStorage : on garde la référence de la dernière tentative de
// paiement pour pouvoir la vérifier automatiquement au retour, sans rien
// demander à l'utilisateur (contrairement à l'ancienne clé de licence
// Chariow, qui lui était envoyée par email et qu'il devait recopier).
const PENDING_REFERENCE_STORAGE_KEY = 'kontra_pending_payment_reference';

// Délai avant d'abandonner l'attente automatique après un retour de
// paiement (?payment=success) et de proposer la vérification manuelle en
// secours. Couvre : le webhook SasPay qui peut mettre plusieurs secondes à
// arriver, ET un éventuel cold start de Render pendant que le webhook
// traite la requête côté serveur.
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

// Devise de paiement ($ USD / FC CDF) — voir /api/pricing et checkout.js
// pour l'explication complète du bug corrigé (prix affiché déconnecté du
// montant réellement facturé côté SasPay).
const resubscribeCurrencyToggle = document.getElementById('resubscribe-currency-toggle');
const resubscribeCurrencyUsdBtn = document.getElementById('resubscribeCurrencyUsd');
const resubscribeCurrencyCdfBtn = document.getElementById('resubscribeCurrencyCdf');
const resubscribePriceRow = document.getElementById('resubscribe-price');
const resubscribePriceSymbol = document.getElementById('resubscribePriceSymbol');
const resubscribePriceAmount = document.getElementById('resubscribePriceAmount');

let selectedCurrency = 'USD';
let pricingInfo = { priceUsd: 5, priceCdf: 11250 }; // valeurs de secours, écrasées par /api/pricing

function renderResubscribePrice() {
  if (!resubscribePriceSymbol || !resubscribePriceAmount) return;
  if (selectedCurrency === 'USD') {
    resubscribePriceSymbol.textContent = '$';
    resubscribePriceAmount.textContent = pricingInfo.priceUsd;
  } else {
    resubscribePriceSymbol.textContent = '';
    resubscribePriceAmount.textContent = `${pricingInfo.priceCdf.toLocaleString('fr-FR')} FC`;
  }
}

if (resubscribeCurrencyUsdBtn && resubscribeCurrencyCdfBtn) {
  resubscribeCurrencyUsdBtn.addEventListener('click', () => {
    selectedCurrency = 'USD';
    resubscribeCurrencyUsdBtn.classList.add('is-active');
    resubscribeCurrencyCdfBtn.classList.remove('is-active');
    renderResubscribePrice();
  });
  resubscribeCurrencyCdfBtn.addEventListener('click', () => {
    selectedCurrency = 'CDF';
    resubscribeCurrencyCdfBtn.classList.add('is-active');
    resubscribeCurrencyUsdBtn.classList.remove('is-active');
    renderResubscribePrice();
  });
}

fetch(`${API_BASE}/api/pricing`)
  .then((r) => r.json())
  .then((data) => {
    if (data && data.success) {
      pricingInfo = { priceUsd: data.priceUsd, priceCdf: data.priceCdf };
      renderResubscribePrice();
    }
  })
  .catch(() => { /* on garde les valeurs de secours */ });

// Filet de secours : remplace l'ancienne saisie manuelle de clé de licence.
// Même structure HTML que l'ancien license-key-row, juste des id différents
// (voir profil.html) — pas d'input texte requis, juste un bouton.
const verifyPaymentRow = document.getElementById('payment-reference-row');
const btnVerifyPayment = document.getElementById('btn-verify-payment');

if (resubscribeCountry) {
  resubscribeCountry.innerHTML = buildCountryOptionsHtml();
}

const btnLogout = document.getElementById('btn-logout');

let currentUser = null;

// ---------- Retour de paiement SasPay (?payment=success) ----------
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
      "Ça prend plus de temps que prévu. Tu peux vérifier ton paiement manuellement ci-dessous.";
    // On force l'affichage du bouton de vérification même si le statut
    // Firestore n'est pas encore "expired"/"cancelled" (cas normal ici : il
    // est probablement encore "trial" ou l'ancien statut expiré), car
    // renderSubscriptionStatus() ne le révèle pas dans ce cas.
    if (verifyPaymentRow) verifyPaymentRow.hidden = false;
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
  clearStoredReference();
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
  if (resubscribeCurrencyToggle) resubscribeCurrencyToggle.hidden = true;
  if (resubscribePriceRow) resubscribePriceRow.hidden = true;
  // Ne pas re-masquer verifyPaymentRow s'il vient d'être révélé par le
  // fallback "ça prend plus de temps que prévu" ci-dessus, tant qu'on
  // attend encore une activation.
  if (verifyPaymentRow && !awaitingPaymentActivation) verifyPaymentRow.hidden = true;
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
    if (resubscribeCurrencyToggle) resubscribeCurrencyToggle.hidden = false;
    if (resubscribePriceRow) { resubscribePriceRow.hidden = false; renderResubscribePrice(); }
    // Filet de secours : si le paiement a réussi côté opérateur mais que le
    // webhook SasPay n'est jamais arrivé, et qu'on a encore une référence
    // de paiement en attente en local, on propose la vérification manuelle.
    if (verifyPaymentRow && getStoredReference()) verifyPaymentRow.hidden = false;
  } else {
    subscriptionMessage.textContent = 'Statut d’abonnement inconnu.';
  }
}

function formatDate(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date ? date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : null;
}

// ---------- Stockage local de la référence de paiement en cours ----------
function storeReference(reference) {
  try {
    localStorage.setItem(PENDING_REFERENCE_STORAGE_KEY, reference);
  } catch (_) { /* stockage indisponible, tant pis — le webhook reste la voie principale */ }
}

function getStoredReference() {
  try {
    return localStorage.getItem(PENDING_REFERENCE_STORAGE_KEY);
  } catch (_) {
    return null;
  }
}

function clearStoredReference() {
  try {
    localStorage.removeItem(PENDING_REFERENCE_STORAGE_KEY);
  } catch (_) { /* rien à faire */ }
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
        phone: { number: phoneNumber, countryCode },
        currency: selectedCurrency
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || body.message || "Impossible de lancer le paiement.");
    }

    const result = await res.json();

    if (result.checkoutUrl) {
      // On garde la référence en local pour pouvoir vérifier le paiement
      // nous-mêmes au retour, si le webhook n'est jamais arrivé.
      if (result.reference) storeReference(result.reference);
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

// ---------- Vérification manuelle du paiement (filet de secours) ----------
if (btnVerifyPayment) {
  btnVerifyPayment.addEventListener('click', handleVerifyPayment);
}

async function handleVerifyPayment() {
  if (!currentUser) return;
  subscriptionError.hidden = true;

  const reference = getStoredReference();

  if (!reference) {
    subscriptionError.textContent = "Aucun paiement récent à vérifier. Relance un abonnement d'abord.";
    subscriptionError.hidden = false;
    return;
  }

  btnVerifyPayment.disabled = true;
  const originalLabel = btnVerifyPayment.textContent;
  btnVerifyPayment.textContent = 'Vérification…';

  try {
    const idToken = await currentUser.getIdToken();
    const res = await fetch(`${API_BASE}/api/verify-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ reference }),
    });

    const result = await res.json().catch(() => ({}));

    if (!res.ok || !result.verified) {
      throw new Error(result.error || result.message || "Aucun paiement confirmé trouvé pour l'instant.");
    }

    // La confirmation visuelle vient du onSnapshot (subscriptionStatus
    // passe à "active" en direct) — resolvePaymentPendingUI() s'en charge
    // déjà, y compris le nettoyage de la référence stockée.
  } catch (error) {
    subscriptionError.textContent = error.message || "Erreur lors de la vérification du paiement.";
    subscriptionError.hidden = false;
  } finally {
    btnVerifyPayment.disabled = false;
    btnVerifyPayment.textContent = originalLabel;
  }
}

// ---------- Déconnexion ----------
btnLogout.addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = '/login.html';
});
