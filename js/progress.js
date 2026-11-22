/* ============================================================
   oge-web — Модуль сохранения прогресса (localStorage)
   ============================================================ */
var OGEProgress = (function() {
  var STORAGE_KEY = 'oge-progress';
  // Интерактивные задания: 13.1 и 13.2 — тренажёры-чек-листы, 14 — таблицы.
  var TASKS = [
    'oge1','oge2','oge3','oge4','oge5','oge6','oge7','oge8','oge9','oge10',
    'oge11','oge12','oge131','oge132','oge14','oge15','oge16'
  ];
  // На экзамене 16 номеров: 13.1 и 13.2 — альтернативы, поэтому для
  // процента и уровня они считаются одним слотом.
  var EXAM_TASK_COUNT = 16;

  function getAll() {
    try {
      var data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
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
    // Обновляем полосу прогресса сразу на текущей странице, не дожидаясь
    // перезагрузки. Раньше это делали только 11/12 и чек-листы.
    if (typeof document !== 'undefined') renderProgressBar('progressContainer');
    return data[taskId];
  }

  function get(taskId) {
    var data = getAll();
    return data[taskId] || null;
  }

  function isCompleted(taskId) {
    var t = get(taskId);
    // Черновики чек-листов здесь намеренно не учитываются: «пройдено»
    // означает только сохранённый результат самого задания.
    return !!(t && (t.score > 0 || t.bestScore > 0));
  }

  function getCompletedCount() {
    var data = getAll();
    var count = 0;
    for (var i = 0; i < TASKS.length; i++) {
      var id = TASKS[i];
      // 13.1 и 13.2 — альтернативы: любой из них закрывает один номер.
      if (id === 'oge132') continue;
      if (id === 'oge131') {
        var a = data.oge131;
        var b = data.oge132;
        if ((a && (a.score > 0 || a.bestScore > 0)) ||
            (b && (b.score > 0 || b.bestScore > 0))) count++;
        continue;
      }
      var t = data[id];
      // Критерий должен совпадать с js/progress-sync.js, иначе итог на
      // лендинге и на портале разойдутся.
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
    return Math.round((getCompletedCount() / EXAM_TASK_COUNT) * 100);
  }

  function getLevel() {
    // Уровень считаем по числу закрытых экзаменационных номеров.
    var done = getCompletedCount();
    if (done >= EXAM_TASK_COUNT) return { name: 'Мастер', emoji: '🏆' };
    if (done >= Math.ceil(EXAM_TASK_COUNT * 0.7)) return { name: 'Эксперт', emoji: '⭐' };
    if (done >= Math.ceil(EXAM_TASK_COUNT * 0.4)) return { name: 'Практик', emoji: '📘' };
    if (done >= Math.ceil(EXAM_TASK_COUNT * 0.2)) return { name: 'Ученик', emoji: '📚' };
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
    // Именно количество закрытых номеров, а не сумма баллов: чек-листы
    // 13.1/13.2 сохраняют score = число шагов, а 13.1 и 13.2 считаются
    // одной альтернативой.
    var done = getCompletedCount();
    el.innerHTML =
      '<div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-label="Пройдено заданий: ' + pct + '%">' +
      '</div>' +
      '<div class="progress-score">' +
        level.emoji + ' ' + level.name + ' — ' + done + ' ' +
        plural(done, 'задание', 'задания', 'заданий') + ' пройдено (' + pct + '%)' +
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
    isCompleted: isCompleted,
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
