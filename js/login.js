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

// Render peut mettre du temps à démarrer
const INIT_USER_TIMEOUT_MS = 60000;

const googleBtn = document.getElementById('googleBtn');
const termsCheckbox = document.getElementById('termsCheckbox');
const loadingState = document.getElementById('loadingState');
const loadingLabel = document.getElementById('loadingLabel');
const errorState = document.getElementById('errorState');
const errorMessage = document.getElementById('errorMessage');
const retryBtn = document.getElementById('retryBtn');
const openBrowserFallback = document.getElementById('openBrowserFallback');
const openBrowserBtn = document.getElementById('openBrowserBtn');

/* ==========================================================================
   DÉTECTION MOBILE
   ========================================================================== */

const isMobile =
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/* ==========================================================================
   DÉTECTION PWA INSTALLÉE
   ========================================================================== */

const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

/* ==========================================================================
   ÉTATS VISUELS
   ========================================================================== */

function showButton() {
  googleBtn.hidden = false;
  googleBtn.disabled = !termsCheckbox.checked;

  loadingState.hidden = true;
  errorState.hidden = true;
  openBrowserFallback.hidden = true;
}

function showLoading(label) {
  googleBtn.hidden = true;
  errorState.hidden = true;
  openBrowserFallback.hidden = true;

  loadingState.hidden = false;
  loadingLabel.textContent = label;
}

function showError(message) {
  googleBtn.hidden = true;
  loadingState.hidden = true;
  openBrowserFallback.hidden = true;

  errorState.hidden = false;
  errorMessage.textContent = message;
}

function showFallback() {
  googleBtn.hidden = true;
  loadingState.hidden = true;
  errorState.hidden = true;

  openBrowserFallback.hidden = false;
}

/* ==========================================================================
   CASE À COCHER
   ========================================================================== */

termsCheckbox.addEventListener('change', () => {
  googleBtn.disabled = !termsCheckbox.checked;
});

/* ==========================================================================
   TRADUCTION DES ERREURS FIREBASE
   ========================================================================== */

function translateAuthError(error) {
  const code = error && error.code;

  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return "La fenêtre de connexion a été fermée avant la fin. Réessayez.";

    case 'auth/network-request-failed':
      return "Problème de connexion internet. Vérifiez votre réseau et réessayez.";

    case 'auth/popup-blocked':
      return "La fenêtre de connexion a été bloquée par le navigateur. Réessayez.";

    case 'auth/unauthorized-domain':
      return "Ce domaine n'est pas autorisé par Firebase Authentication.";

    case 'auth/operation-not-allowed':
      return "La connexion Google n'est pas activée dans Firebase.";

    case 'auth/account-exists-with-different-credential':
      return "Un compte existe déjà avec cette adresse email.";

    default:
      console.error('[AUTH] Erreur Firebase complète:', error);

      return "La connexion avec Google a échoué. Réessayez.";
  }
}

/* ==========================================================================
   INITIALISATION DU PROFIL UTILISATEUR SUR LE BACKEND
   ========================================================================== */

async function initUserOnBackend(firebaseUser) {
  const payload = {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: firebaseUser.displayName,
    photoURL: firebaseUser.photoURL
  };

  showLoading(
    "Préparation de votre espace… (cela peut prendre jusqu'à 1 minute la première fois)"
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

/* ==========================================================================
   FLUX COMPLET APRÈS AUTHENTIFICATION
   ========================================================================== */

async function completeSignIn(firebaseUser) {

  if (!firebaseUser) {
    throw new Error('NO_FIREBASE_USER');
  }

  try {

    console.log(
      '[AUTH] Utilisateur Firebase détecté:',
      firebaseUser.uid
    );

    await initUserOnBackend(firebaseUser);

    /*
     * IMPORTANT :
     *
     * On ne supprime kontra_auth_pending qu'après que Firebase
     * et le backend aient correctement terminé.
     */
    localStorage.removeItem(REDIRECT_KEY);

    console.log(
      '[AUTH] Connexion terminée. Redirection vers dashboard.'
    );

    window.location.replace('/dashboard.html');

  } catch (err) {

    console.error(
      '[AUTH] Erreur init-user:',
      err
    );

    localStorage.removeItem(REDIRECT_KEY);

    if (err.message === 'TIMEOUT_INIT_USER') {

      showError(
        "La préparation de votre espace prend plus de temps que prévu (le serveur démarre). Réessayez dans un instant."
      );

    } else {

      showError(
        "Votre connexion Google a réussi, mais nous n'avons pas pu préparer votre espace. Réessayez."
      );
    }
  }
}

/* ==========================================================================
   ATTEND QUE FIREBASE AIT TERMINÉ DE RESTAURER LA SESSION
   ========================================================================== */

/*
 * C'est la correction principale pour mobile/PWA.
 *
 * Sur certains téléphones :
 *
 * getRedirectResult() peut retourner null
 * ALORS QUE
 * auth.currentUser existe déjà.
 *
 * On attend donc que Firebase ait terminé sa restauration avant
 * de décider que l'utilisateur n'est pas connecté.
 */

async function waitForFirebaseAuth() {

  try {

    /*
     * authStateReady() est disponible dans les versions modernes
     * de Firebase Auth et attend que l'état initial soit connu.
     */
    if (
      typeof auth.authStateReady === 'function'
    ) {
      await auth.authStateReady();

      console.log(
        '[AUTH] Firebase a terminé la restauration de la session.'
      );

      return auth.currentUser || null;
    }

  } catch (error) {

    console.warn(
      '[AUTH] authStateReady() indisponible ou en erreur:',
      error
    );
  }

  /*
   * Fallback compatible :
   * si authStateReady() n'est pas disponible, on écoute
   * temporairement l'état Firebase.
   */

  return new Promise((resolve) => {

    let resolved = false;

    const timeoutId = setTimeout(() => {

      if (resolved) {
        return;
      }

      resolved = true;

      resolve(auth.currentUser || null);

    }, 10000);

    const unsubscribe =
      auth.onAuthStateChanged
        ? auth.onAuthStateChanged((user) => {

            if (resolved) {
              return;
            }

            resolved = true;

            clearTimeout(timeoutId);

            unsubscribe();

            resolve(user || null);

          })
        : null;

    /*
     * Si la méthode n'existe pas, on utilise directement currentUser.
     */
    if (!unsubscribe) {

      clearTimeout(timeoutId);

      resolved = true;

      resolve(auth.currentUser || null);
    }
  });
}

/* ==========================================================================
   LANCEMENT CONNEXION GOOGLE
   ========================================================================== */

async function startGoogleSignIn() {

  if (!termsCheckbox.checked) {
    return;
  }

  showLoading('Connexion à Google…');

  try {

    /*
     * On conserve la persistance locale existante.
     */
    await setPersistence(
      auth,
      browserLocalPersistence
    );

    if (isMobile) {

      /*
       * On mémorise le fait qu'une redirection est en cours.
       */
      localStorage.setItem(
        REDIRECT_KEY,
        '1'
      );

      console.log(
        '[AUTH] Mobile détecté : lancement Google Redirect.'
      );

      await signInWithRedirect(
        auth,
        googleProvider
      );

      /*
       * La page va être rechargée après Google.
       */
      return;
    }

    /*
     * Ordinateur :
     * on conserve exactement le système popup existant.
     */
    const result = await signInWithPopup(
      auth,
      googleProvider
    );

    if (
      result &&
      result.user
    ) {

      await completeSignIn(
        result.user
      );

    } else {

      /*
       * Sécurité supplémentaire.
       */
      const currentUser =
        await waitForFirebaseAuth();

      if (currentUser) {

        await completeSignIn(
          currentUser
        );

      } else {

        throw new Error(
          'NO_FIREBASE_USER'
        );
      }
    }

  } catch (err) {

    console.error(
      '[AUTH] Erreur signInWithGoogle:',
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

/* ==========================================================================
   TRAITEMENT DU RETOUR GOOGLE REDIRECT
   ========================================================================== */

async function checkRedirectResult() {

  const wasPending =
    localStorage.getItem(
      REDIRECT_KEY
    );

  try {

    showLoading(
      'Vérification de votre connexion…'
    );

    /*
     * On remet la persistance locale avant de récupérer le résultat.
     */
    await setPersistence(
      auth,
      browserLocalPersistence
    );

    /*
     * Première tentative :
     * récupérer directement le résultat du redirect.
     */
    let result = null;

    try {

      result =
        await getRedirectResult(auth);

    } catch (redirectError) {

      console.error(
        '[AUTH] getRedirectResult() erreur:',
        redirectError
      );

      /*
       * On ne considère PAS immédiatement que l'utilisateur
       * est déconnecté.
       *
       * Firebase peut déjà avoir restauré currentUser.
       */
    }

    /* -----------------------------------------------------------------------
       CAS 1 — getRedirectResult() retourne bien l'utilisateur
       ----------------------------------------------------------------------- */

    if (
      result &&
      result.user
    ) {

      console.log(
        '[AUTH] Redirect Google récupéré avec succès.'
      );

      await completeSignIn(
        result.user
      );

      return;
    }

    /* -----------------------------------------------------------------------
       CAS 2 — getRedirectResult() est null MAIS currentUser existe
       ----------------------------------------------------------------------- */

    const restoredUser =
      await waitForFirebaseAuth();

    if (restoredUser) {

      console.log(
        '[AUTH] Session Firebase restaurée malgré un résultat redirect nul.'
      );

      await completeSignIn(
        restoredUser
      );

      return;
    }

    /* -----------------------------------------------------------------------
       CAS 3 — aucun utilisateur
       ----------------------------------------------------------------------- */

    if (wasPending) {

      console.warn(
        '[AUTH] Une redirection était attendue mais aucune session Firebase n'a été restaurée.'
      );

      localStorage.removeItem(
        REDIRECT_KEY
      );

      /*
       * Seulement maintenant, après avoir réellement attendu Firebase,
       * on affiche le fallback PWA.
       */
      if (isStandalone) {

        showFallback();

        return;
      }
    }

    showButton();

  } catch (err) {

    console.error(
      '[AUTH] Erreur checkRedirectResult:',
      err
    );

    localStorage.removeItem(
      REDIRECT_KEY
    );

    /*
     * Si Firebase a quand même restauré l'utilisateur,
     * on tente une dernière récupération.
     */
    try {

      const currentUser =
        await waitForFirebaseAuth();

      if (currentUser) {

        console.log(
          '[AUTH] Récupération de secours de la session Firebase.'
        );

        await completeSignIn(
          currentUser
        );

        return;
      }

    } catch (fallbackError) {

      console.error(
        '[AUTH] Échec récupération session:',
        fallbackError
      );
    }

    if (isStandalone) {

      showFallback();

      return;
    }

    showError(
      translateAuthError(err)
    );
  }
}

/* ==========================================================================
   OUVRIR LA CONNEXION DANS LE NAVIGATEUR
   ========================================================================== */

openBrowserBtn.addEventListener(
  'click',
  () => {

    window.open(
      window.location.href.split('#')[0],
      '_blank',
      'noopener'
    );

  }
);

/* ==========================================================================
   ÉVÉNEMENTS
   ========================================================================== */

googleBtn.addEventListener(
  'click',
  startGoogleSignIn
);

retryBtn.addEventListener(
  'click',
  showButton
);

/* ==========================================================================
   INITIALISATION
   ========================================================================== */

checkRedirectResult();
