import { auth, db } from '/js/firebase-config.js';

import {
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

import {
  doc,
  getDoc
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

import {
  buildCountryOptionsHtml,
  cleanPhoneDigits
} from '/js/phone-countries.js';

const API_BASE_URL = 'https://kontra-africa.onrender.com';

const CHECKOUT_TIMEOUT_MS = 60000;

// Temps pendant lequel on attend Firebase lorsque Google vient
// juste de rediriger l'utilisateur.
const AUTH_RESTORE_TIMEOUT_MS = 15000;

// Clé utilisée par login.js avant le redirect Google.
const REDIRECT_KEY = 'kontra_auth_pending';


// ============================================================
// ABONNEMENT
// ============================================================

function isSubscriptionBlocked(userData) {

  const status = userData.subscriptionStatus;

  if (
    status === 'expired' ||
    status === 'cancelled'
  ) {
    return true;
  }

  if (status === 'trial') {

    const trialEnd = toDate(
      userData.trialEndDate
    );

    if (
      trialEnd &&
      new Date() > trialEnd
    ) {
      return true;
    }
  }

  return false;
}


// ============================================================
// CONVERSION DATE
// ============================================================

function toDate(value) {

  if (!value) {
    return null;
  }

  if (
    typeof value.toDate === 'function'
  ) {
    return value.toDate();
  }

  const parsed = new Date(value);

  return isNaN(parsed.getTime())
    ? null
    : parsed;
}


// ============================================================
// ATTENDRE QUE FIREBASE RESTAURE LA SESSION
// ============================================================

function waitForAuthUser() {

  return new Promise((resolve) => {

    let resolved = false;
    let unsubscribe = null;

    const finish = (user) => {

      if (resolved) {
        return;
      }

      resolved = true;

      if (unsubscribe) {
        unsubscribe();
      }

      clearTimeout(timeoutId);

      resolve(user);
    };


    unsubscribe = onAuthStateChanged(
      auth,
      (user) => {

        console.log(
          '🔐 Firebase Auth State:',
          user
            ? `connecté (${user.email})`
            : 'aucun utilisateur'
        );

        // ----------------------------------------------------
        // UTILISATEUR TROUVÉ
        // ----------------------------------------------------

        if (user) {
          finish(user);
          return;
        }

        // ----------------------------------------------------
        // PAS D'UTILISATEUR
        //
        // Si Google vient juste de rediriger l'utilisateur,
        // Firebase peut avoir besoin de quelques secondes pour
        // restaurer la session.
        // ----------------------------------------------------

        const redirectPending =
          localStorage.getItem(
            REDIRECT_KEY
          ) === '1';

        if (!redirectPending) {

          finish(null);
        }

        // Sinon on NE redirige PAS immédiatement.
        // Le timeout ci-dessous laisse Firebase le temps
        // de restaurer la session.
      }
    );


    const timeoutId = setTimeout(
      () => {

        console.warn(
          '⏱️ Firebase n’a pas restauré la session dans le délai prévu.'
        );

        finish(null);

      },
      AUTH_RESTORE_TIMEOUT_MS
    );

  });
}


// ============================================================
// VÉRIFICATION DE L'ACCÈS
// ============================================================

export function requireAppAccess() {

  return new Promise(
    async (resolve) => {

      try {

        console.log(
          '🔐 Vérification de l’accès à Kontra-Africa...'
        );

        const user =
          await waitForAuthUser();


        // ----------------------------------------------------
        // AUCUN UTILISATEUR
        // ----------------------------------------------------

        if (!user) {

          console.warn(
            '⚠️ Aucun utilisateur Firebase connecté.'
          );

          localStorage.removeItem(
            REDIRECT_KEY
          );

          window.location.href =
            '/login.html';

          return;
        }


        // ----------------------------------------------------
        // UTILISATEUR TROUVÉ
        // ----------------------------------------------------

        console.log(
          '✅ Utilisateur Firebase trouvé:',
          user.email
        );


        // Le redirect Google est maintenant terminé.
        localStorage.removeItem(
          REDIRECT_KEY
        );


        // ----------------------------------------------------
        // RÉCUPÉRER LE DOCUMENT FIRESTORE
        // ----------------------------------------------------

        let userSnap = null;

        // On laisse aussi quelques tentatives au cas où
        // login.js vient juste de créer l'utilisateur.
        for (
          let attempt = 1;
          attempt <= 3;
          attempt++
        ) {

          try {

            userSnap = await getDoc(
              doc(
                db,
                'users',
                user.uid
              )
            );

            if (
              userSnap.exists()
            ) {
              break;
            }

            console.warn(
              `⚠️ Document utilisateur absent. Tentative ${attempt}/3`
            );

            if (attempt < 3) {

              await new Promise(
                (r) =>
                  setTimeout(r, 1500)
              );
            }

          } catch (firestoreError) {

            console.error(
              'Erreur Firestore:',
              firestoreError
            );

            if (attempt === 3) {
              throw firestoreError;
            }

            await new Promise(
              (r) =>
                setTimeout(r, 1500)
            );
          }
        }


        // ----------------------------------------------------
        // DOCUMENT FIRESTORE INTROUVABLE
        // ----------------------------------------------------

        if (
          !userSnap ||
          !userSnap.exists()
        ) {

          console.error(
            '❌ Utilisateur Firebase connecté mais document Firestore absent:',
            user.uid
          );

          renderMissingUserError();

          resolve(null);

          return;
        }


        // ----------------------------------------------------
        // DONNÉES UTILISATEUR
        // ----------------------------------------------------

        const userData =
          userSnap.data();


        console.log(
          '✅ Données utilisateur récupérées:',
          userData
        );


        // ----------------------------------------------------
        // ABONNEMENT BLOQUÉ
        // ----------------------------------------------------

        if (
          isSubscriptionBlocked(
            userData
          )
        ) {

          console.log(
            '⚠️ Abonnement expiré ou bloqué.'
          );

          renderPaywall(user);

          resolve(null);

          return;
        }


        // ----------------------------------------------------
        // ACCÈS AUTORISÉ
        // ----------------------------------------------------

        console.log(
          '✅ Accès à l’application autorisé.'
        );

        resolve({
          user,
          userData
        });

      } catch (err) {

        console.error(
          '❌ Erreur de vérification d’accès:',
          err
        );

        renderFatalError();

        resolve(null);
      }
    }
  );
}


// ============================================================
// DÉCONNEXION
// ============================================================

export async function logout() {

  const {
    signOut
  } = await import(
    'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js'
  );

  await signOut(auth);

  localStorage.removeItem(
    REDIRECT_KEY
  );

  window.location.href =
    '/login.html';
}


// ============================================================
// UTILISATEUR FIREBASE EXISTANT MAIS FIRESTORE ABSENT
// ============================================================

function renderMissingUserError() {

  document.body.innerHTML = `

    <main class="paywall">

      <div class="paywall__card">

        <img
          src="/logo.webp"
          alt="Kontra-Africa"
          class="paywall__logo"
        >

        <p class="eyebrow">
          Configuration du compte
        </p>

        <h1 class="paywall__title">
          Votre compte est presque prêt
        </h1>

        <p class="paywall__text">
          Votre connexion Google a réussi, mais
          votre espace Kontra-Africa n'a pas encore
          été complètement initialisé.
        </p>

        <button
          type="button"
          class="btn btn-primary"
          onclick="window.location.href='/login.html'"
        >
          Retourner à la connexion
        </button>

      </div>

    </main>

  `;
}


// ============================================================
// PAYWALL
// ============================================================

function renderPaywall(user) {

  document.body.innerHTML = `

    <main class="paywall">

      <div class="paywall__card">

        <img
          src="/logo.webp"
          alt="Kontra-Africa"
          class="paywall__logo"
        >

        <p class="eyebrow">
          Abonnement
        </p>

        <h1 class="paywall__title">
          Votre période d'essai est terminée
        </h1>

        <p class="paywall__text">
          Abonnez-vous pour continuer à créer des
          contrats, les faire signer et suivre vos
          finances sur Kontra-Africa.
        </p>

        <div class="paywall__price">

          <span class="paywall__currency">
            $
          </span>

          5

          <span class="paywall__period">
            /mois
          </span>

        </div>


        <div class="paywall__phone">

          <label
            for="paywallCountry"
            class="paywall__phone-label"
          >
            Numéro Mobile Money (pour le paiement)
          </label>

          <div class="paywall__phone-row">

            <select
              id="paywallCountry"
              class="paywall__phone-select"
            >
              ${buildCountryOptionsHtml()}
            </select>

            <span
              class="paywall__phone-divider"
              aria-hidden="true"
            ></span>

            <input
              type="tel"
              id="paywallPhone"
              class="paywall__phone-input"
              placeholder="8123456789"
              inputmode="numeric"
              autocomplete="tel"
            >

          </div>

          <p
            class="paywall__phone-error"
            id="paywallPhoneError"
            hidden
          >
            Entrez un numéro Mobile Money valide
            pour continuer.
          </p>

        </div>


        <div
          class="paywall__zone"
          id="paywallZone"
        >

          <button
            type="button"
            id="checkoutBtn"
            class="btn btn-primary btn-lg paywall__cta"
          >
            S'abonner maintenant
          </button>

        </div>


        <p class="paywall__trust">
          🔒 Paiement sécurisé via Mobile Money —
          vous restez connecté à ce compte
        </p>


        <div class="paywall__license">

          <p class="paywall__license-question">
            Tu as déjà payé mais tu n'as pas accès ?
          </p>

          <label
            for="paywallLicenseKey"
            class="paywall__license-label"
          >
            Entre ta clé de licence
            (envoyée dans ton email Chariow)
          </label>

          <div class="paywall__license-row">

            <input
              type="text"
              id="paywallLicenseKey"
              class="paywall__license-input"
              placeholder="ABC-123-XYZ-789"
              autocomplete="off"
            >

            <button
              type="button"
              id="paywallVerifyLicenseBtn"
              class="btn btn-secondary"
            >
              Vérifier
            </button>

          </div>

          <p
            class="paywall__license-error"
            id="paywallLicenseError"
            hidden
          ></p>

        </div>


        <button
          type="button"
          id="paywallLogout"
          class="btn btn-ghost paywall__logout"
        >
          Se déconnecter
        </button>

      </div>

    </main>

  `;


  // ==========================================================
  // CSS
  // ==========================================================

  if (
    !document.querySelector(
      'link[href="/css/app.css"]'
    )
  ) {

    const link =
      document.createElement('link');

    link.rel =
      'stylesheet';

    link.href =
      '/css/app.css';

    document.head.appendChild(link);
  }


  // ==========================================================
  // ELEMENTS
  // ==========================================================

  const zone =
    document.getElementById(
      'paywallZone'
    );

  const checkoutBtn =
    document.getElementById(
      'checkoutBtn'
    );

  const logoutBtn =
    document.getElementById(
      'paywallLogout'
    );

  const verifyLicenseBtn =
    document.getElementById(
      'paywallVerifyLicenseBtn'
    );

  const licenseInput =
    document.getElementById(
      'paywallLicenseKey'
    );

  const licenseError =
    document.getElementById(
      'paywallLicenseError'
    );


  verifyLicenseBtn.addEventListener(
    'click',
    () =>
      verifyLicense(
        user,
        licenseInput,
        licenseError,
        verifyLicenseBtn
      )
  );


  checkoutBtn.addEventListener(
    'click',
    () => {

      const phoneNumber =
        cleanPhoneDigits(
          document.getElementById(
            'paywallPhone'
          ).value
        );

      const countryCode =
        document.getElementById(
          'paywallCountry'
        ).value;

      const phoneErrorEl =
        document.getElementById(
          'paywallPhoneError'
        );


      if (
        phoneNumber.length < 8
      ) {

        phoneErrorEl.hidden =
          false;

        return;
      }


      phoneErrorEl.hidden =
        true;


      startCheckout(
        user,
        zone,
        {
          number:
            phoneNumber,

          countryCode
        }
      );

    }
  );


  logoutBtn.addEventListener(
    'click',
    logout
  );
}


// ============================================================
// CHECKOUT
// ============================================================

async function startCheckout(
  user,
  zone,
  phone,
  isRetryAttempt = false
) {

  zone.innerHTML = `

    <div class="paywall-state">

      <span
        class="spinner"
        aria-hidden="true"
      ></span>

      <p>
        Préparation du paiement…
        (cela peut prendre jusqu'à 1 minute
        la première fois)
      </p>

    </div>

  `;


  const controller =
    new AbortController();

  const timeoutId =
    setTimeout(
      () =>
        controller.abort(),
      CHECKOUT_TIMEOUT_MS
    );


  try {

    const idToken =
      await user.getIdToken();

    const response =
      await fetch(
        `${API_BASE_URL}/api/checkout`,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',

            'Authorization':
              `Bearer ${idToken}`
          },

          body: JSON.stringify({

            email:
              user.email || '',

            firstName:
              user.displayName
                ? user.displayName
                    .split(' ')[0]
                : 'Client',

            lastName:
              user.displayName
                ? user.displayName
                    .split(' ')
                    .slice(1)
                    .join(' ') ||
                  'Inconnu'
                : 'Inconnu',

            phone: {
              number:
                phone.number,

              countryCode:
                phone.countryCode
            }

          }),

          signal:
            controller.signal
        }
      );


    // Render 502 / 503
    if (
      (
        response.status === 502 ||
        response.status === 503
      ) &&
      !isRetryAttempt
    ) {

      clearTimeout(
        timeoutId
      );

      await new Promise(
        (r) =>
          setTimeout(
            r,
            4000
          )
      );

      return startCheckout(
        user,
        zone,
        phone,
        true
      );
    }


    if (!response.ok) {

      const errBody =
        await response
          .json()
          .catch(
            () => ({})
          );

      throw new Error(
        errBody.message ||
        errBody.error ||
        `checkout a répondu avec le statut ${response.status}`
      );
    }


    const data =
      await response.json();


    if (
      data &&
      data.reactivated
    ) {

      window.location.href =
        '/dashboard.html';

      return;
    }


    if (
      !data ||
      !data.checkoutUrl
    ) {

      throw new Error(
        'Aucune URL de paiement reçue.'
      );
    }


    window.location.href =
      data.checkoutUrl;

  } catch (err) {

    console.error(
      'Erreur checkout :',
      err
    );


    const message =
      err.name === 'AbortError'

        ? "Le serveur met plus de temps que prévu à démarrer. Réessayez dans un instant."

        : (
          err.message ||
          "Impossible de préparer le paiement. Réessayez."
        );


    // IMPORTANT (sécurité) : "message" peut provenir du corps de réponse
    // de notre propre API, qui elle-même relaie parfois un message brut
    // renvoyé par l'API Chariow (voir functions/src/checkout.js). On ne
    // doit donc JAMAIS l'injecter directement dans du innerHTML : si ce
    // texte contenait un jour du HTML/JS, il s'exécuterait dans le
    // navigateur de l'utilisateur (XSS). On construit le HTML statique
    // (sans donnée dynamique) puis on assigne le message via textContent,
    // qui échappe automatiquement tout contenu.
    zone.innerHTML = `

      <div
        class="paywall-state paywall-state--error"
        role="alert"
      >

        <p id="checkoutErrorMessage"></p>

        <button
          type="button"
          id="checkoutRetry"
          class="btn btn-secondary"
        >
          Réessayer
        </button>

      </div>

    `;

    document.getElementById(
      'checkoutErrorMessage'
    ).textContent = message;


    document
      .getElementById(
        'checkoutRetry'
      )
      .addEventListener(
        'click',
        () =>
          startCheckout(
            user,
            zone,
            phone
          )
      );

  } finally {

    clearTimeout(
      timeoutId
    );
  }
}


// ============================================================
// VÉRIFICATION LICENCE
// ============================================================

async function verifyLicense(
  user,
  inputEl,
  errorEl,
  buttonEl
) {

  errorEl.hidden =
    true;

  const licenseKey =
    inputEl.value.trim();


  if (!licenseKey) {

    errorEl.textContent =
      "Entre la clé de licence reçue par email après ton paiement.";

    errorEl.hidden =
      false;

    return;
  }


  buttonEl.disabled =
    true;

  buttonEl.textContent =
    'Vérification…';


  try {

    const idToken =
      await user.getIdToken();

    const response =
      await fetch(
        `${API_BASE_URL}/api/verify-license`,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',

            'Authorization':
              `Bearer ${idToken}`
          },

          body: JSON.stringify({
            licenseKey
          })
        }
      );


    const data =
      await response.json();


    if (
      data &&
      data.valid &&
      data.reactivated
    ) {

      window.location.reload();

      return;
    }


    errorEl.textContent =
      (
        data &&
        data.error
      ) ||
      "Clé de licence invalide.";

    errorEl.hidden =
      false;

  } catch (err) {

    console.error(
      'Erreur de vérification de licence :',
      err
    );

    errorEl.textContent =
      "Impossible de vérifier la clé pour le moment. Réessaie dans un instant.";

    errorEl.hidden =
      false;

  } finally {

    buttonEl.disabled =
      false;

    buttonEl.textContent =
      'Vérifier';
  }
}


// ============================================================
// ERREUR FATALE
// ============================================================

function renderFatalError() {

  document.body.innerHTML = `

    <main class="paywall">

      <div class="paywall__card">

        <img
          src="/logo.webp"
          alt="Kontra-Africa"
          class="paywall__logo"
        >

        <h1 class="paywall__title">
          Impossible de charger votre compte
        </h1>

        <p class="paywall__text">
          Vérifiez votre connexion internet,
          puis rechargez la page.
        </p>

        <button
          type="button"
          class="btn btn-primary"
          onclick="window.location.reload()"
        >
          Recharger
        </button>

      </div>

    </main>

  `;
}
