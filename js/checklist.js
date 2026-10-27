/* ============================================================
   Тренажёры-чек-листы для заданий 13.1 и 13.2.

   Страница объявляет массив шагов и вызывает checklistInit(taskId, steps).
   Шаг: { id, title, text, question, options: [...], correct: N, hint, why }.
   Пока шаг не решён, «Следующий шаг» заблокирован; после последнего шага
   прогресс пишется в localStorage через OGEProgress (score = число шагов).
   ============================================================ */
(function () {
  'use strict';

  var state = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function stepHtml(step) {
    var html = '<h2 class="cl-title">' + esc(step.title) + '</h2>' +
      '<div class="cl-text">' + step.text + '</div>' +
      '<div class="cl-question">' + step.question + '</div>' +
      '<div class="cl-options">';
    step.options.forEach(function (option, i) {
      html += '<button type="button" class="cl-option" data-act="checklistPick" data-arg="' + i + '">' + esc(option) + '</button>';
    });
    html += '</div>' +
      '<div class="cl-feedback" id="clFeedback" role="status" aria-live="polite"></div>' +
      '<div class="cl-actions">' +
        '<button type="button" class="btn btn-hint" data-act="checklistHint">💡 Подсказка</button>' +
        '<button type="button" class="btn btn-next cl-next" data-act="checklistNext" disabled>Следующий шаг →</button>' +
      '</div>';
    return html;
  }

  function finalHtml() {
    var items = state.steps.map(function (s) {
      return '<li>' + esc(s.title) + '</li>';
    }).join('');
    return '<h2 class="cl-title">🏁 Чек-лист пройден</h2>' +
      '<p class="cl-text">Все шаги пройдены. Теперь выполните задание в ' + esc(state.app) + ' — пройдитесь по списку ещё раз, чтобы ничего не забыть.</p>' +
      '<ol class="cl-final-list">' + items + '</ol>' +
      '<p class="cl-final-note">Перед сдачей проверьте: файл сохранён <strong>в указанной папке</strong> и <strong>с нужным расширением</strong>, открывается заново и выглядит как в образце.</p>' +
      '<button type="button" class="btn btn-next" data-act="checklistRestart">🔄 Пройти заново</button>';
  }

  function render() {
    var steps = state.steps;
    var done = state.done;
    byId('clStepNum').textContent = 'Шаг ' + (state.finished ? steps.length : state.index + 1) + ' из ' + steps.length;
    byId('clDoneNum').textContent = 'выполнено ' + done.length;
    byId('clChips').innerHTML = steps.map(function (s, i) {
      var cls = done.indexOf(i) >= 0 ? 'done' : (i === state.index && !state.finished ? 'current' : 'todo');
      var mark = done.indexOf(i) >= 0 ? '✓' : String(i + 1);
      return '<span class="cl-chip ' + cls + '" title="' + esc(s.title) + '">' + mark + '</span>';
    }).join('');
    byId('clBody').innerHTML = state.finished ? finalHtml() : stepHtml(steps[state.index]);
  }

  function pick(i) {
    if (!state || state.finished) return;
    var step = state.steps[state.index];
    var feedback = byId('clFeedback');
    var options = document.querySelectorAll('.cl-option');
    if (!feedback || !options.length) return;

    if (Number(i) === step.correct) {
      if (state.done.indexOf(state.index) < 0) state.done.push(state.index);
      state.solved = true;
      feedback.className = 'cl-feedback ok';
      feedback.innerHTML = '✅ Верно! ' + (step.why || '');
      if (options[step.correct]) options[step.correct].classList.add('chosen');
      Array.prototype.forEach.call(options, function (btn) {
        btn.classList.remove('wrong');
        btn.disabled = true;
      });
      var next = document.querySelector('.cl-next');
      if (next) {
        next.disabled = false;
        next.focus();
      }
      var doneNum = byId('clDoneNum');
      if (doneNum) doneNum.textContent = 'выполнено ' + state.done.length;
    } else {
      feedback.className = 'cl-feedback error';
      feedback.innerHTML = '❌ Не совсем. ' + (step.hint || 'Попробуйте другой вариант.');
      if (options[i]) options[i].classList.add('wrong');
    }
  }

  function hint() {
    if (!state || state.finished) return;
    if (typeof trackHint === 'function') trackHint(state.taskId);
    var step = state.steps[state.index];
    var feedback = byId('clFeedback');
    if (!feedback) return;
    feedback.className = 'cl-feedback hint';
    feedback.innerHTML = '💡 ' + esc(step.hint || 'Перечитайте текст шага.');
  }

  function nextStep() {
    if (!state || state.finished || !state.solved) return;
    state.solved = false;
    if (state.index < state.steps.length - 1) {
      state.index++;
      render();
      var card = byId('taskCard');
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    finish();
  }

  function finish() {
    state.finished = true;
    render();
    if (state.saved) return;
    state.saved = true;
    if (typeof OGEProgress !== 'undefined') {
      OGEProgress.save(state.taskId, state.steps.length, state.steps.length);
      OGEProgress.renderProgressBar('progressContainer');
    }
    if (typeof trackTaskComplete === 'function') trackTaskComplete(state.taskId, state.steps.length);
  }

  function restart() {
    if (!state) return;
    state.index = 0;
    state.done = [];
    state.solved = false;
    state.finished = false;
    state.saved = false;
    render();
  }

  function init(taskId, steps, opts) {
    if (!Array.isArray(steps) || !steps.length) return;
    state = {
      taskId: taskId,
      steps: steps,
      app: (opts && opts.app) || 'редакторе',
      index: 0,
      done: [],
      solved: false,
      finished: false,
      saved: false
    };
    var card = byId('taskCard');
    if (!card) return;
    card.innerHTML =
      '<div class="cl-head">' +
        '<div class="cl-progress-text"><span id="clStepNum"></span> · <span id="clDoneNum"></span></div>' +
        '<div class="cl-chips" id="clChips"></div>' +
      '</div>' +
      '<div id="clBody"></div>';
    render();
    if (typeof OGEProgress !== 'undefined') OGEProgress.renderProgressBar('progressContainer');
    if (typeof trackTaskStart === 'function') trackTaskStart(taskId);
  }

  // Глобальные обработчики для data-act (js/actions.js вызывает window[name]).
  window.checklistInit = init;
  window.checklistPick = pick;
  window.checklistHint = hint;
  window.checklistNext = nextStep;
  window.checklistRestart = restart;
})();
