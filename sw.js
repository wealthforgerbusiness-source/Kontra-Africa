// =============================================================================
// KONTRA-AFRICA — SERVICE WORKER (le vrai, pas le fichier d'auth-guard)
// =============================================================================
// Ce fichier tourne dans le contexte "Service Worker" du navigateur.
// PAS de window, PAS de document, PAS de code d'auth Firebase ici.
// L'auth-guard reste dans /js/auth-guard.js — ne rien y toucher.
// =============================================================================

const CACHE_VERSION = 'kontra-v1';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Pages + assets statiques à pré-cacher à l'installation.
// (les données Firestore ne sont PAS mises en cache ici — seulement l'app shell)
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/login.html',
  '/dashboard.html',
  '/contracts.html',
  '/finances.html',
  '/profil.html',
  '/sign.html',

  '/manifest.json',
  '/logo.webp',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable.png',

  '/css/tokens.css',
  '/css/app.css',
  '/css/landing.css',
  '/css/login.css',
  '/css/contracts.css',
  '/css/finances.css',
  '/css/profil.css',
  '/css/sign.css',

  '/js/firebase-config.js',
  '/js/auth-guard.js',
  '/js/app-nav.js',
  '/js/sw-register.js',
  '/js/offline-queue.js',
  '/js/phone-countries.js',
  '/js/landing.js',
  '/js/login.js',
  '/js/dashboard.js',
  '/js/contracts.js',
  '/js/finances.js',
  '/js/profil.js',
  '/js/sign.js'
];

// -----------------------------------------------------------------------------
// INSTALL — pré-cache l'app shell
// -----------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => {
      // addAll échoue en bloc si UNE seule URL rate : on ajoute donc
      // une par une pour ne pas bloquer toute l'installation.
      return Promise.all(
        APP_SHELL_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] Pré-cache échoué pour', url, err);
          })
        )
      );
    })
  );

  self.skipWaiting();
});

// -----------------------------------------------------------------------------
// ACTIVATE — nettoie les anciens caches
// -----------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('kontra-') && key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

// -----------------------------------------------------------------------------
// FETCH
// -----------------------------------------------------------------------------
// - Requêtes de NAVIGATION (changement de page) : network-first,
//   fallback sur le cache si hors-ligne, fallback final sur index.html.
// - Requêtes Firebase / API (kontra-africa.onrender.com, googleapis, gstatic) :
//   on laisse passer directement au réseau, PAS de cache (données live).
// - Autres assets (css/js/icônes) : cache-first, avec mise à jour en arrière-plan.
// -----------------------------------------------------------------------------

const NO_CACHE_HOSTS = [
  'kontra-africa.onrender.com',
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'www.gstatic.com',
  'googleapis.com'
];

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Laisser passer Firebase / API backend sans les intercepter.
  if (NO_CACHE_HOSTS.some((host) => url.hostname.includes(host))) {
    return;
  }

  // Navigation entre pages (clic sur un lien, ouverture de l'app, etc.)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/index.html'))
        )
    );
    return;
  }

  // Assets statiques (css, js, images, manifest) : cache-first.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
