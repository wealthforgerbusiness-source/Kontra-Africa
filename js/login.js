import { auth, googleProvider } from "./firebase-config.js";
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ============================================================
// KONTRA AFRICA — GOOGLE LOGIN
// ============================================================

const loginButton = document.getElementById("google-login");
const errorMessage = document.getElementById("login-error");

// ------------------------------------------------------------
// Afficher une erreur
// ------------------------------------------------------------
function showError(message) {
  console.error("❌ Google Login:", message);

  if (errorMessage) {
    errorMessage.textContent = message;
    errorMessage.style.display = "block";
  } else {
    alert(message);
  }
}

// ------------------------------------------------------------
// Détecter si on est sur mobile
// ------------------------------------------------------------
function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// ------------------------------------------------------------
// Connexion Google
// ------------------------------------------------------------
async function loginWithGoogle() {
  try {
    if (loginButton) {
      loginButton.disabled = true;
      loginButton.textContent = "Connexion...";
    }

    // Garder la session Firebase
    await setPersistence(auth, browserLocalPersistence);

    // ========================================================
    // MOBILE
    // ========================================================
    if (isMobile()) {
      console.log("📱 Connexion mobile → redirect");

      await signInWithRedirect(auth, googleProvider);
      return;
    }

    // ========================================================
    // PC
    // ========================================================
    console.log("💻 Connexion PC → popup");

    const result = await signInWithPopup(auth, googleProvider);

    if (result?.user) {
      await handleUser(result.user);
    }

  } catch (error) {
    console.error("Erreur Google:", error);

    if (loginButton) {
      loginButton.disabled = false;
      loginButton.textContent = "Continuer avec Google";
    }

    showError(
      "La connexion Google n'a pas pu être finalisée. " +
      "Vérifiez votre connexion Internet puis réessayez."
    );
  }
}

// ------------------------------------------------------------
// Récupérer le résultat après le retour de Google
// ------------------------------------------------------------
async function checkRedirectLogin() {
  try {
    console.log("🔄 Vérification du retour Google...");

    const result = await getRedirectResult(auth);

    if (result?.user) {
      console.log("✅ Connexion Google réussie :", result.user.email);

      await handleUser(result.user);
    } else {
      console.log("ℹ️ Aucun résultat de connexion Google.");
    }

  } catch (error) {
    console.error("❌ Redirect Google error:", error);

    if (loginButton) {
      loginButton.disabled = false;
      loginButton.textContent = "Continuer avec Google";
    }

    showError(
      "Google n'a pas pu terminer la connexion. " +
      "Essayez à nouveau depuis Chrome."
    );
  }
}

// ------------------------------------------------------------
// Après connexion Firebase
// ------------------------------------------------------------
async function handleUser(user) {
  try {
    console.log("👤 Utilisateur :", user.email);

    const idToken = await user.getIdToken();

    // --------------------------------------------------------
    // Initialisation de l'utilisateur côté backend
    // --------------------------------------------------------
    const response = await fetch(
      "https://kontra-africa.onrender.com/api/init-user",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || "",
          photoURL: user.photoURL || ""
        })
      }
    );

    if (!response.ok) {
      throw new Error(
        `Erreur serveur : ${response.status}`
      );
    }

    const data = await response.json();

    console.log("✅ Utilisateur initialisé :", data);

    // --------------------------------------------------------
    // Redirection
    // --------------------------------------------------------
    window.location.href = "dashboard.html";

  } catch (error) {
    console.error("❌ Initialisation utilisateur:", error);

    if (loginButton) {
      loginButton.disabled = false;
      loginButton.textContent = "Continuer avec Google";
    }

    showError(
      "Votre compte Google est connecté, " +
      "mais Kontra Africa n'a pas pu initialiser votre compte."
    );
  }
}

// ------------------------------------------------------------
// Bouton Google
// ------------------------------------------------------------
if (loginButton) {
  loginButton.addEventListener("click", loginWithGoogle);
} else {
  console.warn("⚠️ Bouton #google-login introuvable.");
}

// ------------------------------------------------------------
// Vérifier le retour de Google au chargement
// ------------------------------------------------------------
checkRedirectLogin();
