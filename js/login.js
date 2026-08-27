import { auth, googleProvider } from '/js/firebase-config.js';

import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged
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
   SYNCHRONISATION DU BOUTON GOOGLE
   ========================================================================== */

/*
 * Le HTML commence volontairement avec :
 *
 * disabled
 *
 * On synchronise ensuite avec l'état réel de la checkbox.
 */

function syncGoogleButton() {

  if (
    !googleBtn ||
    !termsCheckbox
  ) {
    return;
  }

  googleBtn.disabled =
    !termsCheckbox.checked;

}


/* ==========================================================================
   ÉTATS VISUELS
   ========================================================================== */

function showButton() {

  googleBtn.hidden = false;

  loadingState.hidden = true;

  errorState.hidden = true;

  openBrowserFallback.hidden = true;

  syncGoogleButton();
}


function showLoading(label) {

  googleBtn.hidden = true;

  loadingState.hidden = false;

  errorState.hidden = true;

  openBrowserFallback.hidden = true;

  loadingLabel.textContent =
    label;
}


function showError(message) {

  googleBtn.hidden = true;

  loadingState.hidden = true;

  errorState.hidden = false;

  openBrowserFallback.hidden = true;

  errorMessage.textContent =
    message;
}


function showFallback() {

  googleBtn.hidden = true;

  loadingState.hidden = true;

  errorState.hidden = true;

  openBrowserFallback.hidden = false;
}


/* ==========================================================================
   CHECKBOX
   ========================================================================== */

termsCheckbox.addEventListener(
  'change',
  syncGoogleButton
);

termsCheckbox.addEventListener(
  'input',
  syncGoogleButton
);

window.addEventListener(
  'pageshow',
  syncGoogleButton
);

window.addEventListener(
  'focus',
  syncGoogleButton
);


/*
 * Synchronisation immédiate.
 */

syncGoogleButton();


/*
 * Certains navigateurs mobiles restaurent l'état d'un formulaire
 * légèrement après le chargement.
 */

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


/* ==========================================================================
   TRADUCTION DES ERREURS FIREBASE
   ========================================================================== */

function translateAuthError(error) {

  const code =
    error &&
    error.code;

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
        "Ce domaine n'est pas autorisé dans Firebase Authentication."
      );


    case 'auth/operation-not-allowed':

      return (
        "La connexion avec Google n'est pas activée dans Firebase."
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
            JSON.stringify(
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


/* ==========================================================================
   RESTAURATION DE LA SESSION FIREBASE
   ========================================================================== */

function waitForFirebaseAuth() {

  return new Promise(
    (resolve) => {

      let finished = false;

      let unsubscribe = null;


      const finish = (
        user
      ) => {

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
          user || null
        );
      };


      const timeoutId =
        setTimeout(
          () => {

            console.warn(
              '[AUTH] Timeout restauration Firebase.'
            );

            finish(
              auth.currentUser
            );

          },
          AUTH_RESTORE_TIMEOUT_MS
        );


      unsubscribe =
        onAuthStateChanged(
          auth,
          (user) => {

            console.log(
              '[AUTH] État Firebase:',
              user
                ? 'connecté'
                : 'non connecté'
            );

            finish(user);
          },
          (error) => {

            console.error(
              '[AUTH] Erreur restauration Firebase:',
              error
            );

            finish(
              auth.currentUser
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
      '[AUTH] Utilisateur connecté:',
      firebaseUser.uid
    );


    /*
     * Maintenant seulement :
     * création / initialisation du profil backend.
     */

    await initUserOnBackend(
      firebaseUser
    );


    /*
     * La redirection est terminée.
     */

    localStorage.removeItem(
      REDIRECT_KEY
    );


    console.log(
      '[AUTH] Connexion terminée.'
    );


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
   * Sécurité :
   * les CGU doivent être acceptées.
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


    /* ----------------------------------------------------------------------
       MOBILE
       ---------------------------------------------------------------------- */

    if (isMobile) {

      /*
       * IMPORTANT :
       *
       * On écrit le marqueur AVANT le redirect.
       */

      localStorage.setItem(
        REDIRECT_KEY,
        '1'
      );


      console.log(
        '[AUTH] Lancement connexion Google mobile.'
      );


      await signInWithRedirect(
        auth,
        googleProvider
      );


      /*
       * La page va être rechargée.
       */

      return;
    }


    /* ----------------------------------------------------------------------
       ORDINATEUR
       ---------------------------------------------------------------------- */

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
   TRAITEMENT DU RETOUR GOOGLE
   ========================================================================== */

/*
 * C'EST ICI QUE NOUS CORRIGEONS TON PROBLÈME.
 *
 * Si l'utilisateur arrive normalement sur login.html :
 *
 *     REDIRECT_KEY = absent
 *
 * alors on NE montre PAS :
 *
 *     "Préparation de votre espace..."
 *
 * et on NE lance PAS initUser.
 *
 * On affiche simplement le bouton.
 */

async function checkRedirectResult() {

  const wasPending =
    localStorage.getItem(
      REDIRECT_KEY
    ) === '1';


  /* ------------------------------------------------------------------------
     CAS NORMAL :
     aucune connexion Google n'a été lancée.
     ------------------------------------------------------------------------ */

  if (!wasPending) {

    /*
     * NE PAS afficher de loading.
     * NE PAS appeler initUser.
     * NE PAS utiliser currentUser pour démarrer automatiquement une connexion.
     */

    showButton();

    return;
  }


  /* ------------------------------------------------------------------------
     CAS REDIRECT :
     une connexion Google mobile était réellement en cours.
     ------------------------------------------------------------------------ */

  showLoading(
    'Vérification de votre connexion…'
  );


  try {

    /*
     * On remet la persistance locale.
     */

    await setPersistence(
      auth,
      browserLocalPersistence
    );


    /*
     * Récupération du résultat Google.
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
    }


    /* ----------------------------------------------------------------------
       CAS 1 :
       Google a retourné un utilisateur.
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
       CAS 2 :
       getRedirectResult() ne donne rien.
       On laisse Firebase restaurer sa session.
       ---------------------------------------------------------------------- */

    const restoredUser =
      await waitForFirebaseAuth();


    if (restoredUser) {

      console.log(
        '[AUTH] Session Firebase restaurée après redirect.'
      );


      await completeSignIn(
        restoredUser
      );


      return;
    }


    /* ----------------------------------------------------------------------
       CAS 3 :
       aucune session après un vrai redirect.
       ---------------------------------------------------------------------- */

    console.warn(
      '[AUTH] Aucun utilisateur après le redirect Google.'
    );


    localStorage.removeItem(
      REDIRECT_KEY
    );


    if (isStandalone) {

      showFallback();

      return;
    }


    showError(
      "La connexion Google n'a pas pu être finalisée. Réessayez."
    );

  } catch (err) {

    console.error(
      '[AUTH] Erreur traitement redirect:',
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


/* ==========================================================================
   OUVRIR DANS LE NAVIGATEUR
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

    /*
     * Le bouton Réessayer doit simplement remettre
     * l'écran de login normal.
     */

    localStorage.removeItem(
      REDIRECT_KEY
    );

    showButton();
  }
);


/* ==========================================================================
   INITIALISATION
   ========================================================================== */

console.log(
  '[AUTH] login.js chargé.'
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
  '[AUTH] Redirect en attente:',
  localStorage.getItem(
    REDIRECT_KEY
  )
);


/*
 * Affichage immédiat de l'interface.
 *
 * Puis checkRedirectResult() décidera uniquement s'il y a
 * réellement un redirect Google en cours.
 */

showButton();


/*
 * Traitement du retour Google uniquement si nécessaire.
 */

checkRedirectResult();
