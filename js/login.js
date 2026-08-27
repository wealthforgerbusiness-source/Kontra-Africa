import { auth, googleProvider } from '/js/firebase-config.js';

import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';


/* ==========================================================================
   CONFIGURATION
   ========================================================================== */

const API_BASE_URL = 'https://kontra-africa.onrender.com';

const REDIRECT_KEY = 'kontra_auth_pending';

const INIT_USER_TIMEOUT_MS = 60000;

const AUTH_RESTORE_TIMEOUT_MS = 15000;


/* ==========================================================================
   ÉLÉMENTS HTML
   ========================================================================== */

const googleBtn =
  document.getElementById('googleBtn');

const termsCheckbox =
  document.getElementById('termsCheckbox');

const loadingState =
  document.getElementById('loadingState');

const loadingLabel =
  document.getElementById('loadingLabel');

const errorState =
  document.getElementById('errorState');

const errorMessage =
  document.getElementById('errorMessage');

const retryBtn =
  document.getElementById('retryBtn');

const openBrowserFallback =
  document.getElementById('openBrowserFallback');

const openBrowserBtn =
  document.getElementById('openBrowserBtn');


/* ==========================================================================
   DÉTECTION MOBILE
   ========================================================================== */

const isMobile =
  /Android|iPhone|iPad|iPod/i.test(
    navigator.userAgent
  );


/* ==========================================================================
   DÉTECTION PWA
   ========================================================================== */

const isStandalone =
  window.matchMedia(
    '(display-mode: standalone)'
  ).matches ||
  window.navigator.standalone === true;


/* ==========================================================================
   VÉRIFICATION DES ÉLÉMENTS
   ========================================================================== */

if (
  !googleBtn ||
  !termsCheckbox ||
  !loadingState ||
  !loadingLabel ||
  !errorState ||
  !errorMessage ||
  !retryBtn ||
  !openBrowserFallback ||
  !openBrowserBtn
) {
  console.error(
    '[AUTH] Un ou plusieurs éléments HTML de connexion sont introuvables.'
  );
}


/* ==========================================================================
   SYNCHRONISATION DE LA CHECKBOX AVEC LE BOUTON GOOGLE
   ========================================================================== */

/*
 * IMPORTANT :
 *
 * login.html démarre avec :
 *
 * <button ... disabled>
 *
 * Sur certains téléphones, le navigateur peut restaurer visuellement
 * la checkbox comme cochée sans déclencher immédiatement "change".
 *
 * On ne dépend donc plus uniquement de l'événement change.
 */

function syncGoogleButton() {

  if (
    !googleBtn ||
    !termsCheckbox
  ) {
    return;
  }

  const accepted =
    termsCheckbox.checked === true;

  googleBtn.disabled =
    !accepted;

  console.log(
    '[AUTH] Checkbox:',
    accepted,
    '| Google button disabled:',
    googleBtn.disabled
  );
}


/*
 * Événement classique.
 */
termsCheckbox.addEventListener(
  'change',
  syncGoogleButton
);


/*
 * Événement supplémentaire sur mobile.
 */
termsCheckbox.addEventListener(
  'input',
  syncGoogleButton
);


/*
 * Le navigateur peut restaurer les formulaires après le chargement.
 */
window.addEventListener(
  'pageshow',
  syncGoogleButton
);


/*
 * Lorsque la page reprend le focus.
 */
window.addEventListener(
  'focus',
  syncGoogleButton
);


/*
 * Première synchronisation.
 */
syncGoogleButton();


/*
 * Vérifications supplémentaires contre la restauration automatique
 * du navigateur / PWA.
 */
setTimeout(
  syncGoogleButton,
  50
);

setTimeout(
  syncGoogleButton,
  100
);

setTimeout(
  syncGoogleButton,
  300
);

setTimeout(
  syncGoogleButton,
  500
);

setTimeout(
  syncGoogleButton,
  1000
);

setTimeout(
  syncGoogleButton,
  2000
);


/* ==========================================================================
   ÉTATS VISUELS
   ========================================================================== */

function showButton() {

  googleBtn.hidden = false;

  loadingState.hidden = true;

  errorState.hidden = true;

  openBrowserFallback.hidden = true;

  /*
   * Très important :
   * on resynchronise ici après les opérations Firebase.
   */
  syncGoogleButton();
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
   TRADUCTION DES ERREURS FIREBASE
   ========================================================================== */

function translateAuthError(error) {

  const code =
    error && error.code;

  switch (code) {

    case 'auth/popup-closed-by-user':

    case 'auth/cancelled-popup-request':

      return (
        "La fenêtre de connexion a été fermée avant la fin. Réessayez."
      );


    case 'auth/network-request-failed':

      return (
        "Problème de connexion internet. Vérifiez votre réseau et réessayez."
      );


    case 'auth/popup-blocked':

      return (
        "La fenêtre de connexion a été bloquée par le navigateur. Réessayez."
      );


    case 'auth/unauthorized-domain':

      return (
        "Ce domaine n'est pas autorisé par Firebase Authentication."
      );


    case 'auth/operation-not-allowed':

      return (
        "La connexion Google n'est pas activée dans Firebase."
      );


    default:

      console.error(
        '[AUTH] Erreur Firebase:',
        error
      );

      return (
        "La connexion avec Google a échoué. Réessayez."
      );
  }
}


/* ==========================================================================
   INITIALISATION UTILISATEUR SUR LE BACKEND
   ========================================================================== */

async function initUserOnBackend(
  firebaseUser
) {

  const payload = {

    uid:
      firebaseUser.uid,

    email:
      firebaseUser.email,

    displayName:
      firebaseUser.displayName,

    photoURL:
      firebaseUser.photoURL
  };


  showLoading(
    "Préparation de votre espace… (cela peut prendre jusqu'à 1 minute la première fois)"
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

          body:
            JSON.stringify(payload),

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


/* ==========================================================================
   ATTEND LA RESTAURATION FIREBASE
   ========================================================================== */

/*
 * Correction importante pour mobile/PWA.
 *
 * getRedirectResult() peut parfois retourner null alors que Firebase
 * est encore en train de restaurer auth.currentUser.
 *
 * On attend donc explicitement que Firebase ait terminé.
 */

async function waitForFirebaseAuth() {

  /*
   * Firebase moderne possède authStateReady().
   */

  if (
    typeof auth.authStateReady ===
    'function'
  ) {

    try {

      await auth.authStateReady();

      console.log(
        '[AUTH] Firebase a terminé la restauration de la session.'
      );

      return (
        auth.currentUser ||
        null
      );

    } catch (error) {

      console.warn(
        '[AUTH] authStateReady() a rencontré une erreur:',
        error
      );
    }
  }


  /*
   * Fallback avec onAuthStateChanged.
   */

  return new Promise(
    (resolve) => {

      let finished = false;

      let unsubscribe = null;


      const timeoutId =
        setTimeout(
          () => {

            if (finished) {
              return;
            }

            finished = true;

            if (unsubscribe) {
              unsubscribe();
            }

            resolve(
              auth.currentUser ||
              null
            );

          },
          AUTH_RESTORE_TIMEOUT_MS
        );


      unsubscribe =
        auth.onAuthStateChanged(
          (user) => {

            if (finished) {
              return;
            }

            finished = true;

            clearTimeout(
              timeoutId
            );

            if (unsubscribe) {
              unsubscribe();
            }

            resolve(
              user ||
              null
            );
          }
        );
    }
  );
}


/* ==========================================================================
   FINALISATION DE LA CONNEXION
   ========================================================================== */

async function completeSignIn(
  firebaseUser
) {

  if (!firebaseUser) {

    throw new Error(
      'NO_FIREBASE_USER'
    );
  }


  try {

    console.log(
      '[AUTH] Utilisateur Firebase:',
      firebaseUser.uid
    );


    await initUserOnBackend(
      firebaseUser
    );


    /*
     * On supprime le marqueur uniquement lorsque tout est terminé.
     */

    localStorage.removeItem(
      REDIRECT_KEY
    );


    console.log(
      '[AUTH] Connexion réussie.'
    );


    /*
     * replace() évite de revenir sur la page login avec le bouton
     * retour du navigateur.
     */

    window.location.replace(
      '/dashboard.html'
    );

  } catch (err) {

    console.error(
      '[AUTH] Erreur init-user:',
      err
    );


    localStorage.removeItem(
      REDIRECT_KEY
    );


    if (
      err.message ===
      'TIMEOUT_INIT_USER'
    ) {

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
   CONNEXION GOOGLE
   ========================================================================== */

async function startGoogleSignIn() {

  /*
   * Vérification de sécurité.
   */

  if (
    !termsCheckbox.checked
  ) {

    syncGoogleButton();

    return;
  }


  showLoading(
    'Connexion à Google…'
  );


  try {

    /*
     * On conserve la persistance locale.
     */

    await setPersistence(
      auth,
      browserLocalPersistence
    );


    /*
     * MOBILE
     *
     * On conserve ton système Redirect.
     */

    if (isMobile) {

      localStorage.setItem(
        REDIRECT_KEY,
        '1'
      );


      console.log(
        '[AUTH] Mobile détecté : utilisation de signInWithRedirect().'
      );


      await signInWithRedirect(
        auth,
        googleProvider
      );


      /*
       * La page est rechargée après Google.
       */

      return;
    }


    /*
     * ORDINATEUR
     *
     * On conserve ton système Popup.
     */

    const result =
      await signInWithPopup(
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

      return;
    }


    /*
     * Sécurité supplémentaire.
     */

    const currentUser =
      await waitForFirebaseAuth();


    if (currentUser) {

      await completeSignIn(
        currentUser
      );

      return;
    }


    throw new Error(
      'NO_FIREBASE_USER'
    );

  } catch (err) {

    console.error(
      '[AUTH] Erreur connexion Google:',
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
     * Persistance locale.
     */

    await setPersistence(
      auth,
      browserLocalPersistence
    );


    /*
     * Première tentative :
     * récupérer le résultat du redirect.
     */

    let result = null;


    try {

      result =
        await getRedirectResult(
          auth
        );

    } catch (redirectError) {

      console.error(
        '[AUTH] getRedirectResult() erreur:',
        redirectError
      );

      /*
       * IMPORTANT :
       *
       * On ne redirige PAS immédiatement vers login.
       * On vérifie d'abord auth.currentUser.
       */
    }


    /* ----------------------------------------------------------------------
       CAS 1 : résultat Google récupéré
       ---------------------------------------------------------------------- */

    if (
      result &&
      result.user
    ) {

      console.log(
        '[AUTH] Résultat Google récupéré.'
      );


      await completeSignIn(
        result.user
      );


      return;
    }


    /* ----------------------------------------------------------------------
       CAS 2 : getRedirectResult() null MAIS session Firebase disponible
       ---------------------------------------------------------------------- */

    const restoredUser =
      await waitForFirebaseAuth();


    if (restoredUser) {

      console.log(
        '[AUTH] Session Firebase restaurée avec succès.'
      );


      await completeSignIn(
        restoredUser
      );


      return;
    }


    /* ----------------------------------------------------------------------
       CAS 3 : aucune session
       ---------------------------------------------------------------------- */

    if (wasPending) {

      console.warn(
        '[AUTH] Une connexion redirect était attendue, mais aucune session n’a été restaurée.'
      );


      localStorage.removeItem(
        REDIRECT_KEY
      );


      /*
       * Si nous sommes dans la PWA installée,
       * on affiche le fallback navigateur.
       */

      if (isStandalone) {

        showFallback();

        return;
      }
    }


    /*
     * Retour normal sur login.
     */

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
     * Dernière tentative :
     * vérifier directement auth.currentUser.
     */

    try {

      const currentUser =
        await waitForFirebaseAuth();


      if (currentUser) {

        console.log(
          '[AUTH] Session récupérée lors de la dernière tentative.'
        );


        await completeSignIn(
          currentUser
        );


        return;
      }

    } catch (fallbackError) {

      console.error(
        '[AUTH] Impossible de restaurer Firebase:',
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

    /*
     * Ouvre login.html dans un nouvel onglet/fenêtre du navigateur.
     */

    window.open(
      window.location.href.split('#')[0],
      '_blank',
      'noopener'
    );
  }
);


/* ==========================================================================
   BOUTON GOOGLE
   ========================================================================== */

googleBtn.addEventListener(
  'click',
  startGoogleSignIn
);


/* ==========================================================================
   BOUTON RÉESSAYER
   ========================================================================== */

retryBtn.addEventListener(
  'click',
  () => {

    showButton();

    syncGoogleButton();
  }
);


/* ==========================================================================
   INITIALISATION
   ========================================================================== */

console.log(
  '[AUTH] Initialisation login.js'
);

console.log(
  '[AUTH] Mobile:',
  isMobile
);

console.log(
  '[AUTH] PWA standalone:',
  isStandalone
);

console.log(
  '[AUTH] Checkbox initialement cochée:',
  termsCheckbox.checked
);


/*
 * Synchronisation immédiate.
 */

syncGoogleButton();


/*
 * Puis traitement Firebase.
 */

checkRedirectResult();
