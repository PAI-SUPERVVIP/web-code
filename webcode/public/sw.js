// very small service worker: cache shell files and serve from cache-first
const CACHE_NAME = 'web-term-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // xterm and CSS are loaded from CDN; you can add them here if you host locally
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // prefer cache, fallback to network
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).catch(()=> cached))
  );
});