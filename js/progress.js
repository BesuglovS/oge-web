/* ============================================================
   oge-web — Модуль сохранения прогресса (localStorage)
   ============================================================ */
var OGEProgress = (function() {
  var STORAGE_KEY = 'oge-progress';
  // Задания 13.1/13.2 (презентация и текстовый документ) пока только теория —
  // интерактивных страниц для них нет, поэтому в TASKS их не включаем.
  // Задание 14 — тренажёр таблиц (oge14.html), он в списке.
  var TASKS = [
    'oge1','oge2','oge3','oge4','oge5','oge6','oge7','oge8','oge9','oge10',
    'oge11','oge12','oge14','oge15','oge16'
  ];

  function getAll() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch(e) {
      return {};
    }
  }

  function save(taskId, score, total) {
    var data = getAll();
    var prev = data[taskId] || { score: 0, attempts: 0, bestScore: 0 };
    data[taskId] = {
      score: score,
      total: total,
      bestScore: Math.max(prev.bestScore || 0, score),
      attempts: (prev.attempts || 0) + 1,
      lastAttempt: new Date().toISOString()
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch(e) { /* storage full */ }
    // Сигнал для progress-sync: прогресс нужно отправить на портал сразу,
    // не дожидаясь следующего открытия лендинга.
    try {
      if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
        document.dispatchEvent(new CustomEvent('oge-progress-saved', { detail: { taskId: taskId } }));
      }
    } catch(e) { /* старые окружения */ }
    return data[taskId];
  }

  function get(taskId) {
    var data = getAll();
    return data[taskId] || null;
  }

  function getTotalScore() {
    var data = getAll();
    var sum = 0;
    for (var i = 0; i < TASKS.length; i++) {
      var t = data[TASKS[i]];
      if (t && t.bestScore) sum += t.bestScore;
    }
    return sum;
  }

  function getCompletedCount() {
    var data = getAll();
    var count = 0;
    for (var i = 0; i < TASKS.length; i++) {
      var t = data[TASKS[i]];
      // Критерий должен совпадать с js/progress-sync.js, иначе итог на
      // лендинге и на портале разойдётся.
      if (t && (t.score > 0 || t.bestScore > 0)) count++;
    }
    return count;
  }

  // Русская форма множественного числа: plural(5, 'балл', 'балла', 'баллов').
  function plural(n, one, few, many) {
    var n10 = n % 10;
    var n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return one;
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
    return many;
  }

  function getProgressPercent() {
    return Math.round((getCompletedCount() / TASKS.length) * 100);
  }

  function getLevel() {
    // Уровень считаем по числу пройденных заданий: каждое задание даёт
    // максимум 1 балл, поэтому «сырые» пороги (15/40/70/100) были
    // недостижимы — итоговый максимум равен TASKS.length.
    var done = getCompletedCount();
    if (done >= TASKS.length) return { name: 'Мастер', emoji: '🏆' };
    if (done >= Math.ceil(TASKS.length * 0.7)) return { name: 'Эксперт', emoji: '⭐' };
    if (done >= Math.ceil(TASKS.length * 0.4)) return { name: 'Практик', emoji: '📘' };
    if (done >= Math.ceil(TASKS.length * 0.2)) return { name: 'Ученик', emoji: '📚' };
    return { name: 'Новичок', emoji: '🌱' };
  }

  function clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch(e) {}
  }

  function renderProgressBar(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var pct = getProgressPercent();
    var level = getLevel();
    var total = getTotalScore();
    el.innerHTML =
      '<div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-label="Пройдено заданий: ' + pct + '%">' +
      '</div>' +
      '<div class="progress-score">' +
        level.emoji + ' ' + level.name + ' — ' + total + ' ' +
        plural(total, 'задание', 'задания', 'заданий') + ' пройдено (' + pct + '%)' +
      '</div>';
    // Заливка — через CSSOM: инлайновый style-атрибут запрещён CSP (нет 'unsafe-inline').
    var bar = el.querySelector('.progress-bar');
    if (bar) {
      var fill = document.createElement('div');
      fill.className = 'progress-bar-fill';
      fill.style.width = pct + '%';
      bar.appendChild(fill);
    }
  }

  return {
    save: save,
    get: get,
    getAll: getAll,
    getTotalScore: getTotalScore,
    getCompletedCount: getCompletedCount,
    getProgressPercent: getProgressPercent,
    getLevel: getLevel,
    clear: clear,
    renderProgressBar: renderProgressBar,
    // Единственный источник списка заданий: progress-sync.js берёт его отсюда,
    // чтобы списки не расходились (раньше копия жила в двух файлах).
    tasks: TASKS
  };
})();
