// =============================================================================
// KONTRA-AFRICA — SERVICE WORKER REGISTER
// =============================================================================
// Ce fichier sert uniquement à enregistrer /sw.js.
// Le vrai Service Worker se trouve à la racine du projet :
// /sw.js
// =============================================================================

(function () {
  'use strict';

  // Vérifie que le navigateur supporte les Service Workers
  if (!('serviceWorker' in navigator)) {
    console.warn(
      '[PWA] Les Service Workers ne sont pas supportés par ce navigateur.'
    );

    return;
  }

  // Attend que la page soit complètement chargée
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        '/sw.js',
        {
          scope: '/'
        }
      );

      console.log(
        '[PWA] Service Worker enregistré avec succès.',
        registration.scope
      );

      // -----------------------------------------------------------------------
      // Vérifie régulièrement si une nouvelle version du Service Worker existe
      // -----------------------------------------------------------------------

      try {
        await registration.update();

        console.log(
          '[PWA] Vérification de mise à jour effectuée.'
        );
      } catch (updateError) {
        console.warn(
          '[PWA] Impossible de vérifier la mise à jour du Service Worker:',
          updateError
        );
      }

      // -----------------------------------------------------------------------
      // Lorsqu'une nouvelle version est détectée
      // -----------------------------------------------------------------------

      registration.addEventListener(
        'updatefound',
        () => {
          const newWorker = registration.installing;

          if (!newWorker) {
            return;
          }

          newWorker.addEventListener(
            'statechange',
            () => {
              console.log(
                '[PWA] État du nouveau Service Worker:',
                newWorker.state
              );

              // Le nouveau SW est installé et attend de prendre le contrôle.
              if (
                newWorker.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                console.log(
                  '[PWA] Nouvelle version disponible.'
                );
              }
            }
          );
        }
      );

    } catch (error) {
      console.error(
        '[PWA] Échec de l’enregistrement du Service Worker:',
        error
      );
    }
  });

})();
