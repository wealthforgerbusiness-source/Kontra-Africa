// js/profil.js
// Module Profil (protégé par auth-guard.js)
//
// Hypothèses sur firebase-config.js : exporte `auth` et `db` via
// `export { auth, db }`. Adapte les imports si tes noms diffèrent.
//
// Hypothèse sur POST /api/checkout (functions/src/checkout.js) : accepte un
// header `Authorization: Bearer <idToken>` pour identifier l'utilisateur et
// répond avec `{ checkoutUrl }` (URL de paiement Chariow à laquelle
// rediriger). Adapte `handleResubscribe` si le contrat de l'API diffère.

import { auth, db } from './firebase-config.js';
import {
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { renderAppNav } from './app-nav.js';

renderAppNav('profil'); // sidebar desktop + bottom nav mobile

const API_BASE = '';

// ---------- Éléments DOM ----------
const profilePhoto = document.getElementById('profile-photo');
const profileName = document.getElementById('profile-name');
const profileEmail = document.getElementById('profile-email');

const subscriptionMessage = document.getElementById('subscription-message');
const btnResubscribe = document.getElementById('btn-resubscribe');
const subscriptionError = document.getElementById('subscription-error');

const btnLogout = document.getElementById('btn-logout');

let currentUser = null;

// ---------- Auth ----------
onAuthStateChanged(auth, (user) => {
  if (!user) return; // auth-guard.js gère déjà la redirection si non connecté
  currentUser = user;
  renderIdentity(user);
  listenToSubscription(user.uid);
});

function renderIdentity(user) {
  profilePhoto.src = user.photoURL || '/icons/icon-192.png';
  profilePhoto.alt = user.displayName ? `Photo de ${user.displayName}` : '';
  profileName.textContent = user.displayName || 'Utilisateur';
  profileEmail.textContent = user.email || '';
}

// ---------- Statut abonnement ----------
function listenToSubscription(uid) {
  onSnapshot(doc(db, 'users', uid), (snap) => {
    if (!snap.exists()) return;
    renderSubscriptionStatus(snap.data());
  });
}

function renderSubscriptionStatus(data) {
  const status = data.subscriptionStatus;
  subscriptionMessage.classList.remove('status-trial', 'status-active', 'status-expired');
  btnResubscribe.hidden = true;
  subscriptionError.hidden = true;

  if (status === 'trial') {
    const date = formatDate(data.trialEndDate);
    subscriptionMessage.textContent = date
      ? `Essai gratuit — expire le ${date}`
      : 'Essai gratuit en cours';
    subscriptionMessage.classList.add('status-trial');
  } else if (status === 'active') {
    const date = formatDate(data.subscriptionExpiresAt);
    subscriptionMessage.textContent = date
      ? `Abonnement actif — prochain renouvellement le ${date}`
      : 'Abonnement actif';
    subscriptionMessage.classList.add('status-active');
  } else if (status === 'expired' || status === 'cancelled') {
    subscriptionMessage.textContent = 'Abonnement expiré';
    subscriptionMessage.classList.add('status-expired');
    btnResubscribe.hidden = false;
  } else {
    subscriptionMessage.textContent = 'Statut d’abonnement inconnu.';
  }
}

function formatDate(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date ? date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : null;
}

// ---------- Réabonnement ----------
btnResubscribe.addEventListener('click', handleResubscribe);

async function handleResubscribe() {
  if (!currentUser) return;
  subscriptionError.hidden = true;
  btnResubscribe.disabled = true;
  btnResubscribe.textContent = 'Redirection en cours…';

  try {
    const idToken = await currentUser.getIdToken();
    const res = await fetch(`${API_BASE}/api/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ uid: currentUser.uid }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || "Impossible de lancer le paiement.");
    }

    const result = await res.json();
    if (result.checkoutUrl) {
      window.location.href = result.checkoutUrl;
    } else {
      throw new Error("Lien de paiement introuvable dans la réponse.");
    }
  } catch (err) {
    console.error('Erreur de réabonnement :', err);
    subscriptionError.textContent = err.message || "Le réabonnement a échoué. Réessaie.";
    subscriptionError.hidden = false;
    btnResubscribe.disabled = false;
    btnResubscribe.textContent = 'Se réabonner';
  }
}

// ---------- Déconnexion ----------
btnLogout.addEventListener('click', async () => {
  btnLogout.disabled = true;
  btnLogout.textContent = 'Déconnexion…';
  try {
    await signOut(auth);
    window.location.href = '/login.html';
  } catch (err) {
    console.error('Erreur de déconnexion :', err);
    btnLogout.disabled = false;
    btnLogout.textContent = 'Se déconnecter';
  }
});
