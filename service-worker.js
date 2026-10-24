/**
 * service-worker.js — Safe static asset caching for PWA.
 * Only caches public static assets (HTML, CSS, JS, manifest).
 * NEVER caches private image-processing results or sensitive image data.
 * No image caching of user-uploaded/processed photos.
 */

const CACHE_NAME = 'photostudio-static-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/api.js',
  '/js/camera.js',
  '/js/face-analyzer.js',
  '/js/image-enhancer.js',
  '/js/image-optimizer.js',
  '/js/filters.js',
  '/manifest.json',
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
});

// Fetch: cache-first for static assets, network-first for API, no caching of images/API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Never cache API routes or image data
  if (url.pathname.startsWith('/api/')) {
    return; // let it hit the network
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((response) => {
        // Only cache successful static responses
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
