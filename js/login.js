import { auth, googleProvider } from '/js/firebase-config.js';
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

const API_BASE_URL = 'https://kontra-africa.onrender.com';
const REDIRECT_KEY = 'kontra_auth_pending'; // marque qu'une connexion par redirection est en cours
const INIT_USER_TIMEOUT_MS = 60000; // le backend Render (plan gratuit) peut mettre jusqu'à ~50s à répondre après une inactivité (cold start)

const googleBtn = document.getElementById('googleBtn');
const loadingState = document.getElementById('loadingState');
const loadingLabel = document.getElementById('loadingLabel');
const errorState = document.getElementById('errorState');
const errorMessage = document.getElementById('errorMessage');
const retryBtn = document.getElementById('retryBtn');

/* --- Détection mobile : popup peu fiable sur mobile, on préfère la redirection --- */
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/* --- Gestion des états visuels --- */
function showButton() {
  googleBtn.hidden = false;
  loadingState.hidden = true;
  errorState.hidden = true;
}

function showLoading(label) {
  googleBtn.hidden = true;
  errorState.hidden = true;
  loadingState.hidden = false;
  loadingLabel.textContent = label;
}

function showError(message) {
  googleBtn.hidden = true;
  loadingState.hidden = true;
  errorState.hidden = false;
  errorMessage.textContent = message;
}

/* --- Traduction des erreurs Firebase courantes en messages clairs --- */
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
    default:
      return "La connexion avec Google a échoué. Réessayez.";
  }
}

/* --- Appel backend : crée/initialise le profil utilisateur ---
   Timeout étendu à 60s pour laisser le temps au cold start Render (plan gratuit). */
async function initUserOnBackend(firebaseUser) {
  const payload = {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: firebaseUser.displayName,
    photoURL: firebaseUser.photoURL
  };

  showLoading('Préparation de votre espace… (cela peut prendre jusqu\'à 1 minute la première fois)');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), INIT_USER_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}/api/init-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`init-user a répondu avec le statut ${response.status}`);
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

/* --- Flux complet après authentification Firebase réussie --- */
async function completeSignIn(firebaseUser) {
  try {
    await initUserOnBackend(firebaseUser);
    localStorage.removeItem(REDIRECT_KEY);
    window.location.href = '/dashboard.html';
  } catch (err) {
    console.error('Erreur init-user :', err);
    localStorage.removeItem(REDIRECT_KEY);
    if (err.message === 'TIMEOUT_INIT_USER') {
      showError("La préparation de votre espace prend plus de temps que prévu (le serveur démarre). Réessayez dans un instant.");
    } else {
      showError("Votre connexion Google a réussi, mais nous n'avons pas pu préparer votre espace. Réessayez.");
    }
  }
}

/* --- Lancement de la connexion Google --- */
async function startGoogleSignIn() {
  showLoading('Connexion à Google…');
  try {
    await setPersistence(auth, browserLocalPersistence);

    if (isMobile) {
      localStorage.setItem(REDIRECT_KEY, '1');
      await signInWithRedirect(auth, googleProvider);
      // La page se recharge après la redirection ; le résultat est traité au chargement.
      return;
    }

    const result = await signInWithPopup(auth, googleProvider);
    await completeSignIn(result.user);
  } catch (err) {
    console.error('Erreur signInWithGoogle :', err);
    localStorage.removeItem(REDIRECT_KEY);
    showError(translateAuthError(err));
  }
}

/* --- Au chargement : vérifie si on revient d'une redirection Google (mobile) --- */
async function checkRedirectResult() {
  const wasPending = localStorage.getItem(REDIRECT_KEY);

  try {
    await setPersistence(auth, browserLocalPersistence);
    const result = await getRedirectResult(auth);

    if (result && result.user) {
      await completeSignIn(result.user);
      return;
    }

    if (wasPending) {
      // On attendait un retour mais rien n'est arrivé : on nettoie sans bloquer l'utilisateur
      localStorage.removeItem(REDIRECT_KEY);
    }
    showButton();
  } catch (err) {
    console.error('Erreur getRedirectResult :', err);
    localStorage.removeItem(REDIRECT_KEY);
    showError(translateAuthError(err));
  }
}

googleBtn.addEventListener('click', startGoogleSignIn);
retryBtn.addEventListener('click', showButton);
checkRedirectResult();
