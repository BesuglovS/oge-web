/* ==========================================================================
   Nayanova Academy — Unified Progress Client
   Канонический источник: shared/js/progress-client.js
   Единый клиент серверного прогресса ученика (auth-web /api/progress.php).
   Работает как классический скрипт (глобал window.NayanovaProgress),
   локальное хранилище всегда является источником истины, сервер — зеркало
   для авторизованных пользователей (кука auth_session).
   Слияние сервера и локальной копии — по updated_at (last-write-wins).
   Неудачные записи попадают в outbox и повторяются при возврате сети.
   ========================================================================== */
(function (global) {
  'use strict';

  var DEFAULTS = {
    apiBase: 'https://auth.nayanovaacademy.ru',
    course: null,
    storageKey: 'nayanova-progress',
    // Сколько миллисекунд верим отрицательному результату check.php,
    // чтобы не дёргать auth-web на каждый вызов для анонимов.
    negativeAuthTtl: 60000,
    outboxLimit: 500,
    batchLimit: 200
  };

  var config = Object.assign({}, DEFAULTS);
  var authed = null;        // tri-state: null = неизвестно, true/false
  var authedAt = 0;         // время последней проверки
  var unavailable = false;  // true — auth-web недоступен (сеть/ошибка), а не «не авторизован»
  var flushing = false;

  function nowIso() {
    return new Date().toISOString();
  }

  function init(opts) {
    config = Object.assign({}, DEFAULTS, opts || {});
  }

  /* ---------------------- локальное хранилище ---------------------- */

  function getLocal(course) {
    var c = course || config.course;
    try {
      var raw = global.localStorage.getItem(config.storageKey);
      var all = raw ? JSON.parse(raw) : {};
      return (all[c] && typeof all[c] === 'object') ? all[c] : {};
    } catch (e) {
      return {};
    }
  }

  function setLocal(course, data) {
    var c = course || config.course;
    try {
      var raw = global.localStorage.getItem(config.storageKey);
      var all = raw ? JSON.parse(raw) : {};
      all[c] = data || {};
      global.localStorage.setItem(config.storageKey, JSON.stringify(all));
    } catch (e) {
      /* localStorage недоступен — работаем в памяти */
    }
  }

  /* ----------------------------- outbox ----------------------------- */

  function outboxKey() {
    return config.storageKey + ':outbox';
  }

  function getOutbox() {
    try {
      var raw = global.localStorage.getItem(outboxKey());
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveOutbox(list) {
    try {
      global.localStorage.setItem(outboxKey(), JSON.stringify(list));
    } catch (e) {
      /* переполнение localStorage — теряем самые старые записи */
      try {
        global.localStorage.setItem(outboxKey(), JSON.stringify(list.slice(-Math.floor(config.outboxLimit / 2))));
      } catch (e2) {}
    }
  }

  function enqueueOutbox(course, updates) {
    if (!updates || !updates.length) return;
    var list = getOutbox();
    for (var i = 0; i < updates.length; i++) {
      list.push({ course: course, payload: updates[i], queued_at: nowIso() });
    }
    if (list.length > config.outboxLimit) {
      list = list.slice(-config.outboxLimit);
    }
    saveOutbox(list);
  }

  /**
   * Повторно отправить накопленные неудачные записи (по курсам, батчами).
   * @returns {Promise<number>} сколько записей отправлено
   */
  function flushOutbox() {
    if (flushing) return Promise.resolve(0);
    var queue = getOutbox();
    if (!queue.length) return Promise.resolve(0);
    flushing = true;
    return checkAuth()
      .then(function (authedNow) {
        if (!authedNow || unavailable) return 0;
        // Группируем по курсу, склеивая повторы по модулю (последний выигрывает).
        var byCourse = {};
        queue.forEach(function (item) {
          var c = item.course;
          if (!byCourse[c]) byCourse[c] = {};
          byCourse[c][item.payload.module] = item.payload;
        });
        var courses = Object.keys(byCourse);
        var sentCount = 0;
        var chain = Promise.resolve();
        courses.forEach(function (c) {
          var modules = Object.keys(byCourse[c]);
          for (var i = 0; i < modules.length; i += config.batchLimit) {
            (function (chunk) {
              chain = chain.then(function () {
                var updates = chunk.map(function (m) { return byCourse[c][m]; });
                return api('/api/progress.php', {
                  method: 'PUT',
                  body: JSON.stringify({ course: c, updates: updates })
                }).then(function () {
                  sentCount += updates.length;
                  // Убираем из очереди только успешно отправленные модули.
                  var done = {};
                  updates.forEach(function (u) { done[u.module] = true; });
                  saveOutbox(getOutbox().filter(function (item) {
                    return !(item.course === c && done[item.payload.module]);
                  }));
                }).catch(function () { /* оставляем до следующей попытки */ });
              });
            })(modules.slice(i, i + config.batchLimit));
          }
        });
        return chain.then(function () { return sentCount; });
      })
      .then(function (sent) {
        flushing = false;
        return sent;
      })
      .catch(function () {
        flushing = false;
        return 0;
      });
  }

  /* ------------------------------ auth ------------------------------ */

  function resetAuth() {
    authed = null;
    authedAt = 0;
    unavailable = false;
  }

  /**
   * Состояние последней проверки авторизации.
   * @returns {{authed:boolean|null, unavailable:boolean}}
   */
  function getAuthState() {
    return { authed: authed, unavailable: unavailable };
  }

  function checkAuth(force) {
    if (force) {
      authed = null;
    }
    if (authed === true) return Promise.resolve(true);
    // Отрицательный результат кэшируем ненадолго, чтобы не долбить auth-web.
    if (authed === false && Date.now() - authedAt < config.negativeAuthTtl) {
      return Promise.resolve(false);
    }
    return global.fetch(config.apiBase + '/api/check.php', { credentials: 'include' })
      .then(function (r) {
        if (!r.ok) throw new Error('check.php HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) {
        unavailable = false;
        authed = !!(d && d.authenticated);
        authedAt = Date.now();
        return authed;
      })
      .catch(function () {
        // Сеть/5xx — это НЕ «не авторизован», отмечаем недоступность сервиса.
        unavailable = true;
        authed = false;
        authedAt = Date.now();
        return false;
      });
  }

  function isAuthError(err) {
    return !!(err && err.message && err.message.indexOf('HTTP 401') !== -1) ||
           !!(err && err.message && err.message.indexOf('HTTP 403') !== -1);
  }

  function api(path, options) {
    var opts = Object.assign({
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    }, options || {});
    return global.fetch(config.apiBase + path, opts).then(function (r) {
      if (r.status === 401 || r.status === 403) {
        // Нас разлогинили в другой вкладке/на другом сайте — сбрасываем состояние.
        authed = false;
        authedAt = Date.now();
        unavailable = false;
        throw new Error('HTTP ' + r.status);
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* --------------------------- слияние LWW --------------------------- */

  // Возвращает более свежую из двух записей прогресса по updated_at.
  function newerEntry(a, b) {
    if (!a) return b;
    if (!b) return a;
    var ta = Date.parse(a.updated_at || '');
    var tb = Date.parse(b.updated_at || '');
    if (isNaN(ta) && isNaN(tb)) return Object.assign({}, a, b);
    if (isNaN(ta)) return b;
    if (isNaN(tb)) return a;
    return tb >= ta ? b : a;
  }

  function mergeCourseData(server, local) {
    var merged = {};
    var keys = {};
    var k;
    for (k in server) { if (Object.prototype.hasOwnProperty.call(server, k)) keys[k] = true; }
    for (k in local) { if (Object.prototype.hasOwnProperty.call(local, k)) keys[k] = true; }
    Object.keys(keys).forEach(function (key) {
      merged[key] = newerEntry(server[key], local[key]);
    });
    return merged;
  }

  /* ---------------------------- публичное ---------------------------- */

  /**
   * Получить прогресс по курсу (сервер + локальное хранилище, слияние LWW).
   * @returns {Promise<{progress:Object, stats:Object|null, unavailable:boolean}>}
   */
  function getCourse(course) {
    var c = course || config.course;
    var local = getLocal(c);
    return checkAuth().then(function (authedNow) {
      if (!authedNow) {
        return { progress: local, stats: null, unavailable: unavailable };
      }
      return api('/api/progress.php?course=' + encodeURIComponent(c))
        .then(function (d) {
          var server = (d && d.progress) ? d.progress : {};
          var merged = mergeCourseData(server, local);
          setLocal(c, merged);
          return { progress: merged, stats: d.stats || null, unavailable: false };
        })
        .catch(function () { return { progress: local, stats: null, unavailable: unavailable }; });
    });
  }

  /**
   * Записать прогресс модуля курса. Модуль '__summary__' — сводка курса
   * {data:{completed,total}} для карточки ученика на портале.
   */
  function setModule(module, entry, course) {
    var c = course || config.course;
    var local = getLocal(c);
    var base = local[module] || { completed: 0, score: null, data: null };
    local[module] = Object.assign({}, base, entry, {
      updated_at: nowIso()
    });
    setLocal(c, local);

    return checkAuth().then(function (authedNow) {
      if (!authedNow) return local[module];
      var body = Object.assign({ course: c, module: module }, entry);
      return api('/api/progress.php', { method: 'POST', body: JSON.stringify(body) })
        .catch(function (err) {
          if (!isAuthError(err)) {
            // Офлайн/сбой — кладём в outbox, отправим позже (flushOutbox).
            enqueueOutbox(c, [Object.assign({ module: module }, entry)]);
          }
          /* локальная копия уже обновлена */
        });
    });
  }

  /**
   * Пакетная запись прогресса курса.
   */
  function setBatch(updates, course) {
    var c = course || config.course;
    var local = getLocal(c);
    var now = nowIso();
    updates.forEach(function (u) {
      var base = local[u.module] || { completed: 0, score: null, data: null };
      local[u.module] = Object.assign({}, base, u, { updated_at: now });
    });
    setLocal(c, local);

    return checkAuth().then(function (authedNow) {
      if (!authedNow) return local;
      return api('/api/progress.php', {
        method: 'PUT',
        body: JSON.stringify({ course: c, updates: updates })
      }).catch(function (err) {
        if (!isAuthError(err)) {
          enqueueOutbox(c, updates);
        }
        return local;
      });
    });
  }

  /**
   * Сводка по всем курсам (для портала). Требует авторизации.
   * Для различения «не авторизован» и «сервис недоступен» используйте getAuthState().
   * @returns {Promise<Object|null>} {courses:{course:{total,completed,percentage,updated_at}}}
   */
  function getSummary() {
    return checkAuth().then(function (authedNow) {
      if (!authedNow) return null;
      return api('/api/progress.php').catch(function () { return null; });
    });
  }

  /* ------------------- автоочистка outbox при сети ------------------- */

  function wireNetworkListeners() {
    if (typeof global.addEventListener !== 'function') return;
    try {
      global.addEventListener('online', function () { flushOutbox(); });
      if (typeof global.document !== 'undefined') {
        global.document.addEventListener('visibilitychange', function () {
          if (global.document.visibilityState === 'visible') flushOutbox();
        });
      }
      // Отложенная попытка при загрузке страницы — вдруг есть недоставленное.
      global.setTimeout(function () { flushOutbox(); }, 5000);
    } catch (e) { /* старые окружения — просто пропускаем */ }
  }

  var apiObj = {
    init: init,
    checkAuth: checkAuth,
    getAuthState: getAuthState,
    resetAuth: resetAuth,
    flushOutbox: flushOutbox,
    getCourse: getCourse,
    setModule: setModule,
    setBatch: setBatch,
    getSummary: getSummary
  };

  global.NayanovaProgress = apiObj;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = apiObj;
  }

  wireNetworkListeners();
})(typeof window !== 'undefined' ? window : this);
