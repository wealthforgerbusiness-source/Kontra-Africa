'use strict';

const VERSION = 'kontra-v4';
const STATIC_CACHE = VERSION + '-static';
const CDN_CACHE = VERSION + '-cdn';
const NETWORK_TIMEOUT_MS = 4500;

const PRECACHE = [
  'app.html',
  'index.html',
  'manifest.json',
  'css/style.css',
  'css/app.css',
  'css/landing.css',
  'js/config.js',
  'js/ui.js',
  'js/fx.js',
  'js/firebase.js',
  'js/store.js',
  'js/app.js',
  'js/paywall.js',
  'js/landing.js',
  'js/views/home.js',
  'js/views/stock.js',
  'js/views/sale.js',
  'js/views/debts.js',
  'js/views/more.js',
  'js/views/closing.js',
  'assets/logo/logo-192.png',
  'assets/logo/logo-512.png'
];

const OFFLINE_HTML =
  '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hors ligne</title></head>' +
  '<body style="font-family:system-ui,sans-serif;display:grid;place-content:center;min-height:100vh;margin:0;padding:1.5rem;text-align:center;color:#0F172A">' +
  '<h1 style="color:#0B6B4F">Vous êtes hors ligne</h1><p>Vérifiez votre connexion internet puis rechargez la page.</p></body></html>';

function isCdn(url) {
  return (
    (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  );
}

function cacheKey(request) {
  if (request.mode !== 'navigate') return request;
  const url = new URL(request.url);
  return new Request(url.origin + url.pathname);
}

function canStore(response) {
  return Boolean(response) && (response.ok || response.type === 'opaque');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.allSettled(PRECACHE.map((path) => cache.add(new Request(path, { cache: 'reload' }))));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== STATIC_CACHE && n !== CDN_CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

async function networkFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const key = cacheKey(request);
  const cached = await cache.match(key);

  const network = fetch(request).then((response) => {
    if (response && response.ok) cache.put(key, response.clone());
    return response;
  });

  if (!cached) {
    try {
      return await network;
    } catch (_e) {
      if (request.mode === 'navigate') {
        const shell = await cache.match('app.html');
        if (shell) return shell;
        return new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      return new Response('', { status: 504 });
    }
  }

  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS));
  try {
    return await Promise.race([network, timeout]);
  } catch (_e) {
    return cached;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (_e) {
    return new Response('', { status: 504 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (canStore(response)) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const response = await network;
  return response || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return;

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/service-worker.js')) return;
    if (/\.(png|jpe?g|webp|svg|ico|woff2?)$/i.test(url.pathname)) {
      event.respondWith(cacheFirst(request));
      return;
    }
    event.respondWith(networkFirst(request));
    return;
  }

  if (isCdn(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
