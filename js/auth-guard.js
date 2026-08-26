/* ==========================================================================
   Kontra-Africa — Garde d'accès de l'app
   ------------------------------------------------------------------------
   Utilisé par toutes les pages protégées (dashboard.html, contrats.html,
   finances.html, profil.html). Une seule page = un seul appel :

     import { requireAppAccess } from '/js/auth-guard.js';
     const session = await requireAppAccess();
     if (!session) return; // redirection ou paywall déjà géré
     // session.user     -> objet Firebase Auth
     // session.userData -> document Firestore users/{uid}

   Si l'utilisateur n'est pas connecté : redirection vers /login.html
   Si l'abonnement est bloqué : le paywall remplace tout le contenu de la
   page et la promesse résout à null (la page ne construit rien de plus).
   ========================================================================== */

import { auth, db } from '/js/firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const API_BASE_URL = 'https://kontra-africa.onrender.com';
const CHECKOUT_TIMEOUT_MS = 60000; // le backend Render (plan gratuit) peut mettre jusqu'à ~50s à répondre après une inactivité (cold start)

/* --- Détermine si l'accès doit être bloqué --- */
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

/* --- Convertit un Timestamp Firestore (ou une date déjà stockée) en Date JS --- */
function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/* --- Point d'entrée principal, appelé par chaque page protégée --- */
export function requireAppAccess() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = '/login.html';
        return;
      }

      try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));

        if (!userSnap.exists()) {
          window.location.href = '/login.html';
          return;
        }

        const userData = userSnap.data();

        if (isSubscriptionBlocked(userData)) {
          renderPaywall(user);
          resolve(null);
          return;
        }

        resolve({ user, userData });
      } catch (err) {
        console.error('Erreur de vérification d\'accès :', err);
        renderFatalError();
        resolve(null);
      }
    });
  });
}

/* --- Déconnexion, utilisée par la sidebar/bottom nav et le paywall --- */
export async function logout() {
  const { signOut } = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js');
  await signOut(auth);
  window.location.href = '/login.html';
}

/* ==========================================================================
   Rendu du paywall — remplace tout le contenu de la page
   ========================================================================== */

function renderPaywall(user) {
  document.body.innerHTML = `
    <main class="paywall">
      <div class="paywall__card">
        <img src="/logo.webp" alt="Kontra-Africa" class="paywall__logo">

        <p class="eyebrow">Abonnement</p>
        <h1 class="paywall__title">Votre période d'essai est terminée</h1>
        <p class="paywall__text">
          Abonnez-vous pour continuer à créer des contrats, les faire signer
          et suivre vos finances sur Kontra-Africa.
        </p>

        <div class="paywall__price">
          <span class="paywall__currency">$</span>5<span class="paywall__period">/mois</span>
        </div>

        <div class="paywall__zone" id="paywallZone">
          <button type="button" id="checkoutBtn" class="btn btn-primary btn-lg paywall__cta">
            S'abonner maintenant
          </button>
        </div>

        <button type="button" id="paywallLogout" class="btn btn-ghost paywall__logout">
          Se déconnecter
        </button>
      </div>
    </main>
  `;

  // Charge le CSS du paywall dynamiquement s'il n'est pas déjà présent
  if (!document.querySelector('link[href="/css/app.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/app.css';
    document.head.appendChild(link);
  }

  const zone = document.getElementById('paywallZone');
  const checkoutBtn = document.getElementById('checkoutBtn');
  const logoutBtn = document.getElementById('paywallLogout');

  checkoutBtn.addEventListener('click', () => startCheckout(user, zone));
  logoutBtn.addEventListener('click', logout);
}

async function startCheckout(user, zone, isRetryAttempt = false) {
  zone.innerHTML = `
    <div class="paywall-state">
      <span class="spinner" aria-hidden="true"></span>
      <p>Préparation du paiement… (cela peut prendre jusqu'à 1 minute la première fois)</p>
    </div>
  `;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHECKOUT_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}/api/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firebaseUid: user.uid,
        email: user.email || '',
        firstName: user.displayName ? user.displayName.split(' ')[0] : 'Client',
        lastName: user.displayName ? user.displayName.split(' ').slice(1).join(' ') || 'Inconnu' : 'Inconnu'
      }),
      signal: controller.signal
    });

    // Le serveur Render (plan gratuit) répond parfois par une erreur passerelle
    // (502/503) le temps qu'il finisse de démarrer après une période d'inactivité.
    // Un seul nouvel essai automatique, silencieux, résout la grande majorité des cas.
    if ((response.status === 502 || response.status === 503) && !isRetryAttempt) {
      clearTimeout(timeoutId);
      await new Promise((r) => setTimeout(r, 4000));
      return startCheckout(user, zone, true);
    }

    if (!response.ok) {
      throw new Error(`checkout a répondu avec le statut ${response.status}`);
    }

    const data = await response.json();

    if (!data || !data.checkoutUrl) {
      throw new Error('Aucune URL de paiement reçue.');
    }

    window.location.href = data.checkoutUrl;
  } catch (err) {
    console.error('Erreur checkout :', err);
    const message = err.name === 'AbortError'
      ? "Le serveur met plus de temps que prévu à démarrer. Réessayez dans un instant."
      : "Impossible de préparer le paiement. Réessayez.";
    zone.innerHTML = `
      <div class="paywall-state paywall-state--error" role="alert">
        <p>${message}</p>
        <button type="button" id="checkoutRetry" class="btn btn-secondary">Réessayer</button>
      </div>
    `;
    document.getElementById('checkoutRetry').addEventListener('click', () => startCheckout(user, zone));
  } finally {
    clearTimeout(timeoutId);
  }
}

/* --- Erreur fatale (Firestore inaccessible, etc.) --- */
function renderFatalError() {
  document.body.innerHTML = `
    <main class="paywall">
      <div class="paywall__card">
        <img src="/logo.webp" alt="Kontra-Africa" class="paywall__logo">
        <h1 class="paywall__title">Impossible de charger votre compte</h1>
        <p class="paywall__text">Vérifiez votre connexion internet, puis rechargez la page.</p>
        <button type="button" class="btn btn-primary" onclick="window.location.reload()">Recharger</button>
      </div>
    </main>
  `;
}
