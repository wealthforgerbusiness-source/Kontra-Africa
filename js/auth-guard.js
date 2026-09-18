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
  cleanPhoneDigits,
  getDialCode,
  getFlagImage,
  DEFAULT_COUNTRY_CODE
} from '/js/phone-countries.js';

const API_BASE_URL = 'https://kontra-africa.onrender.com';

const CHECKOUT_TIMEOUT_MS = 60000;

// Temps pendant lequel on attend Firebase lorsque Google vient
// juste de rediriger l'utilisateur.
const AUTH_RESTORE_TIMEOUT_MS = 15000;

// Temps qu'on laisse à Firebase pour restaurer une session existante quand
// AUCUNE connexion n'était en attente (ex: simple rechargement du
// dashboard). Plus court que ci-dessus car il n'y a alors aucune raison
// d'attendre un aller-retour Google — juste la lecture locale d'IndexedDB,
// normalement quasi instantanée.
const NO_PENDING_RESTORE_TIMEOUT_MS = 3000;

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

  // Capturé une fois au démarrage (pas à chaque callback) : sert à choisir
  // la durée du filet de sécurité ci-dessous.
  const redirectPendingAtStart =
    localStorage.getItem(REDIRECT_KEY) === '1';

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

        // Peu importe redirectPending : on ne tranche JAMAIS "pas connecté"
        // sur le tout premier callback null de onAuthStateChanged. Cette
        // toute première notification peut arriver avant que Firebase ait
        // fini de relire la session depuis IndexedDB (restauration async à
        // chaque chargement de page) — trancher trop vite déconnecte de
        // vrais utilisateurs connectés (ex: simple F5 sur le dashboard).
        // On laisse donc toujours faire le setTimeout ci-dessous, avec une
        // durée courte quand rien n'est en attente (cas normal) et plus
        // longue juste après une connexion (redirectPending), où Firebase
        // peut avoir un peu plus de retard à récupérer la session.
        if (!redirectPending) {
          console.log(
            '🔐 Aucune connexion en attente — attente courte de restauration Firebase avant de conclure.'
          );
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
      redirectPendingAtStart
        ? AUTH_RESTORE_TIMEOUT_MS
        : NO_PENDING_RESTORE_TIMEOUT_MS
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

        <h1 class="paywall__title">
          Essai terminé
        </h1>

        <p class="paywall__text">
          Abonnez-vous pour continuer à utiliser
          Kontra-Africa.
        </p>

        <!-- ===================================================
             CHOIX DE LA DEVISE DE PAIEMENT
             Bascule l'affichage du prix ET la devise réellement
             envoyée à /api/checkout (voir startCheckout plus bas).
        ==================================================== -->
        <div
          class="paywall__currency-toggle"
          role="group"
          aria-label="Devise de paiement"
        >
          <button
            type="button"
            id="paywallCurrencyUsd"
            class="paywall__currency-btn is-active"
            data-currency="USD"
          >
            $ USD
          </button>

          <button
            type="button"
            id="paywallCurrencyCdf"
            class="paywall__currency-btn"
            data-currency="CDF"
          >
            FC CDF
          </button>
        </div>

        <div class="paywall__price">

          <span class="paywall__currency" id="paywallPriceSymbol">
            $
          </span>

          <span id="paywallPriceAmount">5</span>

          <span class="paywall__period">
            /mois
          </span>

        </div>


        <div class="paywall__phone">

          <label
            for="paywallPhone"
            class="paywall__phone-label"
          >
            Numéro Mobile Money
          </label>

          <div class="paywall__phone-row">

            <div class="paywall__country">

              <img
                id="paywallCountryFlag"
                class="paywall__country-flag"
                src="${getFlagImage(DEFAULT_COUNTRY_CODE)}"
                alt=""
              >

              <span
                class="paywall__country-dial"
                id="paywallDialPrefix"
                aria-hidden="true"
              >${getDialCode(DEFAULT_COUNTRY_CODE)}</span>

              <span
                class="paywall__country-chevron"
                aria-hidden="true"
              >▾</span>

              <select
                id="paywallCountry"
                class="paywall__country-select"
                aria-label="Pays"
              >
                ${buildCountryOptionsHtml()}
              </select>

            </div>

            <input
              type="tel"
              id="paywallPhone"
              class="paywall__phone-input"
              placeholder="812 345 678"
              inputmode="numeric"
              autocomplete="tel"
            >

          </div>

          <p
            class="paywall__phone-error"
            id="paywallPhoneError"
            hidden
          >
            Entrez un numéro Mobile Money valide.
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
          🔒 Paiement sécurisé via Mobile Money
        </p>


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


  // ----------------------------------------------------------
  // Préfixe d'indicatif (+243, +225, ...) affiché devant le
  // champ de saisie du numéro, synchronisé avec le pays choisi.
  // ----------------------------------------------------------

  const countrySelect =
    document.getElementById(
      'paywallCountry'
    );

  const dialPrefixEl =
    document.getElementById(
      'paywallDialPrefix'
    );

  const countryFlagEl =
    document.getElementById(
      'paywallCountryFlag'
    );

  function updateDialPrefix() {

    const selectedOption =
      countrySelect.options[
        countrySelect.selectedIndex
      ];

    dialPrefixEl.textContent =
      selectedOption
        ? selectedOption.dataset.dial
        : '';

    if (
      selectedOption &&
      countryFlagEl
    ) {

      countryFlagEl.src =
        `/assets/flags/${selectedOption.dataset.flag}`;
    }
  }

  countrySelect.addEventListener(
    'change',
    updateDialPrefix
  );

  updateDialPrefix();


  // ----------------------------------------------------------
  // DEVISE DE PAIEMENT — $ USD ou FC CDF
  // ----------------------------------------------------------
  // PROBLÈME CORRIGÉ ICI : le prix affiché ("5 $") était fixe alors que le
  // montant réellement facturé côté SasPay était un placeholder totalement
  // différent (voir checkout.js). On récupère maintenant le vrai prix
  // depuis /api/pricing (source unique de vérité, même valeurs que celles
  // utilisées pour créer la session de paiement), et on propose les deux
  // devises au client.

  let selectedCurrency = 'USD';

  // Valeurs de secours affichées le temps que /api/pricing réponde
  // (ou si l'appel échoue) — à ne mettre à jour ici QUE si le prix
  // officiel change ET que /api/pricing est indisponible pour une raison
  // quelconque. La vraie source de vérité reste toujours le serveur.
  let pricingInfo = {
    priceUsd: 5,
    priceCdf: 11250
  };

  const priceSymbolEl =
    document.getElementById('paywallPriceSymbol');

  const priceAmountEl =
    document.getElementById('paywallPriceAmount');

  const currencyUsdBtn =
    document.getElementById('paywallCurrencyUsd');

  const currencyCdfBtn =
    document.getElementById('paywallCurrencyCdf');

  function renderPrice() {
    if (selectedCurrency === 'USD') {
      priceSymbolEl.textContent = '$';
      priceAmountEl.textContent = pricingInfo.priceUsd;
    } else {
      priceSymbolEl.textContent = '';
      priceAmountEl.textContent =
        `${pricingInfo.priceCdf.toLocaleString('fr-FR')} FC`;
    }
  }

  function selectCurrency(currency) {
    selectedCurrency = currency;
    currencyUsdBtn.classList.toggle('is-active', currency === 'USD');
    currencyCdfBtn.classList.toggle('is-active', currency === 'CDF');
    renderPrice();
  }

  currencyUsdBtn.addEventListener('click', () => selectCurrency('USD'));
  currencyCdfBtn.addEventListener('click', () => selectCurrency('CDF'));

  fetch(`${API_BASE_URL}/api/pricing`)
    .then((r) => r.json())
    .then((data) => {
      if (data && data.success) {
        pricingInfo = {
          priceUsd: data.priceUsd,
          priceCdf: data.priceCdf
        };
        renderPrice();
      }
    })
    .catch(() => {
      // Appel échoué (serveur qui démarre, réseau...) : on garde les
      // valeurs de secours ci-dessus, déjà affichées à l'écran.
    });


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
        },
        selectedCurrency
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
  currency = 'CDF',
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

            firebaseUid:
              user.uid,

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
            },

            currency

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
        currency,
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
    // renvoyé par l'API SasPay (voir functions/src/checkout.js). On ne
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
            phone,
            currency
          )
      );

  } finally {

    clearTimeout(
      timeoutId
    );
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
