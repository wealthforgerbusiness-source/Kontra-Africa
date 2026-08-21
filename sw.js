// sw.js
// Service Worker de Kontra-Africa.
//
// Rôle strict de ce fichier : mettre en cache la COQUILLE de l'app
// (HTML, CSS, JS, icônes) pour qu'elle reste utilisable hors ligne.
// Aucune donnée Firestore n'est mise en cache ici — la persistance des
// données hors ligne est gérée par js/offline-queue.js (IndexedDB) dans
// chaque page.
//
// Stratégie : network-first avec repli sur le cache pour les ressources de
// même origine (toujours à jour quand la connexion est bonne, fonctionne
// hors ligne sinon). Cache-first pour les librairies externes versionnées
// (Firebase CDN) car leur contenu est immuable une fois publié.
//
// IMPORTANT : incrémente CACHE_VERSION à chaque déploiement de fichiers
// listés dans APP_SHELL_ASSETS, sinon les anciens visiteurs resteront sur
// une version périmée du shell.

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `kontra-shell-${CACHE_VERSION}`;
const CDN_CACHE = `kontra-cdn-${CACHE_VERSION}`;

// Pages et assets qui composent la coquille de l'app.
// Ajoute ici tout nouveau fichier HTML/CSS/JS/icône statique que tu crées.
const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/dashboard.html',
  '/contracts.html',
  '/sign.html',
  '/finances.html',
  '/profil.html',
  '/manifest.json',

  '/css/tokens.css',
  '/css/landing.css',
  '/css/login.css',
  '/css/app.css',
  '/css/contracts.css',
  '/css/sign.css',
  '/css/finances.css',
  '/css/profil.css',

  '/js/firebase-config.js',
  '/js/auth-guard.js',
  '/js/landing.js',
  '/js/login.js',
  '/js/dashboard.js',
  '/js/contracts.js',
  '/js/sign.js',
  '/js/finances.js',
  '/js/profil.js',
  '/js/offline-queue.js',
  '/js/sw-register.js',

  '/public/logo.webp',
  '/public/icons/icon-192.png',
  '/public/icons/icon-512.png',
  '/public/icons/icon-maskable.png',
];

// Domaines externes dont on met en cache les réponses (cache-first, car
// versionnées/immuables) pour que les imports ES modules fonctionnent hors
// ligne après un premier chargement en ligne.
const CACHEABLE_CDN_ORIGINS = ['https://www.gstatic.com'];

// ---------- Installation ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // addAll échoue globalement si UNE ressource manque ; on protège donc
      // chaque fichier individuellement pour ne pas bloquer l'installation
      // à cause d'un fichier renommé/supprimé.
      Promise.allSettled(
        APP_SHELL_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] Échec de mise en cache initiale :', url, err);
          })
        )
      )
    )
  );
  self.skipWaiting();
});

// ---------- Activation : nettoyage des anciens caches ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== CDN_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ---------- Interception des requêtes ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // On ne touche jamais aux requêtes non-GET (POST/PUT vers l'API, écritures
  // Firestore, etc.) : elles doivent échouer normalement si hors ligne, pour
  // que le code applicatif (ex: js/finances.js, js/offline-queue.js) gère
  // lui-même la mise en file d'attente.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Ne jamais intercepter les appels vers le backend applicatif (données
  // dynamiques, jamais mises en cache par ce Service Worker).
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    return;
  }

  // Ne jamais intercepter Firestore/Firebase Auth (RPC en temps réel).
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('firebaseinstallations.googleapis.com')
  ) {
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (CACHEABLE_CDN_ORIGINS.some((origin) => url.origin === origin)) {
    event.respondWith(cacheFirst(request));
  }
  // Toute autre origine externe non listée : comportement par défaut du
  // navigateur (pas d'interception), pour rester prudent.
});

// ---------- Stratégies ----------
async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;

    // Repli ultime pour une navigation HTML non trouvée en cache : sert la
    // page d'accueil pour éviter un écran d'erreur brut hors ligne.
    if (request.mode === 'navigate') {
      const fallback = await cache.match('/index.html');
      if (fallback) return fallback;
    }

    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const networkResponse = await fetch(request);
  if (networkResponse && networkResponse.status === 200) {
    cache.put(request, networkResponse.clone());
  }
  return networkResponse;
}
