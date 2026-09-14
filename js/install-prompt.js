// ============================================================
// js/install-prompt.js — Invite d'installation de la PWA
// ============================================================
// Chrome/Android ne montre pas toujours sa mini-bannière d'installation
// automatique (elle dépend de critères d'engagement, et peut être
// supprimée après un premier refus). On affiche donc notre propre bandeau,
// contrôlé nous-mêmes, en écoutant l'événement natif "beforeinstallprompt".
//
// Ce fichier est autonome : il suffit de l'inclure via
// <script type="module" src="/js/install-prompt.js"></script>
// sur une page qui contient déjà les éléments HTML suivants :
//   #install-banner, #install-banner-btn, #install-banner-close

const DISMISS_KEY = 'kontra_install_banner_dismissed_at';
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

const banner = document.getElementById('install-banner');
const installBtn = document.getElementById('install-banner-btn');
const closeBtn = document.getElementById('install-banner-close');

// Rien à faire si les éléments HTML ne sont pas présents sur cette page.
if (banner && installBtn && closeBtn) {

  // --------------------------------------------------------
  // DÉJÀ INSTALLÉE ? On ne montre jamais la bannière dans ce cas.
  // --------------------------------------------------------

  const isAlreadyStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  // --------------------------------------------------------
  // L'UTILISATEUR A-T-IL DÉJÀ FERMÉ LA BANNIÈRE RÉCEMMENT ?
  // --------------------------------------------------------

  function wasRecentlyDismissed() {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const dismissedAt = Number(raw);
    if (Number.isNaN(dismissedAt)) return false;
    return (Date.now() - dismissedAt) < DISMISS_COOLDOWN_MS;
  }

  let deferredPrompt = null;

  if (!isAlreadyStandalone && !wasRecentlyDismissed()) {

    // ------------------------------------------------------
    // CHROME / ANDROID (et navigateurs basés Chromium)
    // ------------------------------------------------------
    // Le navigateur annonce lui-même qu'il PEUT proposer l'installation.
    // On intercepte cet événement pour afficher notre propre bouton, et on
    // garde l'objet événement de côté pour déclencher le prompt natif plus
    // tard, au clic de l'utilisateur (le prompt natif ne peut être appelé
    // qu'une seule fois par événement capturé).

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredPrompt = event;
      banner.hidden = false;
    });

    // ------------------------------------------------------
    // iOS / SAFARI
    // ------------------------------------------------------
    // Safari ne déclenche JAMAIS "beforeinstallprompt" et n'offre aucune
    // API pour installer par programmation — l'utilisateur doit passer par
    // Partager → "Sur l'écran d'accueil" manuellement. On détecte iOS et on
    // affiche quand même le bandeau, mais avec des instructions au lieu
    // d'un bouton qui ne pourrait rien déclencher.

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    if (isIOS) {
      const messageEl = banner.querySelector('p');
      if (messageEl) {
        messageEl.textContent =
          "Installe l'application : appuie sur le bouton Partager de Safari, puis \"Sur l'écran d'accueil\".";
      }
      installBtn.hidden = true; // aucun prompt programmable possible sur iOS
      banner.hidden = false;
    }
  }

  // --------------------------------------------------------
  // CLIC SUR "INSTALLER" (Chrome/Android uniquement — le bouton
  // est masqué sur iOS, voir ci-dessus)
  // --------------------------------------------------------

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    // Que l'utilisateur accepte ou refuse dans la boîte de dialogue native,
    // l'événement capturé n'est plus réutilisable : on le jette et on
    // masque notre bandeau dans tous les cas.
    deferredPrompt = null;
    banner.hidden = true;

    if (outcome === 'dismissed') {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    }
  });

  // --------------------------------------------------------
  // FERMETURE MANUELLE (bouton ×)
  // --------------------------------------------------------

  closeBtn.addEventListener('click', () => {
    banner.hidden = true;
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  });

  // --------------------------------------------------------
  // INSTALLATION RÉUSSIE (l'utilisateur a accepté et l'app est
  // maintenant vraiment installée) — on masque définitivement, plus
  // besoin d'attendre un éventuel cooldown.
  // --------------------------------------------------------

  window.addEventListener('appinstalled', () => {
    banner.hidden = true;
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  });
}
