/* ==========================================================================
   Nayanova Academy — Unified Progress Client
   Канонический источник: shared/js/progress-client.js
   Единый клиент серверного прогресса ученика (auth-web /api/progress.php).
   Работает как классический скрипт (глобал window.NayanovaProgress),
   локальное хранилище всегда является источником истины, сервер — зеркало
   для авторизованных пользователей (кука auth_session).
   ========================================================================== */
(function (global) {
  'use strict';

  var DEFAULTS = {
    apiBase: 'https://auth.nayanovaacademy.ru',
    course: null,
    storageKey: 'nayanova-progress'
  };

  var config = Object.assign({}, DEFAULTS);
  var authed = null; // tri-state: null = неизвестно, true/false

  function init(opts) {
    config = Object.assign({}, DEFAULTS, opts || {});
  }

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

  function resetAuth() { authed = null; }

  function checkAuth() {
    if (authed !== null) return Promise.resolve(authed);
    return global.fetch(config.apiBase + '/api/check.php', { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        authed = !!(d && d.authenticated);
        return authed;
      })
      .catch(function () { authed = false; return false; });
  }

  function api(path, options) {
    var opts = Object.assign({
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    }, options || {});
    return global.fetch(config.apiBase + path, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /**
   * Получить прогресс по курсу (сервер + локальное хранилище).
   * @returns {Promise<{progress:Object, stats:Object|null}>}
   */
  function getCourse(course) {
    var c = course || config.course;
    var local = getLocal(c);
    return checkAuth().then(function (authedNow) {
      if (!authedNow) {
        return { progress: local, stats: null };
      }
      return api('/api/progress.php?course=' + encodeURIComponent(c))
        .then(function (d) {
          var server = (d && d.progress) ? d.progress : {};
          var merged = Object.assign({}, server, local);
          setLocal(c, merged);
          return { progress: merged, stats: d.stats || null };
        })
        .catch(function () { return { progress: local, stats: null }; });
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
      updated_at: new Date().toISOString()
    });
    setLocal(c, local);

    return checkAuth().then(function (authedNow) {
      if (!authedNow) return local[module];
      var body = Object.assign({ course: c, module: module }, entry);
      return api('/api/progress.php', { method: 'POST', body: JSON.stringify(body) })
        .catch(function () { /* офлайн/ошибка — оставляем в localStorage */ });
    });
  }

  /**
   * Пакетная запись прогресса курса.
   */
  function setBatch(updates, course) {
    var c = course || config.course;
    var local = getLocal(c);
    var now = new Date().toISOString();
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
      }).catch(function () { return local; });
    });
  }

  /**
   * Сводка по всем курсам (для портала). Требует авторизации.
   * @returns {Promise<Object|null>} {courses:{course:{total,completed,percentage,updated_at}}}
   */
  function getSummary() {
    return checkAuth().then(function (authedNow) {
      if (!authedNow) return null;
      return api('/api/progress.php').catch(function () { return null; });
    });
  }

  var apiObj = {
    init: init,
    checkAuth: checkAuth,
    resetAuth: resetAuth,
    getCourse: getCourse,
    setModule: setModule,
    setBatch: setBatch,
    getSummary: getSummary
  };

  global.NayanovaProgress = apiObj;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = apiObj;
  }
})(typeof window !== 'undefined' ? window : this);
