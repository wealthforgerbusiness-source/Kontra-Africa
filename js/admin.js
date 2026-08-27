/* ==========================================================================
   Kontra-Africa — Panneau Admin
   Connexion Google intégrée (réservée à un seul email), statistiques
   utilisateurs, gains réels, conversion USD ⇄ FC.
   ========================================================================== */

import { auth, db, googleProvider } from '/js/firebase-config.js';
import {
  onAuthStateChanged,
  signOut,
  signInWithPopup,
  signInWithRedirect,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

// Seul ce compte Google a le droit d'accéder au panneau admin.
// Rappel : la vraie sécurité doit AUSSI être appliquée côté règles Firestore
// (voir firestore.rules.admin-a-fusionner.txt), sinon cette vérification
// côté client seule n'empêche pas quelqu'un de lire les données autrement.
const ADMIN_EMAIL = 'optisitedigital@gmail.com';

const SUBSCRIPTION_PRICE_USD = 5;
const CHARIOW_FEE_RATE = 0.15; // Chariow prend 15% par abonnement
const DEFAULT_EXCHANGE_RATE = 2250; // 1 $ = 2250 FC par défaut

// ---------- État ----------
let allUsers = [];
let exchangeRate = DEFAULT_EXCHANGE_RATE;
let viewCurrency = 'USD'; // 'USD' ou 'FC'

// ---------- Éléments DOM : écrans ----------
const loadingScreen = document.getElementById('adminLoadingScreen');
const loginScreen = document.getElementById('adminLoginScreen');
const deniedScreen = document.getElementById('adminDeniedScreen');
const shell = document.getElementById('adminShell');

const adminGoogleBtn = document.getElementById('adminGoogleBtn');
const adminLoginError = document.getElementById('adminLoginError');
const deniedEmail = document.getElementById('deniedEmail');
const btnDeniedLogout = document.getElementById('btnDeniedLogout');

const errorBanner = document.getElementById('adminErrorBanner');

const statTotalUsers = document.getElementById('statTotalUsers');
const statActiveUsers = document.getElementById('statActiveUsers');
const statTrialUsers = document.getElementById('statTrialUsers');
const statInactiveUsers = document.getElementById('statInactiveUsers');

const revenueNetValue = document.getElementById('revenueNetValue');
const revenueNetValueSmall = document.getElementById('revenueNetValueSmall');
const revenueGrossValue = document.getElementById('revenueGrossValue');
const revenueChariowCut = document.getElementById('revenueChariowCut');
const revenueActiveCount = document.getElementById('revenueActiveCount');
const btnToggleCurrency = document.getElementById('btnToggleCurrency');
const btnToggleCurrencyLabel = document.getElementById('btnToggleCurrencyLabel');

const formExchangeRate = document.getElementById('formExchangeRate');
const inputExchangeRate = document.getElementById('inputExchangeRate');
const exchangeRateMsg = document.getElementById('exchangeRateMsg');

const userSearchInput = document.getElementById('userSearchInput');
const usersTableBody = document.getElementById('usersTableBody');
const usersTableEmpty = document.getElementById('usersTableEmpty');

const btnRefresh = document.getElementById('btnRefresh');
const btnLogout = document.getElementById('btnLogout');

function hideAllScreens() {
  loadingScreen.hidden = true;
  loginScreen.hidden = true;
  deniedScreen.hidden = true;
  shell.hidden = true;
}

// ---------- Garde d'accès ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    hideAllScreens();
    loginScreen.hidden = false;
    return;
  }

  if (!user.email || user.email.toLowerCase() !== ADMIN_EMAIL) {
    hideAllScreens();
    deniedScreen.hidden = false;
    deniedEmail.textContent = user.email || 'compte inconnu';
    return;
  }

  // Bon compte : on charge le tableau de bord.
  hideAllScreens();
  loadingScreen.hidden = false;

  try {
    await loadExchangeRate();
    await loadUsers();
    hideAllScreens();
    shell.hidden = false;
  } catch (err) {
    console.error('Erreur de chargement admin :', err);
    hideAllScreens();
    shell.hidden = false;
    showErrorBanner(
      "Impossible de charger les données. Vérifiez les règles Firestore " +
      "(l'admin doit avoir le droit de lire la collection 'users' et le document 'admin_settings/global')."
    );
  }
});

// ---------- Connexion Google (bouton sur l'écran de login) ----------
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

adminGoogleBtn.addEventListener('click', async () => {
  adminLoginError.hidden = true;
  try {
    if (isMobile) {
      await signInWithRedirect(auth, googleProvider);
      return;
    }
    await signInWithPopup(auth, googleProvider);
    // onAuthStateChanged prend le relais automatiquement.
  } catch (err) {
    console.error('Erreur de connexion Google :', err);
    adminLoginError.textContent = "La connexion avec Google a échoué. Réessayez.";
    adminLoginError.hidden = false;
  }
});

btnDeniedLogout.addEventListener('click', async () => {
  await signOut(auth);
});

function showErrorBanner(message) {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
}

// ---------- Chargement du taux de change ----------
async function loadExchangeRate() {
  const settingsRef = doc(db, 'admin_settings', 'global');
  const settingsSnap = await getDoc(settingsRef);

  if (settingsSnap.exists() && typeof settingsSnap.data().usdToFcRate === 'number') {
    exchangeRate = settingsSnap.data().usdToFcRate;
  } else {
    // Première utilisation : on initialise le document avec le taux par défaut.
    exchangeRate = DEFAULT_EXCHANGE_RATE;
    await setDoc(settingsRef, {
      usdToFcRate: exchangeRate,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  inputExchangeRate.value = exchangeRate;
}

// ---------- Chargement des utilisateurs ----------
async function loadUsers() {
  const usersSnap = await getDocs(collection(db, 'users'));
  allUsers = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderAll();
}

// ---------- Rendu global ----------
function renderAll() {
  renderStats();
  renderRevenue();
  renderUsersTable(userSearchInput.value.trim());
}

function renderStats() {
  const total = allUsers.length;
  const active = allUsers.filter((u) => u.subscriptionStatus === 'active').length;
  const trial = allUsers.filter((u) => u.subscriptionStatus === 'trial').length;
  const inactive = allUsers.filter(
    (u) => u.subscriptionStatus === 'expired' || u.subscriptionStatus === 'cancelled'
  ).length;

  statTotalUsers.textContent = total.toLocaleString('fr-FR');
  statActiveUsers.textContent = active.toLocaleString('fr-FR');
  statTrialUsers.textContent = trial.toLocaleString('fr-FR');
  statInactiveUsers.textContent = inactive.toLocaleString('fr-FR');
}

function renderRevenue() {
  const activeCount = allUsers.filter((u) => u.subscriptionStatus === 'active').length;
  const grossUSD = activeCount * SUBSCRIPTION_PRICE_USD;
  const chariowCutUSD = grossUSD * CHARIOW_FEE_RATE;
  const netUSD = grossUSD - chariowCutUSD; // = activeCount * 4.25 $

  revenueActiveCount.textContent = activeCount.toLocaleString('fr-FR');
  revenueGrossValue.textContent = formatMoney(grossUSD);
  revenueChariowCut.textContent = `- ${formatMoney(chariowCutUSD)}`;
  revenueNetValue.textContent = formatMoney(netUSD);
  revenueNetValueSmall.textContent = formatMoney(netUSD);

  btnToggleCurrencyLabel.textContent =
    viewCurrency === 'USD' ? 'Voir en Franc Congolais' : 'Voir en Dollars';
}

// ---------- Conversion / formatage ----------
function formatMoney(amountUSD) {
  if (viewCurrency === 'USD') {
    return `$ ${amountUSD.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;
  }
  const amountFC = amountUSD * exchangeRate;
  return `${amountFC.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FC`;
}

btnToggleCurrency.addEventListener('click', () => {
  viewCurrency = viewCurrency === 'USD' ? 'FC' : 'USD';
  renderRevenue();
});

// ---------- Enregistrement du taux de change ----------
formExchangeRate.addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = Number(inputExchangeRate.value);

  if (!value || value <= 0) {
    exchangeRateMsg.textContent = 'Merci de saisir un taux valide.';
    exchangeRateMsg.style.color = 'var(--color-error)';
    exchangeRateMsg.hidden = false;
    return;
  }

  try {
    await setDoc(doc(db, 'admin_settings', 'global'), {
      usdToFcRate: value,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    exchangeRate = value;
    exchangeRateMsg.textContent = `Taux enregistré : 1 $ = ${value.toLocaleString('fr-FR')} FC`;
    exchangeRateMsg.style.color = 'var(--color-success)';
    exchangeRateMsg.hidden = false;
    renderRevenue();
  } catch (err) {
    console.error('Erreur d\'enregistrement du taux :', err);
    exchangeRateMsg.textContent = "Impossible d'enregistrer le taux. Réessayez.";
    exchangeRateMsg.style.color = 'var(--color-error)';
    exchangeRateMsg.hidden = false;
  }
});

// ---------- Tableau des utilisateurs ----------
const STATUS_LABELS = {
  active: { label: 'Payant', className: 'badge--success' },
  trial: { label: 'Essai', className: 'badge--warning' },
  expired: { label: 'Expiré', className: 'badge--muted' },
  cancelled: { label: 'Annulé', className: 'badge--muted' },
};

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value) {
  const d = toDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderUsersTable(searchTerm = '') {
  const term = searchTerm.toLowerCase();

  const filtered = allUsers
    .filter((u) => !term || (u.email || '').toLowerCase().includes(term))
    .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));

  usersTableBody.innerHTML = '';

  if (filtered.length === 0) {
    usersTableEmpty.hidden = false;
    return;
  }
  usersTableEmpty.hidden = true;

  for (const u of filtered) {
    const statusInfo = STATUS_LABELS[u.subscriptionStatus] || { label: u.subscriptionStatus || '—', className: 'badge--muted' };
    const endDate = u.subscriptionStatus === 'trial' ? u.trialEndDate : u.subscriptionExpiresAt;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(u.email || '—')}</td>
      <td><span class="badge ${statusInfo.className}">${escapeHtml(statusInfo.label)}</span></td>
      <td>${formatDate(u.createdAt)}</td>
      <td>${formatDate(endDate)}</td>
    `;
    usersTableBody.appendChild(tr);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

userSearchInput.addEventListener('input', () => {
  renderUsersTable(userSearchInput.value.trim());
});

// ---------- Actions ----------
btnRefresh.addEventListener('click', async () => {
  btnRefresh.disabled = true;
  try {
    await loadUsers();
  } catch (err) {
    console.error('Erreur de rafraîchissement :', err);
    showErrorBanner("Impossible de rafraîchir les données. Réessayez.");
  } finally {
    btnRefresh.disabled = false;
  }
});

btnLogout.addEventListener('click', async () => {
  await signOut(auth);
});
