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

async function startCheckout(user, zone) {
  zone.innerHTML = `
    <div class="paywall-state">
      <span class="spinner" aria-hidden="true"></span>
      <p>Préparation du paiement…</p>
    </div>
  `;

  try {
    const response = await fetch(`${API_BASE_URL}/api/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: user.uid })
    });

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
    zone.innerHTML = `
      <div class="paywall-state paywall-state--error" role="alert">
        <p>Impossible de préparer le paiement. Réessayez.</p>
        <button type="button" id="checkoutRetry" class="btn btn-secondary">Réessayer</button>
      </div>
    `;
    document.getElementById('checkoutRetry').addEventListener('click', () => startCheckout(user, zone));
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
