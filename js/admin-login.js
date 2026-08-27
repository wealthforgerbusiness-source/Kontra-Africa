/* ==========================================================================
   Kontra-Africa — Connexion Admin (email/mot de passe, accès restreint)
   ========================================================================== */

import { auth } from '/js/firebase-config.js';
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

// Seule cette adresse email a le droit d'accéder au panneau admin.
// Rappel : la vraie sécurité doit AUSSI être appliquée côté règles Firestore
// (voir firestore.rules fourni), sinon cette vérification côté client seule
// n'empêche pas un utilisateur technique de lire les données autrement.
const ADMIN_EMAIL = 'optisitedigital@gmail.com';

const form = document.getElementById('adminLoginForm');
const emailInput = document.getElementById('adminEmail');
const passwordInput = document.getElementById('adminPassword');
const submitBtn = document.getElementById('adminSubmitBtn');
const loadingState = document.getElementById('adminLoadingState');
const errorState = document.getElementById('adminErrorState');
const errorMessage = document.getElementById('adminErrorMessage');
const forgotBtn = document.getElementById('adminForgotBtn');

function showLoading() {
  submitBtn.hidden = true;
  loadingState.hidden = false;
  errorState.hidden = true;
}

function showForm() {
  submitBtn.hidden = false;
  loadingState.hidden = true;
}

function showError(message) {
  submitBtn.hidden = false;
  loadingState.hidden = true;
  errorState.hidden = false;
  errorMessage.textContent = message;
}

function translateAuthError(error) {
  const code = error && error.code;
  switch (code) {
    case 'auth/invalid-email':
      return "Adresse email invalide.";
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return "Email ou mot de passe incorrect.";
    case 'auth/too-many-requests':
      return "Trop de tentatives. Réessayez dans quelques minutes.";
    case 'auth/network-request-failed':
      return "Problème de connexion internet. Vérifiez votre réseau.";
    default:
      return "La connexion a échoué. Réessayez.";
  }
}

// Si un admin est déjà connecté (session persistée), on saute directement
// vers le tableau de bord.
onAuthStateChanged(auth, (user) => {
  if (user && user.email && user.email.toLowerCase() === ADMIN_EMAIL) {
    window.location.href = '/admin.html';
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorState.hidden = true;

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showError('Merci de renseigner votre email et votre mot de passe.');
    return;
  }

  // Vérification précoce : évite un appel réseau inutile et ne révèle rien
  // sur l'existence d'autres comptes.
  if (email.toLowerCase() !== ADMIN_EMAIL) {
    showError("Cette adresse n'est pas autorisée à accéder au panneau admin.");
    return;
  }

  showLoading();

  try {
    const result = await signInWithEmailAndPassword(auth, email, password);

    // Double vérification défensive côté client après connexion.
    if (!result.user.email || result.user.email.toLowerCase() !== ADMIN_EMAIL) {
      await signOut(auth);
      showError("Cette adresse n'est pas autorisée à accéder au panneau admin.");
      return;
    }

    window.location.href = '/admin.html';
  } catch (err) {
    console.error('Erreur de connexion admin :', err);
    showError(translateAuthError(err));
  }
});

forgotBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim() || ADMIN_EMAIL;

  if (email.toLowerCase() !== ADMIN_EMAIL) {
    showError("Cette adresse n'est pas autorisée à accéder au panneau admin.");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    showError(`Un email de réinitialisation a été envoyé à ${email}.`);
    errorMessage.style.color = 'var(--color-success)';
  } catch (err) {
    console.error('Erreur de réinitialisation :', err);
    errorMessage.style.color = '';
    showError(translateAuthError(err));
  }
});
