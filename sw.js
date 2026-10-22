/* Service Worker — oge-web PWA */
var CACHE_NAME = 'oge-web-v11';
var ASSETS = [
  '/',
  '/oge.html',
  '/offline.html',
  '/404.html',
  '/assets/styles.css',
  '/assets/favicon.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-maskable-512.png',
  '/js/metrika.js',
  '/js/progress.js',
  '/js/code-editor.js',
  '/js/oge15-ref.js',
  '/js/oge15-gen.js',
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
  '/files/oge15/tasks.json'
];

// Данные задания 15 (обстановки + эталоны) — 20 пар файлов.
for (var _i = 1; _i <= 20; _i++) {
  var _n = (_i < 10 ? '0' : '') + _i;
  ASSETS.push('/files/oge15/oge-15-2026-' + _n + '.json');
  ASSETS.push('/files/oge15/oge-15-2026-e-' + _n + '.json');
}

var OFFLINE_URL = '/offline.html';

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      // addAll падает целиком при одном отсутствующем ассете — добавляем
      // по одному, чтобы единичный сбой не ломал установку SW.
      // fetch(..., {cache:'reload'}) обходит HTTP-кэш (immutable-ассеты),
      // иначе в precache могла попасть устаревшая версия файла.
      return Promise.all(ASSETS.map(function(url) {
        return fetch(url, { cache: 'reload' }).then(function(response) {
          if (response && response.ok) {
            return cache.put(url, response);
          }
        }).catch(function() { /* пропускаем недоступный ассет */ });
      }));
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
  var sameOrigin = false;
  try {
    sameOrigin = new URL(request.url).origin === self.location.origin;
  } catch (e) {
    sameOrigin = false;
  }
  if (!sameOrigin) {
    return;
  }

  if (request.method !== 'GET') {
    return;
  }

  /* Большие архивы (files/*.zip) не кэшируем — незачем занимать десятки МБ. */
  try {
    if (new URL(request.url).pathname.slice(-4) === '.zip') {
      return;
    }
  } catch (e) { /* ignore */ }

  /* Network-first для HTML, cache-first для остальных ассетов */
  var isGitUi = false;
  try { isGitUi = new URL(request.url).pathname.indexOf('/git/') === 0; } catch (e) { /* ignore */ }

  if (request.destination === 'document' || request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function(response) {
        // Служебный git-UI не кэшируем (не хранить внутренности сервера на устройстве).
        if (response && response.ok && !isGitUi) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(request, clone); });
        }
        return response;
      }).catch(function() {
        return caches.match(request).then(function(cached) {
          return cached || caches.match(OFFLINE_URL);
        });
      })
    );
  } else {
    event.respondWith(
      caches.match(request).then(function(cached) {
        return cached || fetch(request).then(function(response) {
          if (response && response.ok && response.type === 'basic') {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) { cache.put(request, clone); });
          }
          return response;
        });
      })
    );
  }
});
