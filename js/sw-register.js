// js/sw-register.js
// Enregistre le Service Worker (sw.js) sur toutes les pages.
// À inclure via <script type="module" src="/js/sw-register.js"></script>
// juste avant la fermeture de </body> sur CHAQUE page HTML de l'app
// (index.html, login.html, dashboard.html, contracts.html, sign.html,
// finances.html, profil.html).

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // Si une nouvelle version du Service Worker est trouvée, on la
        // laisse s'installer normalement ; elle prendra le relais au
        // prochain chargement de page grâce à skipWaiting()/clients.claim()
        // déjà activés dans sw.js.
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated') {
              console.info('[SW] Nouvelle version de l’app installée.');
            }
          });
        });
      })
      .catch((err) => {
        console.warn('[SW] Échec de l’enregistrement :', err);
      });
  });
}
