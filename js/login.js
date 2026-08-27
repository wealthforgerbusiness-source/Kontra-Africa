import { auth, googleProvider } from '/js/firebase-config.js';

import {
  signInWithPopup,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

const API_BASE_URL = 'https://kontra-africa.onrender.com';

const INIT_USER_TIMEOUT_MS = 60000;

const googleBtn = document.getElementById('googleBtn');
const termsCheckbox = document.getElementById('termsCheckbox');

const loadingState = document.getElementById('loadingState');
const loadingLabel = document.getElementById('loadingLabel');

const errorState = document.getElementById('errorState');
const errorMessage = document.getElementById('errorMessage');

const retryBtn = document.getElementById('retryBtn');


// ============================================================
// UI
// ============================================================

function showButton() {

  googleBtn.hidden = false;
  googleBtn.disabled = !termsCheckbox.checked;

  loadingState.hidden = true;
  errorState.hidden = true;
}


function showLoading(label) {

  googleBtn.hidden = true;

  loadingState.hidden = false;
  errorState.hidden = true;

  loadingLabel.textContent = label;
}


function showError(message) {

  googleBtn.hidden = false;
  googleBtn.disabled = false;

  loadingState.hidden = true;

  errorState.hidden = false;

  errorMessage.textContent = message;
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
// BACKEND
// ============================================================

async function initUserOnBackend(firebaseUser) {

  const payload = {

    uid: firebaseUser.uid,

    email: firebaseUser.email || '',

    displayName:
      firebaseUser.displayName || '',

    photoURL:
      firebaseUser.photoURL || ''
  };


  showLoading(
    "Préparation de votre espace… cela peut prendre jusqu'à 1 minute."
  );


  const controller =
    new AbortController();


  const timeoutId =
    setTimeout(
      () => controller.abort(),
      INIT_USER_TIMEOUT_MS
    );


  try {

    const response =
      await fetch(
        `${API_BASE_URL}/api/init-user`,
        {

          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body: JSON.stringify(
            payload
          ),

          signal:
            controller.signal
        }
      );


    if (!response.ok) {

      throw new Error(
        `init-user a répondu avec le statut ${response.status}`
      );
    }


    return await response
      .json()
      .catch(
        () => ({})
      );


  } catch (err) {

    if (
      err.name === 'AbortError'
    ) {

      throw new Error(
        'TIMEOUT_INIT_USER'
      );
    }

    throw err;

  } finally {

    clearTimeout(
      timeoutId
    );
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


    await initUserOnBackend(
      firebaseUser
    );


    console.log(
      '✅ Utilisateur initialisé côté serveur'
    );


    window.location.href =
      '/dashboard.html';


  } catch (err) {

    console.error(
      '❌ Erreur init-user :',
      err
    );


    if (
      err.message ===
      'TIMEOUT_INIT_USER'
    ) {

      showError(
        "Le serveur met trop de temps à démarrer. Réessayez dans quelques secondes."
      );

    } else {

      showError(
        "Google vous a connecté, mais votre espace n'a pas pu être préparé. Réessayez."
      );
    }
  }
}


// ============================================================
// CONNEXION GOOGLE
// ============================================================

async function startGoogleSignIn() {

  if (
    !termsCheckbox.checked
  ) {

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
    // GOOGLE POPUP
    //
    // IMPORTANT :
    // Aucun signInWithRedirect()
    // Aucun getRedirectResult()
    // --------------------------------------------------------

    console.log(
      '🌐 Connexion Google avec Popup'
    );


    const result =
      await signInWithPopup(
        auth,
        googleProvider
      );


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
    // INITIALISER LE COMPTE
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
// CHECKBOX
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
// INITIALISATION
// ============================================================

showButton();

console.log(
  '✅ Kontra-Africa Login chargé'
);
