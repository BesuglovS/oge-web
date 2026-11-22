/* ==========================================================================
   oge-web → единая система прогресса Nayanova Academy
   Канонический источник: shared/js/progress-sync/oge.js
   Переносит локальный прогресс (oge-progress) в единую систему
   (auth.nayanovaacademy.ru/api/progress.php) и в nayanova-progress.
   Подключается на лендинге после progress-client.js.
   ========================================================================== */
(function (global) {
  'use strict';

  var COURSE = 'oge';
  // Список заданий — единый источник в js/progress.js (OGEProgress.tasks).
  // Локальная копия ниже нужна только как аварийный резерв, если progress.js
  // не подключён (например, модуль используется отдельно).
  var FALLBACK_TASKS = [
    'oge1', 'oge2', 'oge3', 'oge4', 'oge5', 'oge6', 'oge7', 'oge8', 'oge9',
    'oge10', 'oge11', 'oge12', 'oge131', 'oge132', 'oge14', 'oge15', 'oge16'
  ];
  var TASKS = (global.OGEProgress && Array.isArray(global.OGEProgress.tasks) && global.OGEProgress.tasks.length)
    ? global.OGEProgress.tasks
    : FALLBACK_TASKS;
  // 13.1 и 13.2 — альтернативы, поэтому в сводке это один номер.
  var EXAM_TASK_COUNT = 16;

  function getLocalProgress() {
    try {
      var data = JSON.parse(global.localStorage.getItem('oge-progress') || '{}');
      return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    } catch (e) {
      return {};
    }
  }

  function scoreOf(entry) {
    if (!entry || typeof entry !== 'object') return 0;
    var data = entry.data && typeof entry.data === 'object' ? entry.data : {};
    return Math.max(
      Number(entry.bestScore) || 0,
      Number(entry.score) || 0,
      Number(data.bestScore) || 0,
      Number(data.score) || 0
    );
  }

  function entryTime(entry) {
    if (!entry || typeof entry !== 'object') return 0;
    var s = entry.updated_at || entry.lastAttempt || '';
    if (typeof s !== 'string') return 0;
    // Legacy SQLite: 'YYYY-MM-DD HH:MM:SS' — это UTC без суффикса.
    // Без нормализации Date.parse трактует строку как локальное время.
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(s)) {
      s = s.replace(' ', 'T') + 'Z';
    }
    var t = Date.parse(s);
    return isNaN(t) ? 0 : t;
  }

  // Запись считается устаревшей после сброса, если она старше маркера,
  // не имеет времени или «убежала» в будущее из-за неверных часов.
  var CLOCK_SKEW_MS = 5 * 60 * 1000;
  function isStaleAfterReset(ts, resetAt) {
    if (!ts) return true;
    if (ts <= resetAt) return true;
    if (ts > Date.now() + CLOCK_SKEW_MS) return true;
    return false;
  }

  // Удаляем локальные следы прогресса старше серверного маркера __reset__:
  // oge-progress, зеркало nayanova-progress и старый outbox. Иначе другое
  // устройство «воскресит» прогресс после сброса.
  function purgeBeforeReset(resetAt) {
    var changed = false;

    var data = getLocalProgress();
    for (var id in data) {
      if (!Object.prototype.hasOwnProperty.call(data, id)) continue;
      if (isStaleAfterReset(entryTime(data[id]), resetAt)) {
        delete data[id];
        changed = true;
      }
    }
    if (changed) {
      try { global.localStorage.setItem('oge-progress', JSON.stringify(data)); } catch (e) { /* storage */ }
    }

    var mirrorChanged = false;
    try {
      var all = JSON.parse(global.localStorage.getItem('nayanova-progress') || '{}');
      var mirror = all && all[COURSE];
      if (mirror && typeof mirror === 'object') {
        for (var m in mirror) {
          if (!Object.prototype.hasOwnProperty.call(mirror, m)) continue;
          if (m === '__reset__') continue;
          if (isStaleAfterReset(entryTime(mirror[m]), resetAt)) {
            delete mirror[m];
            mirrorChanged = true;
          }
        }
      }
      if (mirrorChanged) {
        all[COURSE] = mirror;
        global.localStorage.setItem('nayanova-progress', JSON.stringify(all));
      }
    } catch (e) { /* storage */ }

    var outboxChanged = false;
    try {
      var rawOutbox = JSON.parse(global.localStorage.getItem('nayanova-progress:outbox') || '[]');
      if (Array.isArray(rawOutbox)) {
        var kept = rawOutbox.filter(function (item) {
          if (!item || item.course !== COURSE) return true;
          var payload = item.payload && typeof item.payload === 'object' ? item.payload : {};
          return !isStaleAfterReset(entryTime({ updated_at: payload.updated_at }), resetAt);
        });
        outboxChanged = kept.length !== rawOutbox.length;
        if (outboxChanged) {
          global.localStorage.setItem('nayanova-progress:outbox', JSON.stringify(kept));
        }
      }
    } catch (e) { /* storage */ }

    // Черновики чек-листов не имеют времени, поэтому после серверного сброса
    // удаляем их все: иначе на другом устройстве останется «Чек-лист: N из M».
    try {
      var checklistKeys = [];
      for (var ci = 0; ci < global.localStorage.length; ci++) {
        var ck = global.localStorage.key(ci);
        if (ck && ck.indexOf('oge-checklist:') === 0) checklistKeys.push(ck);
      }
      checklistKeys.forEach(function (k) { global.localStorage.removeItem(k); });
    } catch (e) { /* storage */ }

    if ((changed || mirrorChanged) && global.OGEProgress &&
        typeof global.OGEProgress.renderProgressBar === 'function') {
      global.OGEProgress.renderProgressBar('progressContainer');
    }
  }

  // server — «сырые» данные сервера (NayanovaProgress.getCourse().server).
  // Устаревшие локальные записи не отправляем, иначе устройство с давно
  // открытой вкладкой перезапишет более свежий прогресс с другого устройства.
  function buildUpdates(server) {
    var data = getLocalProgress();
    server = server && typeof server === 'object' ? server : {};
    var updates = [];

    function isDone(taskId) {
      var t = data[taskId];
      var s = server[taskId];
      var localDone = !!(t && typeof t === 'object' && (t.score > 0 || t.bestScore > 0));
      var serverDone = !!(s && typeof s === 'object' && (s.completed || scoreOf(s) > 0));
      return localDone || serverDone;
    }

    var completed = 0;
    for (var j = 0; j < TASKS.length; j++) {
      var countId = TASKS[j];
      if (countId === 'oge132') continue;
      if (countId === 'oge131') {
        if (isDone('oge131') || isDone('oge132')) completed++;
      } else if (isDone(countId)) {
        completed++;
      }
    }

    for (var i = 0; i < TASKS.length; i++) {
      var taskId = TASKS[i];
      var t = data[taskId];
      var s = server[taskId] && typeof server[taskId] === 'object' ? server[taskId] : null;

      if (!t || typeof t !== 'object') continue;

      if (s) {
        var localScore = scoreOf(t);
        var serverScore = scoreOf(s);
        var localTime = entryTime(t);
        var serverTime = entryTime(s);
        if (serverScore > localScore) continue;
        if (serverScore === localScore && serverTime >= localTime) continue;
      }

      var localDone = !!(t.score > 0 || t.bestScore > 0);
      updates.push({
        module: taskId,
        completed: localDone ? 1 : 0,
        score: (t.bestScore || t.score || 0),
        // Время последней попытки нужно серверу для защиты от старого outbox
        // после сброса. Сервер всё равно пишет своё updated_at.
        updated_at: t.lastAttempt || '',
        data: {
          score: t.score || 0,
          bestScore: t.bestScore || 0,
          attempts: t.attempts || 0
        }
      });
    }

    if (!updates.length) return [];

    updates.push({
      module: '__summary__',
      completed: completed ? 1 : 0,
      updated_at: new Date().toISOString(),
      data: { completed: completed, total: EXAM_TASK_COUNT }
    });
    return updates;
  }

  // Подтягиваем серверный прогресс в локальный oge-progress, чтобы лендинг
  // и полосы прогресса на устройствах показывали результат с других устройств.
  function mergeServerIntoLocal(server) {
    if (!server || typeof server !== 'object') return;
    var data = getLocalProgress();
    var changed = false;
    for (var i = 0; i < TASKS.length; i++) {
      var taskId = TASKS[i];
      var s = server[taskId];
      if (!s || typeof s !== 'object') continue;
      var local = data[taskId];
      var serverScore = scoreOf(s);
      var localScore = scoreOf(local);
      var serverTime = entryTime(s);
      var localTime = entryTime(local);
      var localDone = !!(local && (local.score > 0 || local.bestScore > 0));
      var serverDone = !!(s.completed || serverScore > 0);
      var shouldTake = !local ||
        (serverDone && !localDone) ||
        serverScore > localScore ||
        (serverScore === localScore && serverTime > localTime);
      if (!shouldTake) continue;
      var d = s.data && typeof s.data === 'object' ? s.data : {};
      var rawScore = Number(s.score) || Number(d.score) || 0;
      if (serverDone && rawScore === 0) rawScore = 1;
      data[taskId] = {
        score: rawScore,
        total: Number(s.total) || Number(local && local.total) || 1,
        bestScore: serverDone ? Math.max(1, serverScore) : serverScore,
        attempts: Number(s.attempts) || Number(d.attempts) || 0,
        lastAttempt: s.updated_at || s.lastAttempt || new Date(serverTime || Date.now()).toISOString()
      };
      changed = true;
    }
    if (changed) {
      try { global.localStorage.setItem('oge-progress', JSON.stringify(data)); } catch (e) { /* storage */ }
      if (global.OGEProgress && typeof global.OGEProgress.renderProgressBar === 'function') {
        global.OGEProgress.renderProgressBar('progressContainer');
      }
    }
  }

  function sync() {
    if (!global.NayanovaProgress) return;
    NayanovaProgress.init({ course: COURSE });
    NayanovaProgress.getCourse(COURSE).then(function (res) {
      // Сервер недоступен — не отправляем локальные данные «как свежие».
      if (!res || res.unavailable) return;

      // Серверный сброс: маркер __reset__ новее локальных записей.
      var resetAt = entryTime(res.server && res.server.__reset__);
      if (resetAt) purgeBeforeReset(resetAt);

      mergeServerIntoLocal(res.server);
      var updates = buildUpdates(res.server);
      if (!updates.length) return;
      NayanovaProgress.setBatch(updates);
    }).catch(function () { /* повторим при следующем открытии */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync);
  } else {
    sync();
  }

  // Прогресс сохраняется и на страницах заданий (OGEProgress.save) —
  // отправляем его на портал сразу, а не только при открытии лендинга.
  var syncTimer = null;
  function scheduleSync() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, 300);
  }
  if (document.addEventListener) {
    document.addEventListener('oge-progress-saved', scheduleSync);
  }
})(window);
