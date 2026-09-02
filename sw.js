/* Service Worker — oge-web PWA */
var CACHE_NAME = 'oge-web-v2';
var ASSETS = [
  '/',
  '/oge.html',
  '/assets/styles.css',
  '/js/metrika.js',
  '/js/progress.js',
  '/js/progress-client.js',
  '/js/progress-sync.js',
  '/js/tracking-client.js',
  '/manifest.json',
  '/oge1.html', '/oge1-t.html',
  '/oge2.html', '/oge2-t.html',
  '/oge3.html', '/oge3-t.html',
  '/oge4.html', '/oge4-t.html', '/oge4-path.html',
  '/oge5.html', '/oge5-t.html',
  '/oge6.html', '/oge6-t.html',
  '/oge7.html', '/oge7-t.html',
  '/oge8.html', '/oge8-t.html',
  '/oge9.html', '/oge9-t.html',
  '/oge10.html', '/oge10-t.html',
  '/oge11.html', '/oge11-t.html',
  '/oge12.html', '/oge12-t.html',
  '/oge131-t.html',
  '/oge132-t.html',
  '/oge14-t.html',
  '/oge15.html', '/oge15-t.html',
  '/oge16.html', '/oge16-t.html',
  '/data/oge7.json',
  '/oge7.txt'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(name) { return name !== CACHE_NAME; })
             .map(function(name) { return caches.delete(name); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  var request = event.request;

  /* Кросс-доменные запросы (auth.nayanovaacademy.ru: check.php, progress.php)
     не перехватываем и НЕ кэшируем — состояние авторизации всегда живое. */
  if (request.url.indexOf(self.location.origin) !== 0) {
    return;
  }

  if (request.method !== 'GET') {
    return;
  }

  /* Network-first для HTML, cache-first для остальных ассетов */
  if (request.destination === 'document') {
    event.respondWith(
      fetch(request).then(function(response) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(request, clone); });
        return response;
      }).catch(function() {
        return caches.match(request);
      })
    );
  } else {
    event.respondWith(
      caches.match(request).then(function(cached) {
        return cached || fetch(request).then(function(response) {
          var clone = response.clone();
          if (response.ok) {
            caches.open(CACHE_NAME).then(function(cache) { cache.put(request, clone); });
          }
          return response;
        });
      })
    );
  }
});
