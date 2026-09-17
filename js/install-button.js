// ============================================================
// js/install-button.js — Bouton d'installation permanent de la PWA
// ============================================================
// Contrairement à js/install-prompt.js (bannière que l'utilisateur peut
// fermer et qui ne réapparaît plus pendant 7 jours), ce script pilote un
// BOUTON PERMANENT visible en haut du dashboard :
//   - Au clic : déclenche l'installation native (Chrome/Android) ou
//     affiche les instructions manuelles (iOS/Safari).
//   - Si l'app est déjà installée (mode standalone) : le bouton l'indique
//     visuellement et, au clic, affiche un message "déjà installée" au
//     lieu de retenter une installation.
//
// À inclure via <script type="module" src="/js/install-button.js"></script>
// sur une page qui contient déjà :
//   #installAppBtn, #installAppBtnLabel

const btn = document.getElementById('installAppBtn');
const label = document.getElementById('installAppBtnLabel');

if (btn && label) {

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  function isStandaloneNow() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  let deferredPrompt = null;

  // --------------------------------------------------------
  // TOAST — petit message temporaire, autonome (pas de dépendance
  // sur un autre fichier), pour ne pas dépendre de composants
  // propres à une seule page (ex: js/stock.js).
  // --------------------------------------------------------

  function ensureToastStyles() {
    if (document.getElementById('install-btn-toast-styles')) return;
    const style = document.createElement('style');
    style.id = 'install-btn-toast-styles';
    style.textContent = `
      .install-btn-toast-container {
        position: fixed;
        left: 50%;
        bottom: max(20px, env(safe-area-inset-bottom));
        transform: translateX(-50%);
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: min(92vw, 380px);
        pointer-events: none;
      }
      .install-btn-toast {
        pointer-events: auto;
        background: #1f2430;
        color: #fff;
        font-size: 14px;
        line-height: 1.4;
        padding: 12px 16px;
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.25);
        animation: install-btn-toast-in 0.18s ease-out;
      }
      .install-btn-toast--closing {
        animation: install-btn-toast-out 0.18s ease-in forwards;
      }
      @keyframes install-btn-toast-in {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes install-btn-toast-out {
        from { opacity: 1; }
        to { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  function showToast(message, duration = 3500) {
    ensureToastStyles();
    let container = document.querySelector('.install-btn-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'install-btn-toast-container';
      container.setAttribute('aria-live', 'polite');
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'install-btn-toast';
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('install-btn-toast--closing');
      setTimeout(() => toast.remove(), 180);
    }, duration);
  }

  // --------------------------------------------------------
  // ÉTAT VISUEL DU BOUTON
  // --------------------------------------------------------

  function setInstalledState() {
    label.textContent = 'Application déjà installée';
    btn.classList.add('is-installed');
  }

  function setDefaultState() {
    label.textContent = "Installer l'application";
    btn.classList.remove('is-installed');
  }

  if (isStandaloneNow()) {
    setInstalledState();
  } else {
    setDefaultState();
  }

  // --------------------------------------------------------
  // CHROME / ANDROID — capture l'événement d'installation natif
  // --------------------------------------------------------

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
  });

  // --------------------------------------------------------
  // INSTALLATION RÉUSSIE
  // --------------------------------------------------------

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    setInstalledState();
    showToast('Application installée avec succès !');
  });

  // --------------------------------------------------------
  // CLIC SUR LE BOUTON
  // --------------------------------------------------------

  btn.addEventListener('click', async () => {

    // Déjà installée : on ne relance rien, on informe juste.
    if (isStandaloneNow()) {
      showToast("L'application est déjà installée sur cet appareil.");
      return;
    }

    // Chrome/Android/Edge : on a un prompt natif capturé, on l'utilise.
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;

      if (outcome === 'accepted') {
        showToast('Installation en cours…');
        // "appinstalled" mettra à jour le bouton en état "installée".
      } else {
        showToast('Installation annulée.');
      }
      return;
    }

    // iOS/Safari : aucune installation programmatique possible.
    if (isIOS) {
      showToast(
        "Sur iPhone/iPad : appuyez sur le bouton Partager de Safari, puis « Sur l'écran d'accueil ».",
        6000
      );
      return;
    }

    // Navigateur sans support de l'installation (ex. Firefox desktop),
    // ou critères d'installabilité pas encore remplis par le navigateur.
    showToast(
      "L'installation n'est pas proposée par ce navigateur. Essayez avec Chrome ou Edge.",
      5000
    );
  });

}
