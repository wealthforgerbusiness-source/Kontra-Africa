/* ==========================================================================
   Kontra-Africa — Panneau Admin
   Connexion Google intégrée, statistiques utilisateurs,
   gains réels, conversion USD ⇄ FC.

   ⚠️ Version optimisée Firestore :
   - Les utilisateurs sont chargés PAR PAGE (limit + startAfter),
     plus jamais toute la collection en une seule fois.
   - Les statistiques (total / actifs / essai / inactifs) sont calculées
     avec getCountFromServer (requêtes d'agrégation), pas en lisant
     tous les documents.
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
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  getCountFromServer,
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

// Taille d'une page de la table utilisateurs.
const PAGE_SIZE = 25;

// Délai anti-rafale pour la recherche (évite une requête Firestore
// à chaque frappe clavier).
const SEARCH_DEBOUNCE_MS = 400;

let exchangeRate = DEFAULT_EXCHANGE_RATE;
let viewCurrency = 'USD';

let isLoadingUsers = false;

// Utilisateurs affichés sur la page courante uniquement
// (jamais toute la collection).
let currentPageUsers = [];

// Stats globales, mises en cache après chargement via getCountFromServer.
let statsCache = {
  total: 0,
  active: 0,
  trial: 0,
  inactive: 0,
};

// ---------------------------------------------------------------------------
// ÉTAT DE PAGINATION
// ---------------------------------------------------------------------------
//
// pagination.cursors[i] = document Firestore après lequel commence la page i
// (cursors[0] = null → première page).
// On avance avec startAfter(cursors[currentIndex]) et on stocke le dernier
// document de chaque page comme curseur de la page suivante.
//
const pagination = {
  mode: 'default', // 'default' (tri par date) | 'search' (préfixe email)
  searchTerm: '',
  cursors: [null],
  currentIndex: 0,
  hasNextPage: false,
};

let searchDebounceTimer = null;

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

// Boutons de pagination : réutilisés s'ils existent déjà dans le HTML,
// sinon créés dynamiquement (aucune modification du fichier HTML requise).
let btnPrevPage = document.getElementById('btnPrevPage');
let btnNextPage = document.getElementById('btnNextPage');
let pageIndicator = document.getElementById('pageIndicator');

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
    ensurePaginationControls();

    await loadExchangeRate();
    await loadStats();
    await startNewUserQuery('default', '');

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
// STATISTIQUES GLOBALES (via requêtes d'agrégation, sans lire les documents)
// ---------------------------------------------------------------------------

async function loadStats() {
  const usersRef = collection(db, 'users');

  const [totalSnap, activeSnap, trialSnap, expiredSnap, cancelledSnap] =
    await Promise.all([
      getCountFromServer(usersRef),
      getCountFromServer(
        query(usersRef, where('subscriptionStatus', '==', 'active'))
      ),
      getCountFromServer(
        query(usersRef, where('subscriptionStatus', '==', 'trial'))
      ),
      getCountFromServer(
        query(usersRef, where('subscriptionStatus', '==', 'expired'))
      ),
      getCountFromServer(
        query(usersRef, where('subscriptionStatus', '==', 'cancelled'))
      ),
    ]);

  statsCache = {
    total: totalSnap.data().count,
    active: activeSnap.data().count,
    trial: trialSnap.data().count,
    inactive: expiredSnap.data().count + cancelledSnap.data().count,
  };

  renderStats();
  renderRevenue();
}

function renderStats() {
  statTotalUsers.textContent = statsCache.total.toLocaleString('fr-FR');
  statActiveUsers.textContent = statsCache.active.toLocaleString('fr-FR');
  statTrialUsers.textContent = statsCache.trial.toLocaleString('fr-FR');
  statInactiveUsers.textContent =
    statsCache.inactive.toLocaleString('fr-FR');
}

function renderRevenue() {
  const activeCount = statsCache.active;

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
// TABLEAU UTILISATEURS — CHARGEMENT PAGINÉ
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

function mapUserDoc(documentSnapshot) {
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
}

// Construit les contraintes de la requête selon le mode courant
// (tri par date par défaut, ou recherche par préfixe d'email).
//
// NOTE : Firestore ne permet pas une recherche "contient" comme avant
// (filtrage en mémoire sur toute la collection). On adapte donc la
// recherche en un filtre par PRÉFIXE d'email (>= terme et < terme + '\uf8ff'),
// ce qui reste économe en lectures. On suppose que les emails sont stockés
// en minuscules (cas standard Firebase Auth) ; sinon adapter au moment
// de l'écriture des documents utilisateurs.
function buildUsersConstraints(cursorDoc) {
  const constraints = [];

  if (pagination.mode === 'search' && pagination.searchTerm) {
    const term = pagination.searchTerm;

    constraints.push(orderBy('email'));
    constraints.push(where('email', '>=', term));
    constraints.push(where('email', '<=', term + '\uf8ff'));
  } else {
    constraints.push(orderBy('createdAt', 'desc'));
  }

  if (cursorDoc) {
    constraints.push(startAfter(cursorDoc));
  }

  constraints.push(limit(PAGE_SIZE));

  return constraints;
}

// Charge une page de résultats. direction : 'first' | 'next' | 'prev' | 'current'
async function loadUsersPage(direction = 'current') {
  if (isLoadingUsers) {
    return;
  }

  isLoadingUsers = true;
  setPaginationButtonsDisabled(true);

  try {
    let targetIndex = pagination.currentIndex;

    if (direction === 'next') {
      targetIndex += 1;
    } else if (direction === 'prev') {
      targetIndex = Math.max(0, targetIndex - 1);
    } else if (direction === 'first') {
      targetIndex = 0;
    }

    const cursorDoc = pagination.cursors[targetIndex] || null;

    const usersQuery = query(
      collection(db, 'users'),
      ...buildUsersConstraints(cursorDoc)
    );

    const snap = await getDocs(usersQuery);
    const docsOnPage = snap.docs;

    currentPageUsers = docsOnPage.map(mapUserDoc);

    // On mémorise le dernier document de cette page comme curseur
    // de départ de la page suivante (jamais d'offset() facturé).
    if (docsOnPage.length > 0) {
      pagination.cursors[targetIndex + 1] =
        docsOnPage[docsOnPage.length - 1];
    }

    pagination.currentIndex = targetIndex;
    pagination.hasNextPage = docsOnPage.length === PAGE_SIZE;

    renderUsersTable();
    updatePaginationControls();
  } finally {
    isLoadingUsers = false;
    setPaginationButtonsDisabled(false);
  }
}

// Réinitialise complètement la pagination (nouveau mode ou nouvelle recherche)
// puis charge la première page.
async function startNewUserQuery(mode, searchTerm = '') {
  pagination.mode = mode;
  pagination.searchTerm = searchTerm;
  pagination.cursors = [null];
  pagination.currentIndex = 0;
  pagination.hasNextPage = false;

  await loadUsersPage('first');
}

function renderUsersTable() {
  usersTableBody.innerHTML = '';

  if (currentPageUsers.length === 0) {
    usersTableEmpty.hidden = false;
    return;
  }

  usersTableEmpty.hidden = true;

  for (const user of currentPageUsers) {
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

// ---------------------------------------------------------------------------
// PAGINATION — CONTRÔLES UI (créés dynamiquement si absents du HTML)
// ---------------------------------------------------------------------------

function ensurePaginationControls() {
  if (btnPrevPage && btnNextPage) {
    btnPrevPage.addEventListener('click', () => loadUsersPage('prev'));
    btnNextPage.addEventListener('click', () => loadUsersPage('next'));
    return;
  }

  const table = usersTableBody.closest('table');

  const container = document.createElement('div');
  container.className = 'pagination-controls';
  container.style.cssText =
    'display:flex;align-items:center;gap:12px;margin-top:12px;';

  container.innerHTML = `
    <button type="button" id="btnPrevPage" class="btn btn--secondary">Précédent</button>
    <span id="pageIndicator" style="font-size:14px;"></span>
    <button type="button" id="btnNextPage" class="btn btn--secondary">Suivant</button>
  `;

  if (table && table.parentNode) {
    table.parentNode.insertBefore(container, table.nextSibling);
  } else {
    usersTableBody.parentElement.appendChild(container);
  }

  btnPrevPage = document.getElementById('btnPrevPage');
  btnNextPage = document.getElementById('btnNextPage');
  pageIndicator = document.getElementById('pageIndicator');

  btnPrevPage.addEventListener('click', () => loadUsersPage('prev'));
  btnNextPage.addEventListener('click', () => loadUsersPage('next'));
}

function setPaginationButtonsDisabled(disabled) {
  if (btnPrevPage) {
    btnPrevPage.disabled = disabled || pagination.currentIndex === 0;
  }

  if (btnNextPage) {
    btnNextPage.disabled = disabled || !pagination.hasNextPage;
  }
}

function updatePaginationControls() {
  if (btnPrevPage) {
    btnPrevPage.disabled = pagination.currentIndex === 0;
  }

  if (btnNextPage) {
    btnNextPage.disabled = !pagination.hasNextPage;
  }

  if (pageIndicator) {
    pageIndicator.textContent = `Page ${pagination.currentIndex + 1}`;
  }
}

// ---------------------------------------------------------------------------
// RECHERCHE (avec anti-rafale pour limiter les requêtes Firestore)
// ---------------------------------------------------------------------------

userSearchInput.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);

  searchDebounceTimer = setTimeout(() => {
    const term = userSearchInput.value.trim().toLowerCase();

    startNewUserQuery(term ? 'search' : 'default', term).catch((err) => {
      console.error('Erreur de recherche :', err);
      showErrorBanner('Impossible de lancer la recherche. Réessayez.');
    });
  }, SEARCH_DEBOUNCE_MS);
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
    await loadStats();
    await startNewUserQuery(pagination.mode, pagination.searchTerm);
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
