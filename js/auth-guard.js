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

  // Abonnement payant "actif" mais dont la période de 30 jours est
  // révolue : ça arrive si aucun webhook de renouvellement/échec n'est
  // jamais venu mettre à jour le statut (retard réseau, webhook manqué,
  // client qui ne renouvelle simplement pas). Sans cette vérification,
  // l'utilisateur garde un accès illimité après expiration tant qu'aucun
  // nouvel événement SasPay ne recalcule son statut côté serveur.
  if (status === 'active') {

    const subscriptionEnd = toDate(
      userData.subscriptionExpiresAt
    );

    if (
      subscriptionEnd &&
      new Date() > subscriptionEnd
    ) {
      return true;
    }
  }

  return false;
}


// ============================================================
// NUDGE PAYWALL — INCITATION AU PAIEMENT PENDANT L'ESSAI
// ============================================================
//
// Contrairement au paywall bloquant (isSubscriptionBlocked / renderPaywall)
// qui coupe l'accès UNE FOIS l'essai terminé, ce système affiche des
// rappels DE PLUS EN PLUS insistants PENDANT l'essai encore actif, pour
// inciter l'utilisateur à payer avant l'échéance :
//   - une bannière discrète en haut de chaque page tant que le compte
//     est en essai (dès que la fonction est appelée) ;
//   - une fenêtre modale, une fois par jour maximum, déclenchée dans
//     les 48 dernières heures de l'essai (mode "urgent" dans les
//     24 dernières heures).
// Appelé automatiquement depuis requireAppAccess() : aucune page de
// l'app n'a besoin d'intégrer quoi que ce soit pour en bénéficier.

const TRIAL_NUDGE_STORAGE_KEY = 'kontra_trial_nudge_shown';

function getTrialCountdown(userData) {

  if (userData.subscriptionStatus !== 'trial') {
    return null;
  }

  const trialEnd = toDate(userData.trialEndDate);

  if (!trialEnd) {
    return null;
  }

  const msLeft = trialEnd.getTime() - Date.now();

  if (msLeft <= 0) {
    // Déjà géré par isSubscriptionBlocked → renderPaywall.
    return null;
  }

  const hoursLeft = msLeft / (1000 * 60 * 60);
  const daysLeft = Math.max(
    1,
    Math.ceil(hoursLeft / 24)
  );

  return { hoursLeft, daysLeft };
}

function ensureAppCss() {

  if (
    !document.querySelector(
      'link[href="/css/app.css"]'
    )
  ) {

    const link =
      document.createElement('link');

    link.rel = 'stylesheet';
    link.href = '/css/app.css';

    document.head.appendChild(link);
  }
}

function scheduleTrialNudge(user, userData) {

  const countdown =
    getTrialCountdown(userData);

  if (!countdown) {
    return;
  }

  const { hoursLeft, daysLeft } = countdown;

  // "Urgent" = dernière journée d'essai : ton plus pressant, bannière orange.
  const isUrgent = hoursLeft <= 24;

  renderTrialBanner(user, daysLeft, isUrgent);

  // La fenêtre modale, plus insistante, n'apparaît que dans les 48
  // dernières heures de l'essai, et au maximum une fois par jour civil
  // pour ne pas harceler l'utilisateur à chaque changement de page.
  if (hoursLeft <= 48) {

    const todayKey =
      new Date().toDateString();

    let alreadyShownToday = false;

    try {
      alreadyShownToday =
        localStorage.getItem(
          TRIAL_NUDGE_STORAGE_KEY
        ) === todayKey;
    } catch (e) {
      // localStorage indisponible (mode privé, etc.) : on affiche quand
      // même, tant pis pour la limite "une fois par jour".
    }

    if (!alreadyShownToday) {

      try {
        localStorage.setItem(
          TRIAL_NUDGE_STORAGE_KEY,
          todayKey
        );
      } catch (e) {}

      renderTrialModal(user, daysLeft, isUrgent);
    }
  }
}

function renderTrialBanner(user, daysLeft, isUrgent) {

  // Une seule bannière à la fois, même si le script tourne deux fois.
  if (document.getElementById('trialBanner')) {
    return;
  }

  ensureAppCss();

  const label =
    daysLeft <= 1
      ? 'Votre essai gratuit se termine aujourd’hui'
      : `Il vous reste ${daysLeft} jours d’essai gratuit`;

  const banner =
    document.createElement('div');

  banner.id = 'trialBanner';

  banner.className =
    'trial-banner' +
    (isUrgent ? ' trial-banner--urgent' : '');

  banner.innerHTML = `
    <span class="trial-banner__text">⏳ ${label}</span>
    <button
      type="button"
      class="trial-banner__cta"
      id="trialBannerCta"
    >
      S’abonner maintenant
    </button>
    <button
      type="button"
      class="trial-banner__close"
      id="trialBannerClose"
      aria-label="Fermer"
    >
      ✕
    </button>
  `;

  document.body.prepend(banner);

  document
    .getElementById('trialBannerCta')
    .addEventListener(
      'click',
      () => renderPaywall(user, 'early')
    );

  document
    .getElementById('trialBannerClose')
    .addEventListener(
      'click',
      () => banner.remove()
    );
}

function renderTrialModal(user, daysLeft, isUrgent) {

  ensureAppCss();

  const title =
    isUrgent
      ? 'Votre essai gratuit se termine aujourd’hui'
      : `Encore ${daysLeft} jours d’essai gratuit`;

  const text =
    isUrgent
      ? 'Passé ce délai, vous perdrez l’accès à votre tableau de bord, vos contrats et votre suivi financier. Abonnez-vous maintenant pour continuer sans interruption.'
      : 'Abonnez-vous dès maintenant pour ne rien perdre de vos contrats et de votre suivi financier lorsque l’essai se terminera.';

  const overlay =
    document.createElement('div');

  overlay.className = 'trial-nudge-overlay';
  overlay.id = 'trialNudgeOverlay';

  overlay.innerHTML = `
    <div class="trial-nudge-card">
      <div class="trial-nudge-card__icon">
        ${isUrgent ? '⚠️' : '⏳'}
      </div>
      <h2 class="trial-nudge-card__title">
        ${title}
      </h2>
      <p class="trial-nudge-card__text">
        ${text}
      </p>
      <div class="trial-nudge-card__actions">
        <button
          type="button"
          class="btn btn-primary btn-lg"
          id="trialNudgeCta"
        >
          S’abonner maintenant — dès 5$/mois
        </button>
        <button
          type="button"
          class="trial-nudge-card__later"
          id="trialNudgeLater"
        >
          Plus tard
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document
    .getElementById('trialNudgeCta')
    .addEventListener(
      'click',
      () => renderPaywall(user, 'early')
    );

  document
    .getElementById('trialNudgeLater')
    .addEventListener(
      'click',
      () => overlay.remove()
    );
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
  //
  // CORRECTIF : login.js pose cette clé avec un TIMESTAMP
  // (String(Date.now())), jamais la chaîne '1'. Le test `=== '1'` était
  // donc TOUJOURS faux, ce qui faisait passer directement au timeout court
  // de 3s (NO_PENDING_RESTORE_TIMEOUT_MS) même juste après une connexion
  // Google, au lieu du timeout long de 15s (AUTH_RESTORE_TIMEOUT_MS) prévu
  // pour laisser Firebase le temps de restaurer la session. Sur mobile /
  // juste après un login, 3s est souvent trop court : la session pas
  // encore restaurée est alors interprétée comme "pas connecté" et
  // l'utilisateur est renvoyé vers /login.html — c'est exactement le
  // "je me connecte, ça a l'air de marcher, puis retour à login" remonté.
  // On vérifie donc juste que la clé existe (peu importe sa valeur).
  const redirectPendingAtStart =
    localStorage.getItem(REDIRECT_KEY) !== null;

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
          ) !== null;

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

          renderPaywall(
            user,
            userData.subscriptionStatus === 'trial'
              ? 'trial_expired'
              : 'subscription_expired'
          );

          resolve(null);

          return;
        }


        // ----------------------------------------------------
        // ACCÈS AUTORISÉ
        // ----------------------------------------------------

        console.log(
          '✅ Accès à l’application autorisé.'
        );

        // Rappels de paiement pendant l'essai (sans jamais bloquer
        // l'accès) — voir la section "NUDGE PAYWALL" plus haut.
        scheduleTrialNudge(user, userData);

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

function renderPaywall(user, reason = 'trial_expired') {

  // Le même écran de paiement sert dans 3 situations différentes : on
  // adapte juste le titre/texte pour ne pas dire "essai terminé" à
  // quelqu'un dont l'abonnement PAYANT a expiré, ni à quelqu'un qui
  // clique "payer maintenant" depuis la bannière alors qu'il est
  // encore en plein essai.
  const COPY = {
    trial_expired: {
      title: 'Essai terminé',
      text: 'Abonnez-vous pour continuer à utiliser Kontra-Africa.'
    },
    subscription_expired: {
      title: 'Abonnement expiré',
      text: 'Votre période payée est terminée. Renouvelez votre abonnement pour continuer à utiliser Kontra-Africa.'
    },
    early: {
      title: 'S’abonner à Kontra-Africa',
      text: 'Passez à l’abonnement payant dès maintenant pour ne jamais perdre l’accès à vos contrats et votre suivi financier.'
    }
  };

  const copy =
    COPY[reason] || COPY.trial_expired;

  document.body.innerHTML = `

    <main class="paywall">

      <div class="paywall__card">

        <img
          src="/logo.webp"
          alt="Kontra-Africa"
          class="paywall__logo"
        >

        <h1 class="paywall__title">
          ${copy.title}
        </h1>

        <p class="paywall__text">
          ${copy.text}
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
            id="paywallCurrencyLocal"
            class="paywall__currency-btn"
            data-currency="LOCAL"
          >
            <span id="paywallCurrencyLocalLabel">Monnaie locale</span>
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
  // DEVISE DE PAIEMENT — $ USD ou monnaie locale du pays choisi
  // ----------------------------------------------------------
  // PROBLÈME CORRIGÉ ICI (x2) :
  // 1) le prix affiché ("5 $") était fixe alors que le montant réellement
  //    facturé côté SasPay était un placeholder totalement différent
  //    (voir checkout.js).
  // 2) la "monnaie locale" était codée en dur sur CDF — or CDF n'est la
  //    devise que de la RD Congo. Les 7 autres pays pris en charge (voir
  //    js/phone-countries.js) utilisent le franc CFA (XOF ou XAF). La
  //    devise locale doit donc suivre le PAYS sélectionné dans le
  //    formulaire, pas être fixe.
  //
  // On récupère le vrai prix (USD + devise locale du pays choisi) depuis
  // /api/pricing?country=XX — source unique de vérité, mêmes valeurs que
  // celles utilisées pour créer la session de paiement.

  let selectedCurrencyMode = 'USD'; // 'USD' ou 'LOCAL' — envoyé tel quel à /api/checkout

  // Valeurs de secours affichées le temps que /api/pricing réponde (ou si
  // l'appel échoue). La vraie source de vérité reste toujours le serveur.
  let pricingInfo = {
    priceUsd: 5,
    localCurrency: null,
    localAmount: null
  };

  const priceSymbolEl =
    document.getElementById('paywallPriceSymbol');

  const priceAmountEl =
    document.getElementById('paywallPriceAmount');

  const currencyUsdBtn =
    document.getElementById('paywallCurrencyUsd');

  const currencyLocalBtn =
    document.getElementById('paywallCurrencyLocal');

  const currencyLocalLabelEl =
    document.getElementById('paywallCurrencyLocalLabel');

  function renderPrice() {
    if (selectedCurrencyMode === 'USD') {
      priceSymbolEl.textContent = '$';
      priceAmountEl.textContent = pricingInfo.priceUsd;
    } else if (pricingInfo.localCurrency) {
      priceSymbolEl.textContent = '';
      priceAmountEl.textContent =
        `${pricingInfo.localAmount.toLocaleString('fr-FR')} ${pricingInfo.localCurrency}`;
    } else {
      // Pays pas encore résolu (chargement) ou non supporté en local.
      priceSymbolEl.textContent = '';
      priceAmountEl.textContent = '…';
    }
  }

  function selectCurrencyMode(mode) {
    selectedCurrencyMode = mode;
    currencyUsdBtn.classList.toggle('is-active', mode === 'USD');
    currencyLocalBtn.classList.toggle('is-active', mode === 'LOCAL');
    renderPrice();
  }

  currencyUsdBtn.addEventListener('click', () => selectCurrencyMode('USD'));
  currencyLocalBtn.addEventListener('click', () => selectCurrencyMode('LOCAL'));

  function fetchPricingForCountry(countryCode) {
    fetch(`${API_BASE_URL}/api/pricing?country=${encodeURIComponent(countryCode)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data && data.success) {
          pricingInfo = {
            priceUsd: data.priceUsd,
            localCurrency: data.localCurrency,
            localAmount: data.localAmount
          };

          // Met à jour le libellé du bouton avec la vraie devise du pays
          // (ex: "Payer en FCFA" pour un pays XOF, "Payer en FC" pour la
          // RDC) au lieu du générique "Monnaie locale".
          if (currencyLocalLabelEl) {
            currencyLocalLabelEl.textContent = data.localCurrency
              ? `${data.localCurrency}`
              : 'Monnaie locale';
          }

          renderPrice();
        }
      })
      .catch(() => {
        // Appel échoué (serveur qui démarre, réseau...) : on garde les
        // valeurs de secours déjà affichées à l'écran.
      });
  }

  // Chargement initial pour le pays présélectionné, puis à chaque
  // changement de pays dans le formulaire (mise à jour de updateDialPrefix
  // déjà appelée ci-dessus).
  fetchPricingForCountry(countrySelect.value);

  countrySelect.addEventListener('change', () => {
    fetchPricingForCountry(countrySelect.value);
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
        selectedCurrencyMode
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
