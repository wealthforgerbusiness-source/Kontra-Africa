const CACHE_VERSION = 'kontra-v4'; // ⚠️ Incrémente ce numéro à CHAQUE déploiement qui touche un fichier JS/CSS/HTML.
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
  '/stock.html',
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
  '/css/stock.css',
  '/css/profil.css',
  '/css/sign.css',

  '/js/firebase-config.js',
  '/js/auth-guard.js',
  '/js/app-nav.js',
  '/js/sw-register.js',
  '/js/offline-queue.js',
  '/js/phone-countries.js',
  '/js/currency.js',
  '/js/landing.js',
  '/js/login.js',
  '/js/dashboard.js',
  '/js/contracts.js',
  '/js/finances.js',
  '/js/stock.js',
  '/js/profil.js',
  '/js/sign.js'
];

// Extensions dont on veut TOUJOURS vérifier le réseau en priorité, car
// c'est justement le code applicatif (JS/CSS) qui a causé le bug : une
// nouvelle version déployée sur Render doit être servie dès que possible,
// pas seulement "à la prochaine visite". Le HTML de navigation utilisait
// déjà ce principe (network-first) ; on l'étend ici à .js et .css.
const NETWORK_FIRST_EXTENSIONS = ['.js', '.css'];

function isNetworkFirstAsset(url) {
  return NETWORK_FIRST_EXTENSIONS.some((ext) => url.pathname.endsWith(ext));
}

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
// - Fichiers .js / .css : network-first, fallback cache si hors-ligne.
//   ⚠️ CORRECTIF : ces fichiers étaient avant en cache-first, donc une
//   ancienne version restait servie tant que CACHE_VERSION n'était pas
//   changé manuellement — c'est exactement ce qui a causé le bug
//   "renderSaleProductOptions" (ancien stock.js servi malgré un nouveau
//   déploiement). Avec network-first, la dernière version déployée sur
//   Render est utilisée dès qu'elle est disponible, sans dépendre d'un
//   changement de numéro de version.
// - Autres assets (images, icônes, manifest) : cache-first, avec mise à
//   jour en arrière-plan (changent rarement, la vitesse prime ici).
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

  // Fichiers JS / CSS : network-first (voir explication ci-dessus).
  if (isNetworkFirstAsset(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Autres assets statiques (images, icônes, manifest) : cache-first.
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
