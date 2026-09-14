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
// généralement déjà eu le temps de se réveiller en arrière-plan.
//
// CORRECTIF IMPORTANT : ce réveil reste désormais STRICTEMENT une tâche de
// fond. Il ne doit plus jamais être attendu (`await`) avant d'ouvrir le
// popup Google au clic — voir l'explication détaillée dans
// startGoogleSignIn() plus bas. Il sert uniquement à ce que le serveur soit
// déjà chaud quand on l'appelle après la connexion Google (initUserOnBackend).

const SERVER_WARMUP_TIMEOUT_MS = 100000; // jusqu'à 100s d'attente pour le réveil complet de Render

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
// PERSISTENCE FIREBASE (configurée UNE SEULE FOIS, ici, au chargement du
// script — plus jamais au moment du clic)
// ============================================================
// Avant, setPersistence() était appelé à l'intérieur de startGoogleSignIn(),
// donc `await` juste avant signInWithPopup(). Un `await` — même court —
// placé entre le clic de l'utilisateur et l'appel à signInWithPopup() peut
// suffire à faire perdre le "geste utilisateur" aux yeux du navigateur, qui
// bloque alors le popup Google SANS forcément renvoyer une erreur claire
// (le popup n'apparaît juste jamais). En configurant la persistence une
// seule fois ici, dès le chargement de la page, elle est quasi toujours déjà
// terminée au moment du clic — on retire ainsi un délai inutile du chemin
// critique menant à l'ouverture du popup.

const persistenceReadyPromise = setPersistence(auth, browserLocalPersistence)
  .then(() => {
    debugLog('🔐 Persistence Firebase configurée (au chargement de la page)');
  })
  .catch((err) => {
    debugLog('⚠️ Échec de configuration de la persistence Firebase:', err?.message || err);
  });

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
  retryBtn.hidden = true;

  loadingState.hidden = true;
  errorState.hidden = true;
  if (openBrowserFallback) openBrowserFallback.hidden = true;
}

function showLoading(label) {
  googleBtn.hidden = true;
  retryBtn.hidden = true;

  loadingState.hidden = false;
  errorState.hidden = true;
  if (openBrowserFallback) openBrowserFallback.hidden = true;

  loadingLabel.textContent = label;
}

function showError(message, { directRetry = true } = {}) {

  if (directRetry) {
    // Erreur survenue pendant la session en cours (case CGU déjà cochée en
    // mémoire) : on peut relancer Google directement via le bouton rouge.
    googleBtn.hidden = true;
    retryBtn.hidden = false;
  } else {
    // Erreur détectée au chargement de la page (ex: connexion précédente
    // interrompue) : la case CGU est forcément décochée sur ce nouveau
    // chargement, donc impossible de relancer Google directement. On
    // réaffiche l'écran normal (case à cocher + bouton Google) plutôt que
    // le bouton "Réessayer", qui ne ferait rien tant que la case n'est pas
    // recochée.
    googleBtn.hidden = false;
    googleBtn.disabled = !termsCheckbox.checked;
    retryBtn.hidden = true;
  }

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
  retryBtn.hidden = true;
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
        "Supprimez vos onglets en arrière-plan : cela peut bloquer la connexion.",
        { directRetry: false }
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

    showError(translateAuthError(err), { directRetry: false });
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
  // CORRECTIF : on n'attend PLUS le réveil de Render ici.
  //
  // Avant, le code faisait `await serverWarmupPromise` avant d'ouvrir le
  // popup Google. Le souci : la plupart des navigateurs n'autorisent
  // l'ouverture d'une fenêtre pop-up que si elle est déclenchée quasi
  // immédiatement après un geste utilisateur (le clic). Dès qu'on insère un
  // `await` qui peut durer plusieurs secondes voire dizaines de secondes
  // (le temps que Render démarre) avant d'appeler signInWithPopup(), le
  // navigateur ne considère plus cela comme une réaction directe au clic et
  // bloque silencieusement le popup — sans forcément renvoyer une erreur
  // claire. C'était très probablement la cause du bug "le popup Google
  // n'apparaît pas".
  //
  // Le réveil de Render continue de se faire, mais uniquement en tâche de
  // fond depuis le chargement de la page (serverWarmupPromise, déclenché
  // plus haut). Le temps que l'utilisateur choisisse son compte Google dans
  // le popup (quelques secondes), le serveur a généralement fini de se
  // réveiller. Et si jamais ce n'est pas encore le cas au moment d'appeler
  // le backend juste après, initUserOnBackend() gère déjà des tentatives
  // automatiques avec messages de progression.
  // --------------------------------------------------------

  debugLog('🔥 Statut du serveur au moment du clic (réveil déjà en tâche de fond depuis le chargement de la page) — serverIsWarm:', serverIsWarm);

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
    // Configurée une seule fois au chargement du script (voir
    // persistenceReadyPromise plus haut) : ici on s'assure juste qu'elle
    // est bien terminée, ce qui est quasi toujours déjà le cas et donc
    // quasi instantané (ne retarde pas l'ouverture du popup en pratique).

    await persistenceReadyPromise;

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

      debugLog('🔁 Clic bouton Réessayer — rechargement complet de la page de connexion (état SDK propre) avant de relancer Google');

      // CORRECTIF : on ne relance plus signInWithPopup() directement dans la
      // même page. Un premier échec (popup fermée trop vite, état interne
      // du SDK Firebase Auth resté partiellement initialisé, jeton de geste
      // utilisateur déjà consommé, etc.) laisse parfois la page dans un état
      // qui fait échouer une deuxième tentative immédiate au même endroit,
      // même si tout semble correct. Un rechargement complet de login.html
      // repart d'un état totalement propre (nouveau script, nouvelle
      // instance Auth), ce qui correspond au comportement observé : la
      // deuxième tentative réussit presque toujours après un vrai rechargement.
      window.location.href = '/login.html';

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

      // Le bouton Google était masqué pendant l'erreur (voir showError) :
      // on le réaffiche ici pour que l'écran ne reste pas vide.
      showButton();

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
