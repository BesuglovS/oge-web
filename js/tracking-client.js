/* ==========================================================================
   Nayanova Academy — Activity Tracking Client
   Канонический источник: auth-web/assets/js/tracking-client.js
   Клиент учёта активности ученика (auth-web /api/track.php). Отправляет
   heartbeat'ы для авторизованных пользователей (кука auth_session) — какой
   URL открыт, заголовок страницы и сколько секунд на ней проведено.
   Работает как классический скрипт (глобал window.NayanovaTrack).
   ========================================================================== */
(function (global) {
  'use strict';

  var DEFAULTS = {
    apiBase: 'https://auth.nayanovaacademy.ru',
    interval: 30,           // секунд между heartbeat'ами
    trackTitle: true,       // передавать document.title
    trackReferrer: true     // передавать referrer первого захода
  };

  var config = Object.assign({}, DEFAULTS);
  var authed = null;        // tri-state: null = неизвестно, true/false
  var enabled = false;
  var initialized = false;
  var timer = null;
  var firstBeat = true;
  var lastHref = '';
  var lastBeatAt = 0;

  // Учёт подписок и обёрток history — чтобы stop() полностью убирал за собой.
  var boundListeners = [];
  var originalHistoryMethods = {};

  function addListener(target, type, fn) {
    target.addEventListener(type, fn);
    boundListeners.push({ target: target, type: type, fn: fn });
  }

  function removeAllListeners() {
    while (boundListeners.length) {
      var entry = boundListeners.pop();
      entry.target.removeEventListener(entry.type, entry.fn);
    }
  }

  // Уникальный ключ вкладки — чтобы несколько вкладок не конфликтовали
  // за одну открытую строку page_views на сервере.
  function tabKey() {
    var k = null;
    try {
      k = global.sessionStorage.getItem('nayanova_tab_key');
    } catch (e) {}
    if (!k) {
      k = Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { global.sessionStorage.setItem('nayanova_tab_key', k); } catch (e) {}
    }
    return k;
  }

  var tab = tabKey();

  function init(opts) {
    if (initialized) return;
    initialized = true;
    config = Object.assign({}, DEFAULTS, opts || {});
    checkAuth().then(function (ok) {
      if (ok) start();
    });
  }

  // Автоинициализация при загрузке скрипта — не требует инлайн-скриптов
  // на странице (инлайн-скрипты могут блокироваться CSP script-src 'self').
  function autoInit() {
    if (typeof global.document === 'undefined') return;
    var boot = function () { init(); };
    if (global.document.readyState === 'complete' || global.document.readyState === 'interactive') {
      boot();
    } else {
      global.addEventListener('DOMContentLoaded', boot);
    }
  }

  function checkAuth() {
    if (authed !== null) return Promise.resolve(authed);
    return global.fetch(config.apiBase + '/api/check.php', { credentials: 'include' })
      .then(function (r) {
        if (!r.ok) throw new Error('check.php HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) {
        authed = !!(d && d.authenticated);
        return authed;
      })
      .catch(function () { authed = false; return false; });
  }

  function currentUrl() {
    return global.location.href;
  }

  function currentTitle() {
    return config.trackTitle ? (global.document.title || '') : '';
  }

  function currentReferrer() {
    return (config.trackReferrer && firstBeat) ? (global.document.referrer || '') : '';
  }

  // Секунд, прошедших с прошлого тика.
  function elapsedSeconds() {
    var now = Date.now();
    var d = lastBeatAt > 0 ? (now - lastBeatAt) / 1000 : 0;
    lastBeatAt = now;
    return Math.max(0, Math.round(d));
  }

  function send(url, title, referrer, duration) {
    return global.fetch(config.apiBase + '/api/track.php', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: url,
        title: title,
        referrer: referrer,
        duration: duration,
        tab: tab
      })
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) {
        authed = false;
        stop();
      }
      return r;
    }).catch(function () { /* сеть недоступна — пропускаем тик */ });
  }

  // Обычный периодический тик: фиксирует время на текущей странице.
  function tick() {
    if (!enabled) return;
    send(currentUrl(), currentTitle(), '', elapsedSeconds());
    firstBeat = false;
  }

  // Смена страницы без перезагрузки (SPA): время уходит старой странице.
  function pageSwitched(oldUrl) {
    if (!enabled) return;
    send(oldUrl, '', '', elapsedSeconds());
    firstBeat = false;
  }

  // Финальный тик при уходе со страницы (в т.ч. закрытие вкладки).
  function beacon() {
    if (!enabled) return;
    var data = JSON.stringify({
      url: currentUrl(),
      title: currentTitle(),
      referrer: '',
      duration: elapsedSeconds(),
      tab: tab
    });
    if (navigator.sendBeacon) {
      // text/plain — CORS-safelisted тип: без preflight, beacon доходит
      // надёжно во всех браузерах. Сервер парсит тело как JSON независимо
      // от Content-Type.
      navigator.sendBeacon(config.apiBase + '/api/track.php', new Blob([data], { type: 'text/plain' }));
    } else {
      send(currentUrl(), currentTitle(), '', elapsedSeconds());
    }
  }

  function restoreHistoryMethods() {
    if (originalHistoryMethods.pushState && global.history) {
      global.history.pushState = originalHistoryMethods.pushState;
      originalHistoryMethods.pushState = null;
    }
    if (originalHistoryMethods.replaceState && global.history) {
      global.history.replaceState = originalHistoryMethods.replaceState;
      originalHistoryMethods.replaceState = null;
    }
  }

  function stop() {
    enabled = false;
    if (timer) { clearInterval(timer); timer = null; }
    removeAllListeners();
    restoreHistoryMethods();
  }

  function start() {
    if (enabled) return;
    enabled = true;
    lastHref = currentUrl();
    lastBeatAt = Date.now();

    send(currentUrl(), currentTitle(), currentReferrer(), 0); // открытие страницы
    firstBeat = false;

    timer = setInterval(tick, config.interval * 1000);

    if (typeof global.document !== 'undefined') {
      addListener(global.document, 'visibilitychange', function () {
        if (global.document.visibilityState === 'hidden') beacon();
      });
    }
    addListener(global, 'pagehide', beacon);
    addListener(global, 'beforeunload', beacon);

    originalHistoryMethods.pushState = global.history && global.history.pushState;
    originalHistoryMethods.replaceState = global.history && global.history.replaceState;

    function wrapHistory(original, args) {
      var oldUrl = currentUrl();
      original.apply(global.history, args);
      if (currentUrl() !== oldUrl) {
        pageSwitched(oldUrl);
        lastHref = currentUrl();
      }
    }

    if (originalHistoryMethods.pushState) {
      global.history.pushState = function () { wrapHistory(originalHistoryMethods.pushState, arguments); };
    }
    if (originalHistoryMethods.replaceState) {
      global.history.replaceState = function () { wrapHistory(originalHistoryMethods.replaceState, arguments); };
    }
    addListener(global, 'popstate', function () {
      if (currentUrl() !== lastHref) {
        pageSwitched(lastHref);
        lastHref = currentUrl();
      }
    });
  }

  var apiObj = {
    init: init,
    checkAuth: checkAuth,
    stop: stop
  };

  global.NayanovaTrack = apiObj;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = apiObj;
  }

  autoInit();
})(typeof window !== 'undefined' ? window : this);
