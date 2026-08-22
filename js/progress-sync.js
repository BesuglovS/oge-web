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
  // TODO: при появлении интерактивных страниц по заданиям 13.1/13.2/14
  // (сейчас доступна только теория oge131-t/oge132-t/oge14-t) — добавить их
  // в TASKS здесь и в oge-web/js/progress.js, чтобы итог совпадал с реальным
  // числом типов заданий (16).
  var TASKS = [
    'oge1', 'oge2', 'oge3', 'oge4', 'oge5', 'oge6', 'oge7', 'oge8', 'oge9',
    'oge10', 'oge11', 'oge12', 'oge15', 'oge16'
  ];

  function getLocalProgress() {
    try {
      return JSON.parse(global.localStorage.getItem('oge-progress') || '{}');
    } catch (e) {
      return {};
    }
  }

  function buildUpdates() {
    var data = getLocalProgress();
    var updates = [];
    var completed = 0;

    for (var i = 0; i < TASKS.length; i++) {
      var taskId = TASKS[i];
      var t = data[taskId];
      if (!t || typeof t !== 'object') continue;
      var done = !!(t.score > 0 || t.bestScore > 0);
      if (done) completed++;
      updates.push({
        module: taskId,
        completed: done ? 1 : 0,
        score: (t.bestScore || t.score || 0),
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
      data: { completed: completed, total: TASKS.length }
    });
    return updates;
  }

  function sync() {
    if (!global.NayanovaProgress) return;
    var updates = buildUpdates();
    if (!updates.length) return;
    NayanovaProgress.init({ course: COURSE });
    NayanovaProgress.setBatch(updates);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync);
  } else {
    sync();
  }
})(window);
