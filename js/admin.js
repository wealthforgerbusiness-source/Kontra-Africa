/* ==========================================================================
   Kontra-Africa — Panneau Admin
   Connexion Google intégrée, statistiques utilisateurs,
   gains réels, conversion USD ⇄ FC.
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

// ---------------------------------------------------------------------------
// CONFIGURATION ADMIN
// ---------------------------------------------------------------------------

// IMPORTANT : cette vérification côté client n'est PAS la sécurité principale.
// Les règles Firestore doivent également empêcher les autres utilisateurs
// d'accéder aux données administratives.
const ADMIN_EMAIL = 'optisitedigital@gmail.com';

// Normalisation pour éviter les problèmes de casse.
const NORMALIZED_ADMIN_EMAIL = ADMIN_EMAIL.trim().toLowerCase();

const SUBSCRIPTION_PRICE_USD = 5;
const CHARIOW_FEE_RATE = 0.15;
const DEFAULT_EXCHANGE_RATE = 2250;

// Protection contre les rafraîchissements répétés.
// Cela évite qu'un double-clic ou un script déclenche trop de lectures.
const REFRESH_COOLDOWN_MS = 5000;

let allUsers = [];
let exchangeRate = DEFAULT_EXCHANGE_RATE;
let viewCurrency = 'USD';

let isLoadingUsers = false;
let lastUsersLoadAt = 0;

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
const btnToggleCurrencyLabel = document.getElementById('btnToggleCurrency');

const formExchangeRate = document.getElementById('formExchangeRate');
const inputExchangeRate = document.getElementById('inputExchangeRate');
const exchangeRateMsg = document.getElementById('exchangeRateMsg');

const userSearchInput = document.getElementById('userSearchInput');
const usersTableBody = document.getElementById('usersTableBody');
const usersTableEmpty = document.getElementById('usersTableEmpty');

const btnRefresh = document.getElementById('btnRefresh');
const btnLogout = document.getElementById('btnLogout');

// ---------------------------------------------------------------------------
// UTILITAIRES DE SÉCURITÉ
// ---------------------------------------------------------------------------

function isAdminUser(user) {
  if (!user || typeof user.email !== 'string') {
    return false;
  }

  return user.email.trim().toLowerCase() === NORMALIZED_ADMIN_EMAIL;
}

function hideAllScreens() {
  loadingScreen.hidden = true;
  loginScreen.hidden = true;
  deniedScreen.hidden = true;
  shell.hidden = true;
}

function showErrorBanner(message) {
  errorBanner.textContent = String(message);
  errorBanner.hidden = false;
}

function hideErrorBanner() {
  errorBanner.hidden = true;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// GARDE D'ACCÈS ADMIN
// ---------------------------------------------------------------------------

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    hideAllScreens();
    loginScreen.hidden = false;
    return;
  }

  // Refus immédiat si ce n'est pas le compte administrateur.
  if (!isAdminUser(user)) {
    hideAllScreens();

    deniedScreen.hidden = false;

    // Ne jamais injecter directement l'email dans innerHTML.
    deniedEmail.textContent = user.email || 'compte inconnu';

    return;
  }

  // Utilisateur autorisé.
  hideAllScreens();
  loadingScreen.hidden = false;
  hideErrorBanner();

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
      "(l'admin doit avoir le droit de lire la collection 'users' et " +
      "le document 'admin_settings/global')."
    );
  }
});

// ---------------------------------------------------------------------------
// CONNEXION GOOGLE
// ---------------------------------------------------------------------------

const isMobile = /Android|iPhone|iPad|iPod/i.test(
  navigator.userAgent || ''
);

adminGoogleBtn.addEventListener('click', async () => {
  adminLoginError.hidden = true;

  try {
    if (isMobile) {
      await signInWithRedirect(auth, googleProvider);
      return;
    }

    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    console.error('Erreur de connexion Google :', err);

    adminLoginError.textContent =
      'La connexion avec Google a échoué. Réessayez.';

    adminLoginError.hidden = false;
  }
});

btnDeniedLogout.addEventListener('click', async () => {
  try {
    await signOut(auth);
  } catch (err) {
    console.error('Erreur de déconnexion :', err);
  }
});

// ---------------------------------------------------------------------------
// TAUX DE CHANGE
// ---------------------------------------------------------------------------

async function loadExchangeRate() {
  const settingsRef = doc(db, 'admin_settings', 'global');

  const settingsSnap = await getDoc(settingsRef);

  if (settingsSnap.exists()) {
    const data = settingsSnap.data();

    if (
      data &&
      typeof data.usdToFcRate === 'number' &&
      Number.isFinite(data.usdToFcRate) &&
      data.usdToFcRate > 0
    ) {
      exchangeRate = data.usdToFcRate;
    } else {
      exchangeRate = DEFAULT_EXCHANGE_RATE;
    }
  } else {
    // Création uniquement si le document n'existe pas.
    exchangeRate = DEFAULT_EXCHANGE_RATE;

    await setDoc(
      settingsRef,
      {
        usdToFcRate: exchangeRate,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  inputExchangeRate.value = exchangeRate;
}

// ---------------------------------------------------------------------------
// CHARGEMENT UTILISATEURS
// ---------------------------------------------------------------------------

async function loadUsers({ force = false } = {}) {
  const now = Date.now();

  // Empêche plusieurs lectures simultanées.
  if (isLoadingUsers) {
    return;
  }

  // Empêche les refresh répétés accidentels.
  if (
    !force &&
    lastUsersLoadAt > 0 &&
    now - lastUsersLoadAt < REFRESH_COOLDOWN_MS
  ) {
    return;
  }

  isLoadingUsers = true;

  try {
    const usersSnap = await getDocs(collection(db, 'users'));

    // Ne conserver que les données nécessaires au dashboard.
    allUsers = usersSnap.docs.map((documentSnapshot) => {
      const data = documentSnapshot.data() || {};

      return {
        id: documentSnapshot.id,
        email: typeof data.email === 'string' ? data.email : '',
        subscriptionStatus:
          typeof data.subscriptionStatus === 'string'
            ? data.subscriptionStatus
            : '',
        createdAt: data.createdAt || null,
        trialEndDate: data.trialEndDate || null,
        subscriptionExpiresAt: data.subscriptionExpiresAt || null,
      };
    });

    lastUsersLoadAt = Date.now();

    renderAll();
  } finally {
    isLoadingUsers = false;
  }
}

// ---------------------------------------------------------------------------
// RENDU GLOBAL
// ---------------------------------------------------------------------------

function renderAll() {
  renderStats();
  renderRevenue();
  renderUsersTable(userSearchInput.value.trim());
}

function renderStats() {
  const total = allUsers.length;

  const active = allUsers.filter(
    (u) => u.subscriptionStatus === 'active'
  ).length;

  const trial = allUsers.filter(
    (u) => u.subscriptionStatus === 'trial'
  ).length;

  const inactive = allUsers.filter(
    (u) =>
      u.subscriptionStatus === 'expired' ||
      u.subscriptionStatus === 'cancelled'
  ).length;

  statTotalUsers.textContent = total.toLocaleString('fr-FR');
  statActiveUsers.textContent = active.toLocaleString('fr-FR');
  statTrialUsers.textContent = trial.toLocaleString('fr-FR');
  statInactiveUsers.textContent = inactive.toLocaleString('fr-FR');
}

function renderRevenue() {
  const activeCount = allUsers.filter(
    (u) => u.subscriptionStatus === 'active'
  ).length;

  const grossUSD = activeCount * SUBSCRIPTION_PRICE_USD;
  const chariowCutUSD = grossUSD * CHARIOW_FEE_RATE;
  const netUSD = grossUSD - chariowCutUSD;

  revenueActiveCount.textContent =
    activeCount.toLocaleString('fr-FR');

  revenueGrossValue.textContent = formatMoney(grossUSD);

  revenueChariowCut.textContent =
    `- ${formatMoney(chariowCutUSD)}`;

  revenueNetValue.textContent = formatMoney(netUSD);
  revenueNetValueSmall.textContent = formatMoney(netUSD);

  btnToggleCurrencyLabel.textContent =
    viewCurrency === 'USD'
      ? 'Voir en Franc Congolais'
      : 'Voir en Dollars';
}

// ---------------------------------------------------------------------------
// CONVERSION / FORMATAGE
// ---------------------------------------------------------------------------

function formatMoney(amountUSD) {
  if (
    typeof amountUSD !== 'number' ||
    !Number.isFinite(amountUSD)
  ) {
    return '$ 0';
  }

  if (viewCurrency === 'USD') {
    return `$ ${amountUSD.toLocaleString('fr-FR', {
      maximumFractionDigits: 2,
    })}`;
  }

  const amountFC = amountUSD * exchangeRate;

  return `${amountFC.toLocaleString('fr-FR', {
    maximumFractionDigits: 0,
  })} FC`;
}

btnToggleCurrency.addEventListener('click', () => {
  viewCurrency = viewCurrency === 'USD' ? 'FC' : 'USD';
  renderRevenue();
});

// ---------------------------------------------------------------------------
// ENREGISTREMENT TAUX DE CHANGE
// ---------------------------------------------------------------------------

formExchangeRate.addEventListener('submit', async (event) => {
  event.preventDefault();

  const value = Number(inputExchangeRate.value);

  // Validation renforcée.
  if (
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 100000000
  ) {
    exchangeRateMsg.textContent =
      'Merci de saisir un taux valide.';

    exchangeRateMsg.style.color = 'var(--color-error)';
    exchangeRateMsg.hidden = false;

    return;
  }

  try {
    await setDoc(
      doc(db, 'admin_settings', 'global'),
      {
        usdToFcRate: value,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    exchangeRate = value;

    exchangeRateMsg.textContent =
      `Taux enregistré : 1 $ = ${value.toLocaleString(
        'fr-FR'
      )} FC`;

    exchangeRateMsg.style.color =
      'var(--color-success)';

    exchangeRateMsg.hidden = false;

    renderRevenue();
  } catch (err) {
    console.error(
      "Erreur d'enregistrement du taux :",
      err
    );

    exchangeRateMsg.textContent =
      "Impossible d'enregistrer le taux. Réessayez.";

    exchangeRateMsg.style.color =
      'var(--color-error)';

    exchangeRateMsg.hidden = false;
  }
});

// ---------------------------------------------------------------------------
// TABLEAU UTILISATEURS
// ---------------------------------------------------------------------------

const STATUS_LABELS = {
  active: {
    label: 'Payant',
    className: 'badge--success',
  },

  trial: {
    label: 'Essai',
    className: 'badge--warning',
  },

  expired: {
    label: 'Expiré',
    className: 'badge--muted',
  },

  cancelled: {
    label: 'Annulé',
    className: 'badge--muted',
  },
};

function toDate(value) {
  if (!value) {
    return null;
  }

  if (
    typeof value === 'object' &&
    typeof value.toDate === 'function'
  ) {
    return value.toDate();
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime())
    ? null
    : parsed;
}

function formatDate(value) {
  const date = toDate(value);

  if (!date) {
    return '—';
  }

  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function renderUsersTable(searchTerm = '') {
  const term = String(searchTerm)
    .trim()
    .toLowerCase();

  const filtered = allUsers
    .filter((user) => {
      if (!term) {
        return true;
      }

      return (user.email || '')
        .toLowerCase()
        .includes(term);
    })
    .sort((a, b) => {
      const dateA = toDate(a.createdAt)?.getTime() || 0;
      const dateB = toDate(b.createdAt)?.getTime() || 0;

      return dateB - dateA;
    });

  usersTableBody.innerHTML = '';

  if (filtered.length === 0) {
    usersTableEmpty.hidden = false;
    return;
  }

  usersTableEmpty.hidden = true;

  for (const user of filtered) {
    const statusInfo =
      STATUS_LABELS[user.subscriptionStatus] || {
        label: user.subscriptionStatus || '—',
        className: 'badge--muted',
      };

    const endDate =
      user.subscriptionStatus === 'trial'
        ? user.trialEndDate
        : user.subscriptionExpiresAt;

    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${escapeHtml(user.email || '—')}</td>

      <td>
        <span class="badge ${escapeHtml(
          statusInfo.className
        )}">
          ${escapeHtml(statusInfo.label)}
        </span>
      </td>

      <td>${escapeHtml(
        formatDate(user.createdAt)
      )}</td>

      <td>${escapeHtml(
        formatDate(endDate)
      )}</td>
    `;

    usersTableBody.appendChild(tr);
  }
}

userSearchInput.addEventListener('input', () => {
  renderUsersTable(userSearchInput.value.trim());
});

// ---------------------------------------------------------------------------
// ACTIONS
// ---------------------------------------------------------------------------

btnRefresh.addEventListener('click', async () => {
  if (isLoadingUsers) {
    return;
  }

  btnRefresh.disabled = true;

  try {
    await loadUsers({ force: true });
    hideErrorBanner();
  } catch (err) {
    console.error(
      'Erreur de rafraîchissement :',
      err
    );

    showErrorBanner(
      'Impossible de rafraîchir les données. Réessayez.'
    );
  } finally {
    btnRefresh.disabled = false;
  }
});

btnLogout.addEventListener('click', async () => {
  try {
    await signOut(auth);
  } catch (err) {
    console.error(
      'Erreur de déconnexion :',
      err
    );
  }
});
