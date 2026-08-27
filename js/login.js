import { auth, googleProvider } from '/js/firebase-config.js';
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  indexedDBLocalPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

const API_BASE_URL = 'https://kontra-africa.onrender.com';
const REDIRECT_KEY = 'kontra_auth_pending'; // marque qu'une connexion par redirection est en cours
const INIT_USER_TIMEOUT_MS = 60000; // le backend Render (plan gratuit) peut mettre jusqu'à ~50s à répondre après une inactivité (cold start)
const STANDALONE_STUCK_TIMEOUT_MS = 12000; // si rien ne se passe après 12s en mode PWA installée, on propose une solution de secours

const googleBtn = document.getElementById('googleBtn');
const loadingState = document.getElementById('loadingState');
const loadingLabel = document.getElementById('loadingLabel');
const errorState = document.getElementById('errorState');
const errorMessage = document.getElementById('errorMessage');
const retryBtn = document.getElementById('retryBtn');
const termsCheckbox = document.getElementById('termsCheckbox');
const openBrowserFallback = document.getElementById('openBrowserFallback');
const openBrowserBtn = document.getElementById('openBrowserBtn');

/* --- Détection mobile --- */
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/* --- Détection "PWA installée" (mode standalone) : c'est ce mode qui pose
   problème avec l'authentification Google (stockage de session isolé sur
   certains navigateurs). On le détecte pour adapter le comportement. --- */
const isStandalonePWA =
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true; // iOS Safari

let redirectWatchdog = null;
let authHandledByListener = false;

/* --- CGU obligatoires : le bouton Google reste désactivé tant que la case
   n'est pas cochée. --- */
function updateGoogleBtnState() {
  googleBtn.disabled = !termsCheckbox.checked;
}

if (termsCheckbox) {
  termsCheckbox.addEventListener('change', updateGoogleBtnState);
}

/* --- Gestion des états visuels --- */
function showButton() {
  googleBtn.hidden = false;
  loadingState.hidden = true;
  errorState.hidden = true;
  if (openBrowserFallback) openBrowserFallback.hidden = true;
  updateGoogleBtnState();
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
  if (openBrowserFallback) openBrowserFallback.hidden = true;
}

/* --- Si on est en PWA installée et que rien n'a bougé après quelques
   secondes, on propose d'ouvrir la page dans le navigateur normal : ça
   contourne 100% des cas de blocage liés au mode standalone. --- */
function armStandaloneWatchdog() {
  if (!isStandalonePWA) return;
  clearStandaloneWatchdog();
  redirectWatchdog = setTimeout(() => {
    if (authHandledByListener) return;
    if (openBrowserFallback) openBrowserFallback.hidden = false;
  }, STANDALONE_STUCK_TIMEOUT_MS);
}

function clearStandaloneWatchdog() {
  if (redirectWatchdog) {
    clearTimeout(redirectWatchdog);
    redirectWatchdog = null;
  }
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
    case 'auth/operation-not-supported-in-this-environment':
      return "Cette méthode de connexion n'est pas prise en charge ici. Essayez d'ouvrir la page dans votre navigateur.";
    default:
      return "La connexion avec Google a échoué. Réessayez.";
  }
}

/* --- Assure une persistance de session robuste avant toute tentative de
   connexion. En mode PWA installée, certains navigateurs (Safari iOS,
   Samsung Internet, WebView Android) perdent l'état de session par défaut
   après un retour de redirection OAuth. indexedDBLocalPersistence est la
   plus fiable dans ce contexte ; on retombe sur browserLocalPersistence
   si elle n'est pas disponible. --- */
async function ensureRobustPersistence() {
  try {
    await setPersistence(auth, indexedDBLocalPersistence);
  } catch (err) {
    console.warn('indexedDBLocalPersistence indisponible, repli sur browserLocalPersistence', err);
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch (err2) {
      console.warn('Persistance renforcée indisponible, utilisation de la persistance par défaut', err2);
    }
  }
}

/* --- Appel backend : crée/initialise le profil utilisateur --- */
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
  clearStandaloneWatchdog();
  try {
    await initUserOnBackend(firebaseUser);
    sessionStorage.removeItem(REDIRECT_KEY);
    window.location.href = '/dashboard.html';
  } catch (err) {
    console.error('Erreur init-user :', err);
    sessionStorage.removeItem(REDIRECT_KEY);

    if (err.message === 'TIMEOUT_INIT_USER') {
      showError("La préparation de votre espace prend plus de temps que prévu (le serveur démarre). Réessayez dans un instant.");
    } else {
      showError("Votre connexion Google a réussi, mais nous n'avons pas pu préparer votre espace. Réessayez.");
    }
  }
}

/* --- Lancement de la connexion Google --- */
async function startGoogleSignIn() {
  if (termsCheckbox && !termsCheckbox.checked) return;

  await ensureRobustPersistence();
  showLoading('Connexion à Google…');

  try {
    // En mode PWA installée OU sur mobile, on utilise toujours la redirection :
    // signInWithPopup ne fonctionne jamais en mode standalone (aucune fenêtre
    // popup n'est disponible), même si le navigateur ne renvoie pas d'erreur claire.
    if (isMobile || isStandalonePWA) {
      sessionStorage.setItem(REDIRECT_KEY, '1');
      armStandaloneWatchdog();
      await signInWithRedirect(auth, googleProvider);
      return;
    }

    const result = await signInWithPopup(auth, googleProvider);
    await completeSignIn(result.user);
  } catch (err) {
    console.error('Erreur signInWithGoogle :', err);
    sessionStorage.removeItem(REDIRECT_KEY);
    clearStandaloneWatchdog();
    showError(translateAuthError(err));
  }
}

/* --- Au chargement : vérifie si on revient d'une redirection Google ---
   IMPORTANT : on ne se fie PLUS à sessionStorage pour décider si on doit
   appeler getRedirectResult(). En PWA installée (Android WebAPK, iOS
   "Ajouter à l'écran d'accueil"), sessionStorage est souvent perdu au
   retour de la redirection OAuth alors que Firebase, lui, a bien authentifié
   l'utilisateur (son état est stocké dans IndexedDB, qui survit). Si on
   se fie au flag sessionStorage pour "gater" la vérification, on rate
   silencieusement les connexions pourtant réussies : c'était le bug. --- */
async function checkRedirectResult() {
  const wasPending = sessionStorage.getItem(REDIRECT_KEY);

  await ensureRobustPersistence();

  // On affiche un état "finalisation" uniquement si on sait qu'une
  // redirection était en cours, mais on tente TOUJOURS getRedirectResult().
  if (wasPending) {
    showLoading('Finalisation de la connexion…');
    armStandaloneWatchdog();
  }

  try {
    const result = await getRedirectResult(auth);
    if (result && result.user) {
      authHandledByListener = true;
      await completeSignIn(result.user);
      return;
    }
  } catch (err) {
    console.error('Erreur getRedirectResult :', err);
    sessionStorage.removeItem(REDIRECT_KEY);
    clearStandaloneWatchdog();
    showError(translateAuthError(err));
    return;
  }

  // Si getRedirectResult() n'a rien renvoyé (result null), on ne bascule PAS
  // directement sur le bouton : on laisse une petite fenêtre à
  // onAuthStateChanged ci-dessous pour rattraper le cas où Firebase a
  // pourtant bien restauré une session (bug connu du storage en mode PWA
  // standalone). Si rien ne se passe, on affiche quand même le bouton.
  if (!wasPending) {
    showButton();
  } else {
    setTimeout(() => {
      if (!authHandledByListener) showButton();
    }, 1500);
  }
}

/* --- Filet de sécurité : capte l'utilisateur connecté même si
   getRedirectResult() n'a rien renvoyé (bug de stockage en mode PWA).
   On ne conditionne PLUS ce filet à sessionStorage : c'est justement ce
   storage qui est perdu dans le scénario qu'on veut rattraper. --- */
onAuthStateChanged(auth, (user) => {
  if (authHandledByListener) return;
  if (user) {
    authHandledByListener = true;
    completeSignIn(user);
  }
});

/* --- Solution de secours : ouvrir la page de connexion dans le navigateur
   par défaut (hors mode PWA installée), pour contourner les blocages de
   stockage de session propres au mode standalone. --- */
if (openBrowserBtn) {
  openBrowserBtn.addEventListener('click', () => {
    sessionStorage.removeItem(REDIRECT_KEY);
    window.open(window.location.href, '_blank');
  });
}

googleBtn.addEventListener('click', startGoogleSignIn);
retryBtn.addEventListener('click', () => {
  sessionStorage.removeItem(REDIRECT_KEY);
  clearStandaloneWatchdog();
  showButton();
});

checkRedirectResult();
