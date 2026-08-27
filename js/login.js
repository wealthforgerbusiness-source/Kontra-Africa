import { auth, googleProvider } from '/js/firebase-config.js';

import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

const API_BASE_URL = 'https://kontra-africa.onrender.com';

const REDIRECT_KEY = 'kontra_auth_pending';
const INIT_USER_TIMEOUT_MS = 60000;

const googleBtn = document.getElementById('googleBtn');
const termsCheckbox = document.getElementById('termsCheckbox');

const loadingState = document.getElementById('loadingState');
const loadingLabel = document.getElementById('loadingLabel');

const errorState = document.getElementById('errorState');
const errorMessage = document.getElementById('errorMessage');

const retryBtn = document.getElementById('retryBtn');

const openBrowserFallback =
  document.getElementById('openBrowserFallback');

const openBrowserBtn =
  document.getElementById('openBrowserBtn');

const isMobile =
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;


// ============================================================
// UI
// ============================================================

function showButton() {
  googleBtn.hidden = false;
  googleBtn.disabled = !termsCheckbox.checked;

  loadingState.hidden = true;
  errorState.hidden = true;
  openBrowserFallback.hidden = true;
}

function showLoading(label) {
  googleBtn.hidden = true;
  loadingState.hidden = false;
  errorState.hidden = true;
  openBrowserFallback.hidden = true;

  loadingLabel.textContent = label;
}

function showError(message) {
  googleBtn.hidden = true;
  loadingState.hidden = true;
  errorState.hidden = false;
  openBrowserFallback.hidden = true;

  errorMessage.textContent = message;
}

function showFallback() {
  googleBtn.hidden = true;
  loadingState.hidden = true;
  errorState.hidden = true;
  openBrowserFallback.hidden = false;
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
      return "Le navigateur a bloqué la fenêtre Google. Réessayez.";

    case 'auth/network-request-failed':
      return "Problème de connexion Internet. Vérifiez votre réseau.";

    case 'auth/unauthorized-domain':
      return "Ce domaine n'est pas autorisé dans Firebase Authentication.";

    case 'auth/operation-not-allowed':
      return "La connexion Google n'est pas activée dans Firebase.";

    case 'auth/invalid-credential':
      return "Les informations Google reçues sont invalides. Réessayez.";

    default:
      return "La connexion avec Google a échoué. Réessayez.";
  }
}


// ============================================================
// BACKEND
// ============================================================

async function initUserOnBackend(firebaseUser) {

  const payload = {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: firebaseUser.displayName,
    photoURL: firebaseUser.photoURL
  };

  showLoading(
    "Préparation de votre espace… cela peut prendre jusqu'à 1 minute."
  );

  const controller = new AbortController();

  const timeoutId = setTimeout(
    () => controller.abort(),
    INIT_USER_TIMEOUT_MS
  );

  try {

    const response = await fetch(
      `${API_BASE_URL}/api/init-user`,
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json'
        },

        body: JSON.stringify(payload),

        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(
        `init-user a répondu avec le statut ${response.status}`
      );
    }

    return await response.json().catch(() => ({}));

  } catch (err) {

    if (err.name === 'AbortError') {
      throw new Error('TIMEOUT_INIT_USER');
    }

    throw err;

  } finally {

    clearTimeout(timeoutId);
  }
}


// ============================================================
// CONNEXION TERMINÉE
// ============================================================

async function completeSignIn(firebaseUser) {

  try {

    console.log(
      '✅ Firebase connecté :',
      firebaseUser.email
    );

    await initUserOnBackend(firebaseUser);

    localStorage.removeItem(REDIRECT_KEY);

    window.location.href = '/dashboard.html';

  } catch (err) {

    console.error('Erreur init-user :', err);

    localStorage.removeItem(REDIRECT_KEY);

    if (err.message === 'TIMEOUT_INIT_USER') {

      showError(
        "Le serveur met trop de temps à démarrer. " +
        "Réessayez dans quelques secondes."
      );

    } else {

      showError(
        "Google vous a connecté, mais votre espace n'a pas pu être préparé. Réessayez."
      );
    }
  }
}


// ============================================================
// LANCER GOOGLE
// ============================================================

async function startGoogleSignIn() {

  if (!termsCheckbox.checked) {
    return;
  }

  showLoading("Connexion à Google…");

  try {

    // IMPORTANT :
    // On définit la persistence AVANT le redirect.
    await setPersistence(
      auth,
      browserLocalPersistence
    );

    // --------------------------------------------------------
    // MOBILE
    // --------------------------------------------------------

    if (isMobile) {

      console.log(
        '📱 Mobile détecté → Google Redirect'
      );

      localStorage.setItem(
        REDIRECT_KEY,
        '1'
      );

      await signInWithRedirect(
        auth,
        googleProvider
      );

      return;
    }

    // --------------------------------------------------------
    // PC
    // --------------------------------------------------------

    console.log(
      '💻 PC détecté → Google Popup'
    );

    const result =
      await signInWithPopup(
        auth,
        googleProvider
      );

    if (result?.user) {

      await completeSignIn(
        result.user
      );
    }

  } catch (err) {

    console.error(
      '❌ Erreur Google:',
      err
    );

    localStorage.removeItem(
      REDIRECT_KEY
    );

    showError(
      translateAuthError(err)
    );
  }
}


// ============================================================
// RETOUR DE GOOGLE
// ============================================================

async function checkRedirectResult() {

  const wasPending =
    localStorage.getItem(
      REDIRECT_KEY
    );

  try {

    console.log(
      '🔄 Vérification du retour Google...'
    );

    await setPersistence(
      auth,
      browserLocalPersistence
    );

    const result =
      await getRedirectResult(auth);

    // --------------------------------------------------------
    // GOOGLE A BIEN RENVOYÉ L'UTILISATEUR
    // --------------------------------------------------------

    if (result?.user) {

      console.log(
        '✅ Retour Google réussi :',
        result.user.email
      );

      await completeSignIn(
        result.user
      );

      return;
    }

    // --------------------------------------------------------
    // PAS DE RESULTAT
    // --------------------------------------------------------

    if (wasPending) {

      console.warn(
        '⚠️ Redirect Google attendu mais aucun utilisateur reçu.'
      );

      localStorage.removeItem(
        REDIRECT_KEY
      );

      // Seulement pour une PWA installée.
      if (isStandalone) {

        showFallback();

        return;
      }
    }

    showButton();

  } catch (err) {

    console.error(
      '❌ Erreur getRedirectResult:',
      err
    );

    localStorage.removeItem(
      REDIRECT_KEY
    );

    if (isStandalone) {

      showFallback();

      return;
    }

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
// FALLBACK PWA → NAVIGATEUR
// ============================================================

if (openBrowserBtn) {

  openBrowserBtn.addEventListener(
    'click',
    () => {

      const url =
        window.location.href.split('#')[0];

      window.open(
        url,
        '_blank',
        'noopener,noreferrer'
      );
    }
  );
}


// ============================================================
// BOUTONS
// ============================================================

googleBtn.addEventListener(
  'click',
  startGoogleSignIn
);

retryBtn.addEventListener(
  'click',
  showButton
);


// ============================================================
// INITIALISATION
// ============================================================

checkRedirectResult();
