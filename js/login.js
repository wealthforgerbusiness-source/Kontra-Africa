import { auth, googleProvider } from '/js/firebase-config.js';

import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

const API_BASE_URL = 'https://kontra-africa.onrender.com';

// ============================================================
// CONFIGURATION
// ============================================================

const INIT_USER_TIMEOUT_MS = 120000; // 2 minutes
const INIT_USER_MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

// Clé localStorage posée juste avant signInWithRedirect(), et lue au
// rechargement de la page après le retour de Google, pour savoir qu'un
// résultat de redirection est attendu.
const AUTH_PENDING_KEY = 'kontra_auth_pending';

// Si getRedirectResult() ne s'est toujours pas résolu après ce délai suite à
// un retour de redirection, on propose le secours "Ouvrir dans le
// navigateur" (bug connu : le stockage de session utilisé par le redirect
// n'est parfois pas partagé avec la webview d'une PWA installée).
const REDIRECT_FALLBACK_TIMEOUT_MS = 8000;

// ============================================================
// DETECTION MOBILE / STANDALONE
// ============================================================
// signInWithPopup() échoue sur mobile (testé : navigateur mobile classique
// ET PWA installée) — problème connu de Firebase Auth sur mobile, quel que
// soit le mode d'affichage. On bascule donc sur signInWithRedirect() dès
// qu'on est sur mobile, pas seulement en mode standalone.

const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

const isMobileDevice =
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (window.matchMedia('(pointer: coarse)').matches &&
    window.matchMedia('(hover: none)').matches);

const shouldUseRedirect = isStandalone || isMobileDevice;

// ============================================================
// ELEMENTS
// ============================================================

const googleBtn = document.getElementById('googleBtn');
const termsCheckbox = document.getElementById('termsCheckbox');

const loadingState = document.getElementById('loadingState');
const loadingLabel = document.getElementById('loadingLabel');

const errorState = document.getElementById('errorState');
const errorMessage = document.getElementById('errorMessage');

const retryBtn = document.getElementById('retryBtn');

const openBrowserFallback = document.getElementById('openBrowserFallback');
const openBrowserBtn = document.getElementById('openBrowserBtn');

// ============================================================
// UI
// ============================================================

function showButton() {
  googleBtn.hidden = false;
  googleBtn.disabled = !termsCheckbox.checked;

  loadingState.hidden = true;
  errorState.hidden = true;
  if (openBrowserFallback) openBrowserFallback.hidden = true;
}

function showLoading(label) {
  googleBtn.hidden = true;

  loadingState.hidden = false;
  errorState.hidden = true;
  if (openBrowserFallback) openBrowserFallback.hidden = true;

  loadingLabel.textContent = label;
}

function showError(message) {
  googleBtn.hidden = false;
  googleBtn.disabled = false;

  loadingState.hidden = true;

  errorState.hidden = false;
  if (openBrowserFallback) openBrowserFallback.hidden = true;

  errorMessage.textContent = message;
}

// Secours affiché si le retour de redirection reste bloqué trop longtemps
// (typiquement en PWA installée — voir REDIRECT_FALLBACK_TIMEOUT_MS).
function showOpenBrowserFallback() {
  if (!openBrowserFallback) return;

  googleBtn.hidden = true;
  loadingState.hidden = true;
  errorState.hidden = true;
  openBrowserFallback.hidden = false;
}

// ============================================================
// UTILITAIRE
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// ERREURS FIREBASE
// ============================================================

function translateAuthError(error) {
  console.error('Firebase Auth error:', error);

  const code = error?.code;

  switch (code) {

    case 'auth/popup-closed-by-user':
      return "La fenêtre Google a été fermée. Réessayez.";

    case 'auth/cancelled-popup-request':
      return "La connexion a été annulée. Réessayez.";

    case 'auth/popup-blocked':
      return "Le navigateur a bloqué la fenêtre Google. Autorisez les fenêtres pop-up puis réessayez.";

    case 'auth/network-request-failed':
      return "Problème de connexion Internet. Vérifiez votre connexion.";

    case 'auth/unauthorized-domain':
      return "Ce domaine n'est pas autorisé dans Firebase Authentication.";

    case 'auth/operation-not-allowed':
      return "La connexion Google n'est pas activée dans Firebase.";

    case 'auth/invalid-credential':
      return "Les informations Google reçues sont invalides. Réessayez.";

    case 'auth/internal-error':
      return "Google a rencontré une erreur interne. Réessayez.";

    default:
      return "La connexion avec Google a échoué. Réessayez.";
  }
}

// ============================================================
// INITIALISATION UTILISATEUR COTE BACKEND
// ============================================================

async function initUserOnBackend(firebaseUser) {

  const idToken = await firebaseUser.getIdToken();

  const payload = {
    email: firebaseUser.email || '',

    displayName:
      firebaseUser.displayName || '',

    photoURL:
      firebaseUser.photoURL || ''
  };

  let lastError = null;

  // ----------------------------------------------------------
  // PLUSIEURS TENTATIVES AUTOMATIQUES
  // ----------------------------------------------------------

  for (
    let attempt = 1;
    attempt <= INIT_USER_MAX_ATTEMPTS;
    attempt++
  ) {

    showLoading(
      attempt === 1
        ? "Préparation de votre espace…"
        : `Le serveur démarre… nouvelle tentative ${attempt}/${INIT_USER_MAX_ATTEMPTS}`
    );

    console.log(
      `🚀 init-user : tentative ${attempt}/${INIT_USER_MAX_ATTEMPTS}`
    );

    const controller = new AbortController();

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, INIT_USER_TIMEOUT_MS);

    try {

      const response = await fetch(
        `${API_BASE_URL}/api/init-user`,
        {
          method: 'POST',

          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },

          body: JSON.stringify(payload),

          signal: controller.signal
        }
      );

      clearTimeout(timeoutId);

      // ------------------------------------------------------
      // SUCCÈS
      // ------------------------------------------------------

      if (response.ok) {

        const data = await response
          .json()
          .catch(() => ({}));

        console.log(
          '✅ Compte initialisé côté serveur',
          data
        );

        return data;
      }

      // ------------------------------------------------------
      // ERREUR SERVEUR
      // ------------------------------------------------------

      const error = new Error(
        `init-user a répondu avec le statut ${response.status}`
      );

      console.error(
        `❌ Tentative ${attempt} échouée :`,
        error
      );

      lastError = error;

      // Les erreurs 4xx définitives ne nécessitent
      // généralement pas de nouvelle tentative.
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429
      ) {
        throw error;
      }

    } catch (err) {

      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {

        console.warn(
          `⏱️ Timeout init-user à la tentative ${attempt}`
        );

        lastError = new Error(
          'TIMEOUT_INIT_USER'
        );

      } else {

        console.error(
          `❌ Erreur init-user tentative ${attempt}:`,
          err
        );

        lastError = err;
      }
    }

    // --------------------------------------------------------
    // ATTENTE AVANT NOUVEL ESSAI
    // --------------------------------------------------------

    if (attempt < INIT_USER_MAX_ATTEMPTS) {

      showLoading(
        "Le serveur démarre… veuillez patienter."
      );

      console.log(
        `⏳ Nouvelle tentative dans ${RETRY_DELAY_MS / 1000} secondes`
      );

      await sleep(RETRY_DELAY_MS);
    }
  }

  // ----------------------------------------------------------
  // TOUTES LES TENTATIVES ONT ÉCHOUÉ
  // ----------------------------------------------------------

  throw lastError || new Error(
    'INIT_USER_FAILED'
  );
}

// ============================================================
// CONNEXION TERMINEE
// ============================================================

async function completeSignIn(firebaseUser) {

  try {

    console.log(
      '✅ Firebase connecté :',
      firebaseUser.email
    );

    // --------------------------------------------------------
    // PREPARATION DU COMPTE
    // --------------------------------------------------------

    await initUserOnBackend(firebaseUser);

    console.log(
      '✅ Utilisateur prêt côté serveur'
    );

    // --------------------------------------------------------
    // DASHBOARD
    // --------------------------------------------------------

    window.location.href =
      '/dashboard.html';

  } catch (err) {

    console.error(
      '❌ Impossible de préparer le compte :',
      err
    );

    if (
      err.message === 'TIMEOUT_INIT_USER'
    ) {

      showError(
        "Le serveur met trop de temps à démarrer. Vérifiez votre connexion puis réessayez."
      );

    } else {

      showError(
        "Google vous a connecté, mais votre espace n'a pas pu être préparé. Réessayez."
      );
    }
  }
}

// ============================================================
// RESULTAT DE REDIRECTION (retour de Google après signInWithRedirect)
// ============================================================

async function checkRedirectResult() {

  const wasPending = localStorage.getItem(AUTH_PENDING_KEY) === '1';

  let fallbackTimer = null;

  if (wasPending) {
    // On sait qu'une redirection Google était en cours : on affiche un état
    // de chargement dédié, avec un filet de sécurité si ça traîne trop.
    showLoading("Finalisation de la connexion…");

    fallbackTimer = setTimeout(
      showOpenBrowserFallback,
      REDIRECT_FALLBACK_TIMEOUT_MS
    );
  } else {
    // Rien en attente : écran normal tout de suite, la vérification se fait
    // silencieusement en arrière-plan.
    showButton();
  }

  try {

    const result = await getRedirectResult(auth);

    if (fallbackTimer) clearTimeout(fallbackTimer);

    if (result && result.user) {

      localStorage.removeItem(AUTH_PENDING_KEY);

      console.log(
        '✅ Google connecté (redirect) :',
        result.user.email
      );

      await completeSignIn(result.user);
      return;
    }

    // Aucun résultat exploitable. Si on attendait un retour de redirection,
    // on nettoie le flag et on laisse l'utilisateur retenter normalement.
    if (wasPending) {
      localStorage.removeItem(AUTH_PENDING_KEY);
      showButton();
    }

  } catch (err) {

    if (fallbackTimer) clearTimeout(fallbackTimer);

    localStorage.removeItem(AUTH_PENDING_KEY);

    console.error(
      '❌ Erreur redirect Google :',
      err
    );

    showError(translateAuthError(err));
  }
}

// ============================================================
// CONNEXION GOOGLE
// ============================================================

async function startGoogleSignIn() {

  if (!termsCheckbox.checked) {
    return;
  }

  showLoading(
    "Connexion à Google…"
  );

  try {

    // --------------------------------------------------------
    // PERSISTENCE FIREBASE
    // --------------------------------------------------------

    await setPersistence(
      auth,
      browserLocalPersistence
    );

    console.log(
      '🔐 Persistence Firebase configurée'
    );

    // --------------------------------------------------------
    // MOBILE (standalone ou navigateur classique) : REDIRECT
    // --------------------------------------------------------

    if (shouldUseRedirect) {

      console.log(
        '📱 Connexion Google avec Redirect (mobile)'
      );

      localStorage.setItem(AUTH_PENDING_KEY, '1');

      await signInWithRedirect(
        auth,
        googleProvider
      );

      return; // La page va être rechargée par la redirection Google.
    }

    // --------------------------------------------------------
    // DESKTOP : POPUP
    // --------------------------------------------------------

    console.log(
      '🌐 Connexion Google avec Popup'
    );

    const result =
      await signInWithPopup(
        auth,
        googleProvider
      );

    // --------------------------------------------------------
    // VERIFICATION UTILISATEUR
    // --------------------------------------------------------

    if (
      !result ||
      !result.user
    ) {

      throw new Error(
        'Aucun utilisateur Google reçu.'
      );
    }

    console.log(
      '✅ Google connecté :',
      result.user.email
    );

    // --------------------------------------------------------
    // INITIALISATION DU COMPTE
    // --------------------------------------------------------

    await completeSignIn(
      result.user
    );

  } catch (err) {

    console.error(
      '❌ Erreur Google:',
      err
    );

    showError(
      translateAuthError(err)
    );
  }
}

// ============================================================
// CHECKBOX CONDITIONS
// ============================================================

termsCheckbox.addEventListener(
  'change',
  () => {

    googleBtn.disabled =
      !termsCheckbox.checked;
  }
);

// ============================================================
// BOUTON GOOGLE
// ============================================================

googleBtn.addEventListener(
  'click',
  startGoogleSignIn
);

// ============================================================
// BOUTON RETRY
// ============================================================

if (retryBtn) {

  retryBtn.addEventListener(
    'click',
    () => {

      showButton();

    }
  );
}

// ============================================================
// BOUTON "OUVRIR DANS LE NAVIGATEUR" (secours PWA bloquée)
// ============================================================

if (openBrowserBtn) {

  openBrowserBtn.addEventListener(
    'click',
    () => {

      localStorage.removeItem(AUTH_PENDING_KEY);

      // Ouvre la page de connexion dans un nouvel onglet du navigateur
      // système : en PWA standalone (Android/iOS), window.open() en dehors
      // du contexte installé bascule vers le navigateur classique.
      window.open(window.location.href, '_blank');

      showButton();

    }
  );
}

// ============================================================
// INITIALISATION
// ============================================================

checkRedirectResult();

console.log(
  '✅ Kontra-Africa Login chargé'
);
