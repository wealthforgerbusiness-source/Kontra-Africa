import { auth, db } from '/js/firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { buildCountryOptionsHtml, cleanPhoneDigits } from '/js/phone-countries.js';

const API_BASE_URL = 'https://kontra-africa.onrender.com';
const CHECKOUT_TIMEOUT_MS = 60000;

// -----------------------------------------------------------------------------
// Auth state
// -----------------------------------------------------------------------------
//
// IMPORTANT : Firebase peut prendre un petit moment pour restaurer une session
// existante, particulièrement sur mobile/PWA.
//
// On ne redirige donc PAS immédiatement vers login.html lorsque user === null.
// On laisse Firebase terminer sa restauration.
//
// -----------------------------------------------------------------------------

let authStateResolved = false;
let currentAuthUser = null;

function waitForAuthState(timeout = 15000) {
  return new Promise((resolve) => {
    let finished = false;

    const finish = (user) => {
      if (finished) return;
      finished = true;

      clearTimeout(timeoutId);

      authStateResolved = true;
      currentAuthUser = user || null;

      resolve(user || null);
    };

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      // Firebase a maintenant répondu.
      // On ne redirige pas avant que cet état soit réellement connu.
      finish(user);
      unsubscribe();
    });

    // Sécurité : si Firebase ne répond vraiment jamais,
    // on ne bloque pas éternellement l'application.
    const timeoutId = setTimeout(() => {
      if (finished) return;

      console.warn('[AUTH] Timeout lors de la restauration de la session Firebase.');

      finished = true;
      authStateResolved = true;

      // On considère alors réellement l'utilisateur comme non connecté.
      currentAuthUser = null;

      unsubscribe();

      resolve(null);
    }, timeout);
  });
}

// -----------------------------------------------------------------------------
// Détermine si l'accès doit être bloqué
// -----------------------------------------------------------------------------

function isSubscriptionBlocked(userData) {
  const status = userData.subscriptionStatus;

  if (status === 'expired' || status === 'cancelled') {
    return true;
  }

  if (status === 'trial') {
    const trialEnd = toDate(userData.trialEndDate);

    if (trialEnd && new Date() > trialEnd) {
      return true;
    }
  }

  return false;
}

// -----------------------------------------------------------------------------
// Convertit un Timestamp Firestore (ou une date déjà stockée) en Date JS
// -----------------------------------------------------------------------------

function toDate(value) {
  if (!value) return null;

  if (typeof value.toDate === 'function') {
    return value.toDate();
  }

  const parsed = new Date(value);

  return isNaN(parsed.getTime()) ? null : parsed;
}

// -----------------------------------------------------------------------------
// Point d'entrée principal, appelé par chaque page protégée
// -----------------------------------------------------------------------------

export async function requireAppAccess() {
  try {
    // -------------------------------------------------------------------------
    // IMPORTANT
    //
    // On attend que Firebase ait terminé de restaurer la session.
    // C'est la correction principale du problème mobile.
    // -------------------------------------------------------------------------

    const user = await waitForAuthState();

    if (!user) {
      console.warn('[AUTH] Aucun utilisateur connecté après restauration.');

      // Petite protection supplémentaire contre une redirection trop rapide
      // sur mobile/PWA.
      await new Promise((resolve) => setTimeout(resolve, 300));

      window.location.replace('/login.html');
      return null;
    }

    currentAuthUser = user;

    // -------------------------------------------------------------------------
    // Vérification du profil Firestore
    // -------------------------------------------------------------------------

    const userSnap = await getDoc(
      doc(db, 'users', user.uid)
    );

    if (!userSnap.exists()) {
      console.warn(
        '[AUTH] Utilisateur Firebase connecté mais profil Firestore absent :',
        user.uid
      );

      // On ne déconnecte PAS l'utilisateur.
      // On retourne simplement vers login comme dans le système original.
      window.location.replace('/login.html');

      return null;
    }

    const userData = userSnap.data();

    // -------------------------------------------------------------------------
    // Vérification abonnement
    // -------------------------------------------------------------------------

    if (isSubscriptionBlocked(userData)) {
      renderPaywall(user);
      return null;
    }

    // -------------------------------------------------------------------------
    // Tout est OK
    // -------------------------------------------------------------------------

    return {
      user,
      userData
    };

  } catch (err) {
    console.error(
      '[AUTH] Erreur de vérification d’accès :',
      err
    );

    renderFatalError();

    return null;
  }
}

// -----------------------------------------------------------------------------
// Déconnexion
// -----------------------------------------------------------------------------

export async function logout() {
  try {
    const { signOut } = await import(
      'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js'
    );

    await signOut(auth);

    // Nettoyage éventuel de notre état local.
    currentAuthUser = null;
    authStateResolved = false;

    window.location.replace('/login.html');

  } catch (err) {
    console.error('[AUTH] Erreur lors de la déconnexion :', err);

    // Même en cas de problème secondaire, on revient à la page login.
    window.location.replace('/login.html');
  }
}

// -----------------------------------------------------------------------------
// Rendu du paywall — remplace tout le contenu de la page
// -----------------------------------------------------------------------------

function renderPaywall(user) {
  document.body.innerHTML = `
    <main class="paywall">
      <div class="paywall__card">

        <img
          src="/logo.webp"
          alt="Kontra-Africa"
          class="paywall__logo"
        >

        <p class="eyebrow">Abonnement</p>

        <h1 class="paywall__title">
          Votre période d'essai est terminée
        </h1>

        <p class="paywall__text">
          Abonnez-vous pour continuer à créer des contrats,
          les faire signer et suivre vos finances sur Kontra-Africa.
        </p>

        <div class="paywall__price">
          <span class="paywall__currency">$</span>
          5
          <span class="paywall__period">/mois</span>
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
            Entrez un numéro Mobile Money valide pour continuer.
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
            Entre ta clé de licence (envoyée dans ton email Chariow)
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

  // ---------------------------------------------------------------------------
  // Charge le CSS du paywall dynamiquement s'il n'est pas déjà présent
  // ---------------------------------------------------------------------------

  if (!document.querySelector('link[href="/css/app.css"]')) {
    const link = document.createElement('link');

    link.rel = 'stylesheet';
    link.href = '/css/app.css';

    document.head.appendChild(link);
  }

  const zone = document.getElementById('paywallZone');
  const checkoutBtn = document.getElementById('checkoutBtn');
  const logoutBtn = document.getElementById('paywallLogout');

  const verifyLicenseBtn = document.getElementById(
    'paywallVerifyLicenseBtn'
  );

  const licenseInput = document.getElementById(
    'paywallLicenseKey'
  );

  const licenseError = document.getElementById(
    'paywallLicenseError'
  );

  verifyLicenseBtn.addEventListener(
    'click',
    () => verifyLicense(
      user,
      licenseInput,
      licenseError,
      verifyLicenseBtn
    )
  );

  checkoutBtn.addEventListener('click', () => {
    const phoneNumber = cleanPhoneDigits(
      document.getElementById('paywallPhone').value
    );

    const countryCode =
      document.getElementById('paywallCountry').value;

    const phoneErrorEl =
      document.getElementById('paywallPhoneError');

    if (phoneNumber.length < 8) {
      phoneErrorEl.hidden = false;
      return;
    }

    phoneErrorEl.hidden = true;

    startCheckout(
      user,
      zone,
      {
        number: phoneNumber,
        countryCode
      }
    );
  });

  logoutBtn.addEventListener('click', logout);
}

// -----------------------------------------------------------------------------
// Checkout
// -----------------------------------------------------------------------------

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
        (cela peut prendre jusqu'à 1 minute la première fois)
      </p>
    </div>
  `;

  const controller = new AbortController();

  const timeoutId = setTimeout(
    () => controller.abort(),
    CHECKOUT_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/checkout`,
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          firebaseUid: user.uid,
          email: user.email || '',

          firstName: user.displayName
            ? user.displayName.split(' ')[0]
            : 'Client',

          lastName: user.displayName
            ? user.displayName
                .split(' ')
                .slice(1)
                .join(' ') || 'Inconnu'
            : 'Inconnu',

          phone: {
            number: phone.number,
            countryCode: phone.countryCode
          }
        }),

        signal: controller.signal
      }
    );

    // Render peut répondre 502/503 pendant son démarrage.
    if (
      (response.status === 502 ||
        response.status === 503) &&
      !isRetryAttempt
    ) {
      clearTimeout(timeoutId);

      await new Promise(
        (resolve) => setTimeout(resolve, 4000)
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
        await response.json().catch(() => ({}));

      throw new Error(
        errBody.message ||
        errBody.error ||
        `checkout a répondu avec le statut ${response.status}`
      );
    }

    const data = await response.json();

    if (data && data.reactivated) {
      window.location.replace('/dashboard.html');
      return;
    }

    if (!data || !data.checkoutUrl) {
      throw new Error(
        'Aucune URL de paiement reçue.'
      );
    }

    window.location.href = data.checkoutUrl;

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

    zone.innerHTML = `
      <div
        class="paywall-state paywall-state--error"
        role="alert"
      >

        <p>${message}</p>

        <button
          type="button"
          id="checkoutRetry"
          class="btn btn-secondary"
        >
          Réessayer
        </button>

      </div>
    `;

    document
      .getElementById('checkoutRetry')
      .addEventListener(
        'click',
        () => startCheckout(
          user,
          zone,
          phone
        )
      );

  } finally {
    clearTimeout(timeoutId);
  }
}

// -----------------------------------------------------------------------------
// Vérification manuelle de clé de licence
// -----------------------------------------------------------------------------

async function verifyLicense(
  user,
  inputEl,
  errorEl,
  buttonEl
) {
  errorEl.hidden = true;

  const licenseKey =
    inputEl.value.trim();

  if (!licenseKey) {
    errorEl.textContent =
      "Entre la clé de licence reçue par email après ton paiement.";

    errorEl.hidden = false;

    return;
  }

  buttonEl.disabled = true;
  buttonEl.textContent = 'Vérification…';

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/verify-license`,
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          firebaseUid: user.uid,
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
      (data && data.error) ||
      "Clé de licence invalide.";

    errorEl.hidden = false;

  } catch (err) {
    console.error(
      'Erreur de vérification de licence :',
      err
    );

    errorEl.textContent =
      "Impossible de vérifier la clé pour le moment. Réessaie dans un instant.";

    errorEl.hidden = false;

  } finally {
    buttonEl.disabled = false;
    buttonEl.textContent = 'Vérifier';
  }
}

// -----------------------------------------------------------------------------
// Erreur fatale
// -----------------------------------------------------------------------------

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
