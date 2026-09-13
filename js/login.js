// ============================================================
// SYSTÈME DE CAPTURE UNIVERSEL DES ERREURS (AVANT TOUT IMPORT)
// ============================================================
// Aucune console développeur n'est disponible côté mobile : tout est donc
// affiché directement à l'écran dans l'encadré #debug-log.
//
// IMPORTANT : signInWithRedirect() fait quitter complètement la page vers
// Google puis revenir — c'est un vrai rechargement de page, qui efface tout
// ce qui est en mémoire. Le journal est donc aussi persisté dans
// localStorage pour survivre à ce rechargement et rester lisible au retour.

const DEBUG_LOG_STORAGE_KEY = 'kontra_debug_log_v1';
const DEBUG_LOG_MAX_CHARS = 20000; // évite une croissance illimitée

const debugLogEl = document.getElementById('debug-log');

function loadPersistedDebugLog() {
  try {
    return localStorage.getItem(DEBUG_LOG_STORAGE_KEY) || '';
  } catch (e) {
    return '';
  }
}

function persistDebugLog(fullText) {
  try {
    const trimmed = fullText.length > DEBUG_LOG_MAX_CHARS
      ? fullText.slice(fullText.length - DEBUG_LOG_MAX_CHARS)
      : fullText;
    localStorage.setItem(DEBUG_LOG_STORAGE_KEY, trimmed);
  } catch (e) {
    // localStorage indisponible ou plein : on continue sans persister,
    // le journal reste au moins visible en mémoire pour la session en cours.
  }
}

function debugLog(...args) {
  const time = new Date().toLocaleTimeString('fr-FR', { hour12: false });
  const message = args.map(a => {
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    return typeof a === 'object' ? JSON.stringify(a) : String(a);
  }).join(' ');
  const line = `[${time}] ${message}`;
  if (debugLogEl) {
    debugLogEl.textContent += line + '\n';
    debugLogEl.scrollTop = debugLogEl.scrollHeight;
    persistDebugLog(debugLogEl.textContent);
  } else {
    persistDebugLog(loadPersistedDebugLog() + line + '\n');
  }
}

// Au chargement du script, on réaffiche d'abord le journal des sessions
// précédentes (avant la redirection Google, par exemple), avec un séparateur
// visuel pour bien distinguer chaque chargement de page.
if (debugLogEl) {
  const previousLog = loadPersistedDebugLog();
  if (previousLog) {
    debugLogEl.textContent = previousLog;
    debugLogEl.scrollTop = debugLogEl.scrollHeight;
  }
}

// Capture toute erreur JS non attrapée (y compris hors de nos try/catch,
// dans des scripts tiers, etc.)
window.addEventListener('error', (event) => {
  debugLog('💥 ERREUR JS NON CAPTURÉE:', event.message, 'à', event.filename + ':' + event.lineno);
});

// Capture toute Promise rejetée sans .catch()
window.addEventListener('unhandledrejection', (event) => {
  debugLog('💥 PROMESSE REJETÉE NON CAPTURÉE:', event.reason?.message || event.reason);
});

debugLog('———— Nouveau chargement de page ————');
debugLog('✅ Script login.js démarré');

// ------------------------------------------------------------
// TRACEUR D'OPÉRATION EN COURS
// ------------------------------------------------------------
// Sert à savoir précisément ce que le script était en train de faire si la
// page se décharge/recharge de façon inattendue en plein milieu d'un flux
// de connexion (ex : Chrome qui décharge l'onglet pour libérer de la
// mémoire pendant que l'utilisateur est sur l'écran Google).

let currentOperation = 'aucune opération en cours';

function setOperation(op) {
  currentOperation = op;
}

window.addEventListener('pagehide', (event) => {
  debugLog('👋 pagehide déclenché — opération en cours au moment du déchargement:', currentOperation, 'persisted:', event.persisted);
});

window.addEventListener('visibilitychange', () => {
  debugLog('👁️ Visibilité changée:', document.visibilityState, '— opération en cours:', currentOperation);
});

// ============================================================
// IMPORTS
// ============================================================

import { auth, googleProvider } from '/js/firebase-config.js';

import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

const API_BASE_URL = 'https://kontra-africa.onrender.com';

// ============================================================
// CONFIGURATION
// ============================================================

const INIT_USER_TIMEOUT_MS = 120000; // 2 minutes
const INIT_USER_MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

// Clé localStorage posée juste avant signInWithRedirect(), et lue au
// rechargement de la page après le retour de Google, pour savoir qu'un
// résultat de redirection est attendu.
const AUTH_PENDING_KEY = 'kontra_auth_pending';

// Si getRedirectResult() ne s'est toujours pas résolu après ce délai suite à
// un retour de redirection, on propose le secours "Ouvrir dans le
// navigateur" (bug connu : le stockage de session utilisé par le redirect
// n'est parfois pas partagé avec la webview d'une PWA installée).
const REDIRECT_FALLBACK_TIMEOUT_MS = 8000;

// ============================================================
// RÉVEIL ANTICIPÉ DU SERVEUR (Render se met en veille après inactivité)
// ============================================================
// On envoie un ping vers /health DÈS LE CHARGEMENT de la page de connexion,
// bien avant que l'utilisateur ne clique sur "Continuer avec Google". Le
// temps que l'utilisateur lise l'écran et coche la case CGU, le serveur a
// généralement déjà eu le temps de se réveiller en arrière-plan. Résultat :
// au moment où initUserOnBackend() est appelé après la connexion Google,
// le serveur répond quasi instantanément au lieu de faire attendre
// l'utilisateur plusieurs dizaines de secondes (fenêtre de risque réduite
// pour le problème des onglets déchargés en arrière-plan).

const SERVER_WARMUP_TIMEOUT_MS = 45000; // 45s max d'attente pour le réveil

let serverIsWarm = false;

const serverWarmupPromise = (async () => {
  try {
    debugLog('🔥 Ping de réveil envoyé vers', `${API_BASE_URL}/health`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SERVER_WARMUP_TIMEOUT_MS);

    const response = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      serverIsWarm = true;
      debugLog('🔥 Serveur réveillé et prêt (ping /health OK)');
    } else {
      debugLog('🔥 Ping /health a répondu mais avec un statut', response.status);
    }
  } catch (err) {
    debugLog('🔥 Échec du ping de réveil (le serveur tentera quand même via init-user):', err?.message || err);
  }
})();

// ============================================================
// DETECTION MOBILE / STANDALONE
// ============================================================
// signInWithPopup() a été testé et confirmé fonctionnel sur mobile
// (navigateur classique, non installé) — voir logs de diagnostic du
// 13/09. On l'utilise donc désormais PARTOUT, y compris en PWA installée,
// car signInWithRedirect() est plus fragile : la page quitte complètement
// l'app pour Google puis revient sur un nouveau chargement, et si le
// téléphone a beaucoup d'onglets/apps ouverts, l'ancienne instance de la
// PWA peut être déchargée par le système avant d'avoir pu récupérer le
// résultat (getRedirectResult() revient alors vide, même si la connexion
// Google a réussi). Avec Popup, la page d'origine ne quitte jamais son
// contexte, ce qui évite ce problème.
//
// signInWithRedirect() reste utilisé uniquement en solution de secours
// automatique si le navigateur bloque la fenêtre popup (voir
// startGoogleSignIn ci-dessous).

const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

const isMobileDevice =
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (window.matchMedia('(pointer: coarse)').matches &&
    window.matchMedia('(hover: none)').matches);

debugLog('📱 Détection appareil — standalone:', isStandalone, 'mobile:', isMobileDevice, '(popup utilisé en priorité dans tous les cas)');

// ------------------------------------------------------------
// DIAGNOSTIC DOMAINE (cause fréquente d'un getRedirectResult() qui
// revient toujours null : le domaine réel de la page n'est pas dans
// la liste des domaines autorisés de Firebase, ou ne correspond pas
// à authDomain).
// ------------------------------------------------------------

debugLog('🌐 Domaine actuel (hostname):', window.location.hostname);
debugLog('🌐 Origine actuelle (origin):', window.location.origin);
debugLog('🌐 authDomain configuré dans Firebase:', auth?.config?.authDomain || 'inconnu');
debugLog('🍪 Cookies activés:', navigator.cookieEnabled);

try {
  if (window.indexedDB) {
    debugLog('💾 IndexedDB disponible: oui');
  } else {
    debugLog('💾 IndexedDB disponible: NON — la redirection Google ne peut pas fonctionner sans IndexedDB');
  }
} catch (err) {
  debugLog('💾 Erreur test IndexedDB:', err, 'stack:', err?.stack || 'pas de stack');
}

// ============================================================
// ELEMENTS
// ============================================================

const googleBtn = document.getElementById('googleBtn');
const termsCheckbox = document.getElementById('termsCheckbox');

const loadingState = document.getElementById('loadingState');
const loadingLabel = document.getElementById('loadingLabel');

const errorState = document.getElementById('errorState');
const errorMessage = document.getElementById('errorMessage');

const retryBtn = document.getElementById('retryBtn');

const openBrowserFallback = document.getElementById('openBrowserFallback');
const openBrowserBtn = document.getElementById('openBrowserBtn');


// ============================================================
// UI
// ============================================================

function showButton() {
  googleBtn.hidden = false;
  googleBtn.disabled = !termsCheckbox.checked;

  loadingState.hidden = true;
  errorState.hidden = true;
  if (openBrowserFallback) openBrowserFallback.hidden = true;
}

function showLoading(label) {
  googleBtn.hidden = true;

  loadingState.hidden = false;
  errorState.hidden = true;
  if (openBrowserFallback) openBrowserFallback.hidden = true;

  loadingLabel.textContent = label;
}

function showError(message) {
  googleBtn.hidden = false;
  googleBtn.disabled = !termsCheckbox.checked;

  loadingState.hidden = true;
  if (openBrowserFallback) openBrowserFallback.hidden = true;

  errorState.hidden = false;
  errorMessage.textContent = message;
}

// Secours affiché si le retour de redirection reste bloqué trop longtemps
// (typiquement en PWA installée — voir REDIRECT_FALLBACK_TIMEOUT_MS).
function showOpenBrowserFallback() {
  if (!openBrowserFallback) return;

  googleBtn.hidden = true;
  loadingState.hidden = true;
  errorState.hidden = true;
  openBrowserFallback.hidden = false;
}

// ============================================================
// UTILITAIRE
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// ERREURS FIREBASE
// ============================================================

function translateAuthError(error) {
  debugLog('❌ Firebase Auth error:', error, error?.code || 'pas de code', 'stack:', error?.stack || 'pas de stack');

  const code = error?.code;

  switch (code) {

    case 'auth/popup-closed-by-user':
      return "La fenêtre Google a été fermée. Réessayez.";

    case 'auth/cancelled-popup-request':
      return "La connexion a été annulée. Réessayez.";

    case 'auth/popup-blocked':
      return "Le navigateur a bloqué la fenêtre Google. Autorisez les fenêtres pop-up puis réessayez.";

    case 'auth/network-request-failed':
      return "Problème de connexion Internet. Vérifiez votre connexion.";

    case 'auth/unauthorized-domain':
      return "Ce domaine n'est pas autorisé dans Firebase Authentication.";

    case 'auth/operation-not-allowed':
      return "La connexion Google n'est pas activée dans Firebase.";

    case 'auth/invalid-credential':
      return "Les informations Google reçues sont invalides. Réessayez.";

    case 'auth/internal-error':
      return "Google a rencontré une erreur interne. Réessayez.";

    default:
      return "La connexion avec Google a échoué. Réessayez.";
  }
}

// ============================================================
// INITIALISATION UTILISATEUR COTE BACKEND
// ============================================================

async function initUserOnBackend(firebaseUser) {

  debugLog('🚀 initUserOnBackend() démarré pour', firebaseUser?.email || 'email inconnu');
  setOperation('initUserOnBackend');

  const idToken = await firebaseUser.getIdToken();

  const payload = {
    email: firebaseUser.email || '',

    displayName:
      firebaseUser.displayName || '',

    photoURL:
      firebaseUser.photoURL || ''
  };

  let lastError = null;

  // ----------------------------------------------------------
  // PLUSIEURS TENTATIVES AUTOMATIQUES
  // ----------------------------------------------------------

  for (
    let attempt = 1;
    attempt <= INIT_USER_MAX_ATTEMPTS;
    attempt++
  ) {

    showLoading(
      attempt === 1
        ? "Préparation de votre espace…"
        : `Le serveur démarre… nouvelle tentative ${attempt}/${INIT_USER_MAX_ATTEMPTS}`
    );

    debugLog(
      `🚀 init-user : tentative ${attempt}/${INIT_USER_MAX_ATTEMPTS}`
    );

    const controller = new AbortController();

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, INIT_USER_TIMEOUT_MS);

    try {

      const response = await fetch(
        `${API_BASE_URL}/api/init-user`,
        {
          method: 'POST',

          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },

          body: JSON.stringify(payload),

          signal: controller.signal
        }
      );

      clearTimeout(timeoutId);

      // ------------------------------------------------------
      // SUCCÈS
      // ------------------------------------------------------

      if (response.ok) {

        const data = await response
          .json()
          .catch((jsonErr) => {
            debugLog('⚠️ Réponse init-user OK mais JSON invalide:', jsonErr?.message, 'stack:', jsonErr?.stack || 'pas de stack');
            return {};
          });

        debugLog(
          '✅ Compte initialisé côté serveur',
          data
        );

        return data;
      }

      // ------------------------------------------------------
      // ERREUR SERVEUR
      // ------------------------------------------------------

      const error = new Error(
        `init-user a répondu avec le statut ${response.status}`
      );

      debugLog(
        `❌ Tentative ${attempt} échouée :`,
        error,
        'stack:', error?.stack || 'pas de stack'
      );

      lastError = error;

      // Les erreurs 4xx définitives ne nécessitent
      // généralement pas de nouvelle tentative.
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429
      ) {
        throw error;
      }

    } catch (err) {

      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {

        debugLog(
          `⏱️ Timeout init-user à la tentative ${attempt}`
        );

        lastError = new Error(
          'TIMEOUT_INIT_USER'
        );

      } else {

        debugLog(
          `❌ Erreur init-user tentative ${attempt}:`,
          err,
          'stack:', err?.stack || 'pas de stack'
        );

        lastError = err;
      }
    }

    // --------------------------------------------------------
    // ATTENTE AVANT NOUVEL ESSAI
    // --------------------------------------------------------

    if (attempt < INIT_USER_MAX_ATTEMPTS) {

      showLoading(
        "Le serveur démarre… veuillez patienter."
      );

      debugLog(
        `⏳ Nouvelle tentative dans ${RETRY_DELAY_MS / 1000} secondes`
      );

      await sleep(RETRY_DELAY_MS);
    }
  }

  // ----------------------------------------------------------
  // TOUTES LES TENTATIVES ONT ÉCHOUÉ
  // ----------------------------------------------------------

  debugLog('❌ init-user : toutes les tentatives ont échoué. Dernière erreur:', lastError, 'stack:', lastError?.stack || 'pas de stack');

  throw lastError || new Error(
    'INIT_USER_FAILED'
  );
}

// ============================================================
// CONNEXION TERMINEE
// ============================================================

async function completeSignIn(firebaseUser) {

  try {

    debugLog(
      '✅ Firebase connecté :',
      firebaseUser.email
    );

    // --------------------------------------------------------
    // PREPARATION DU COMPTE
    // --------------------------------------------------------

    await initUserOnBackend(firebaseUser);

    debugLog(
      '✅ Utilisateur prêt côté serveur'
    );

    // --------------------------------------------------------
    // DASHBOARD
    // --------------------------------------------------------

    debugLog('➡️ Redirection vers /dashboard.html');

    window.location.href =
      '/dashboard.html';

  } catch (err) {

    debugLog(
      '❌ Impossible de préparer le compte :',
      err,
      'message:', err?.message || 'pas de message',
      'stack:', err?.stack || 'pas de stack'
    );

    if (
      err.message === 'TIMEOUT_INIT_USER'
    ) {

      showError(
        "Le serveur met trop de temps à démarrer. Vérifiez votre connexion puis réessayez."
      );

    } else {

      showError(
        "Google vous a connecté, mais votre espace n'a pas pu être préparé. Réessayez."
      );
    }
  }
}

// ============================================================
// RESULTAT DE REDIRECTION (retour de Google après signInWithRedirect)
// ============================================================

async function checkRedirectResult() {

  debugLog('🔎 checkRedirectResult() démarré');

  const wasPending = localStorage.getItem(AUTH_PENDING_KEY) === '1';

  debugLog('🔎 wasPending:', wasPending);

  let fallbackTimer = null;

  if (wasPending) {
    // On sait qu'une redirection Google était en cours : on affiche un état
    // de chargement dédié, avec un filet de sécurité si ça traîne trop.
    showLoading("Finalisation de la connexion…");

    fallbackTimer = setTimeout(
      showOpenBrowserFallback,
      REDIRECT_FALLBACK_TIMEOUT_MS
    );
  } else {
    // Rien en attente : écran normal tout de suite, la vérification se fait
    // silencieusement en arrière-plan.
    showButton();
  }

  try {

    debugLog('🔎 Appel de getRedirectResult(auth)...');
    setOperation('getRedirectResult (checkRedirectResult)');

    const result = await getRedirectResult(auth);

    debugLog('🔎 getRedirectResult() résolu, result:', result ? 'objet reçu' : 'null/undefined');
    setOperation('aucune opération en cours');

    if (fallbackTimer) clearTimeout(fallbackTimer);

    if (result && result.user) {

      localStorage.removeItem(AUTH_PENDING_KEY);

      debugLog(
        '✅ Google connecté (redirect) :',
        result.user.email
      );

      await completeSignIn(result.user);
      return;
    }

    // Aucun résultat exploitable. Si on attendait un retour de connexion
    // (redirect OU popup interrompu par un rechargement de page — ex :
    // l'onglet a été déchargé par le navigateur en arrière-plan, ce qui
    // arrive souvent avec beaucoup d'onglets ouverts), on ne doit JAMAIS
    // laisser l'utilisateur revenir silencieusement à l'écran de départ
    // sans explication : il faut un message clair + un bouton Réessayer.
    if (wasPending) {
      debugLog('⚠️ Connexion attendue mais aucun résultat exploitable reçu — la page a probablement été interrompue/rechargée pendant le processus');
      localStorage.removeItem(AUTH_PENDING_KEY);
      showError(
        "Supprimez vos onglets en arrière-plan : cela peut bloquer la connexion."
      );
    }

  } catch (err) {

    setOperation('aucune opération en cours');

    if (fallbackTimer) clearTimeout(fallbackTimer);

    localStorage.removeItem(AUTH_PENDING_KEY);

    debugLog(
      '❌ Erreur redirect Google :',
      err,
      'message:', err?.message || 'pas de message',
      'code:', err?.code || 'pas de code',
      'stack:', err?.stack || 'pas de stack'
    );

    showError(translateAuthError(err));
  }
}

// ============================================================
// CONNEXION GOOGLE
// ============================================================

async function startGoogleSignIn() {

  // CRITIQUE : ce log doit apparaître dès le clic, avant toute autre
  // vérification, pour savoir si le clic est bien détecté par le JS.
  debugLog('👆 Clic bouton Google détecté, checkbox coché:', termsCheckbox.checked);
  setOperation('startGoogleSignIn (juste après le clic)');

  if (!termsCheckbox.checked) {
    debugLog('⛔ Checkbox non cochée, connexion annulée');
    return;
  }

  // --------------------------------------------------------
  // ATTENTE DU RÉVEIL SERVEUR (si le ping envoyé au chargement de
  // la page n'a pas encore fini) — AVANT d'ouvrir le popup Google.
  // Dans la grande majorité des cas, le ping envoyé au chargement de
  // la page a déjà fini pendant que l'utilisateur lisait l'écran et
  // cochait la case : cette étape est alors instantanée et invisible.
  // --------------------------------------------------------

  if (!serverIsWarm) {

    debugLog('🔥 Serveur pas encore confirmé prêt, attente avant le popup Google...');

    showLoading("Préparation du serveur…");

    await Promise.race([
      serverWarmupPromise,
      sleep(SERVER_WARMUP_TIMEOUT_MS)
    ]);

    debugLog('🔥 Fin de l\'attente de réveil, ouverture du popup Google');
  }

  showLoading(
    "Connexion à Google…"
  );

  // Posé pour les DEUX flux (Popup ET Redirect) : sert à détecter, au
  // prochain chargement de page, qu'une connexion était en cours et a été
  // interrompue avant d'aboutir (rechargement forcé du navigateur, onglet
  // déchargé en arrière-plan, etc.) — voir checkRedirectResult().
  localStorage.setItem(AUTH_PENDING_KEY, '1');

  try {

    // --------------------------------------------------------
    // PERSISTENCE FIREBASE
    // --------------------------------------------------------

    debugLog('🔐 Appel de setPersistence()...');
    setOperation('setPersistence');

    await setPersistence(
      auth,
      browserLocalPersistence
    );

    debugLog(
      '🔐 Persistence Firebase configurée'
    );

    // --------------------------------------------------------
    // POPUP EN PRIORITE (mobile ET desktop)
    // --------------------------------------------------------
    // Le popup garde la page d'origine active en permanence : elle ne
    // quitte jamais son contexte, donc pas de risque que le système
    // décharge l'app en arrière-plan pendant l'échange avec Google.

    debugLog('🌐 Connexion Google avec Popup');
    debugLog('🌐 Appel de signInWithPopup()...');
    setOperation('signInWithPopup');

    let result;

    try {

      result = await signInWithPopup(
        auth,
        googleProvider
      );

    } catch (popupErr) {

      // Repli automatique sur Redirect UNIQUEMENT si le navigateur a
      // concrètement bloqué l'ouverture de la fenêtre popup (cas rare).
      // Dans tous les autres cas (fermeture volontaire, annulation...),
      // on laisse l'erreur remonter normalement.
      if (popupErr?.code === 'auth/popup-blocked') {

        debugLog('⚠️ Popup bloquée par le navigateur — repli sur signInWithRedirect()');

        debugLog('📱 Appel de signInWithRedirect()...');
        setOperation('signInWithRedirect (repli après popup bloquée)');

        await signInWithRedirect(
          auth,
          googleProvider
        );

        debugLog('📱 signInWithRedirect() résolu (la page devrait être redirigée)');

        return; // La page va être rechargée par la redirection Google.
      }

      throw popupErr;
    }

    debugLog('🌐 signInWithPopup() résolu');
    setOperation('aucune opération en cours (popup résolu)');
    localStorage.removeItem(AUTH_PENDING_KEY);

    // --------------------------------------------------------
    // VERIFICATION UTILISATEUR
    // --------------------------------------------------------

    if (
      !result ||
      !result.user
    ) {

      throw new Error(
        'Aucun utilisateur Google reçu.'
      );
    }

    debugLog(
      '✅ Google connecté :',
      result.user.email
    );

    // --------------------------------------------------------
    // INITIALISATION DU COMPTE
    // --------------------------------------------------------

    await completeSignIn(
      result.user
    );

  } catch (err) {

    setOperation('aucune opération en cours');
    localStorage.removeItem(AUTH_PENDING_KEY);

    debugLog(
      '❌ Erreur Google:',
      err,
      'message:', err?.message || 'pas de message',
      'code:', err?.code || 'pas de code',
      'stack:', err?.stack || 'pas de stack'
    );

    showError(
      translateAuthError(err)
    );
  }
}

// ============================================================
// CHECKBOX CONDITIONS
// ============================================================

termsCheckbox.addEventListener(
  'change',
  () => {

    debugLog('☑️ Checkbox changée, coché:', termsCheckbox.checked);

    googleBtn.disabled =
      !termsCheckbox.checked;
  }
);

// ============================================================
// BOUTON GOOGLE
// ============================================================

googleBtn.addEventListener(
  'click',
  startGoogleSignIn
);

debugLog('🎯 Event listener attaché au bouton Google');

// ============================================================
// BOUTON RETRY
// ============================================================

if (retryBtn) {

  retryBtn.addEventListener(
    'click',
    () => {

      debugLog('🔁 Clic bouton Réessayer');

      showButton();

    }
  );
}

// ============================================================
// BOUTON X — fermeture manuelle de la notification
// ============================================================

const errorCloseBtn = document.getElementById('errorCloseBtn');

if (errorCloseBtn) {

  errorCloseBtn.addEventListener(
    'click',
    () => {

      debugLog('✖️ Notification d\'erreur fermée manuellement');

      errorState.hidden = true;

    }
  );
}

// ============================================================
// BOUTON "OUVRIR DANS LE NAVIGATEUR" (secours PWA bloquée)
// ============================================================

if (openBrowserBtn) {

  openBrowserBtn.addEventListener(
    'click',
    () => {

      debugLog('🌍 Clic bouton "Ouvrir dans le navigateur"');

      localStorage.removeItem(AUTH_PENDING_KEY);

      // Ouvre la page de connexion dans un nouvel onglet du navigateur
      // système : en PWA standalone (Android/iOS), window.open() en dehors
      // du contexte installé bascule vers le navigateur classique.
      window.open(window.location.href, '_blank');

      showButton();

    }
  );
}

// ============================================================
// INITIALISATION
// ============================================================

checkRedirectResult();

debugLog(
  '✅ Kontra-Africa Login chargé'
);
