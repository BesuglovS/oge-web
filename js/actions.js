/* ============================================================
   Действия по data-атрибутам (CSP без 'unsafe-inline').

   Вместо inline-обработчиков вида onclick="checkAnswer()" в разметке
   стоит data-act="checkAnswer" (плюс data-arg="…" при аргументе),
   data-nav="страница.html" для перехода и data-act-change для change.
   Здесь один делегированный слушатель вызывает глобальную функцию.

   data-act-key="enter|enterSpace" — клавиатурный вариант для элементов,
   которые не являются кнопками (Enter/пробел по div с role="button").
   ============================================================ */
(function () {
  'use strict';

  var EXTRA = {
    scrollTopSmooth: function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    scrollToc: function (el) {
      var sel = el.getAttribute('data-target') || '.toc';
      var node = document.querySelector(sel);
      if (node) node.scrollIntoView({ behavior: 'smooth' });
    },
    reloadPage: function () {
      window.location.reload();
    }
  };

  // Аргументы из data-arg: "py" → ['py']; "2|3" → [2, 3] (числа — числами).
  function argsOf(el) {
    var raw = el.getAttribute('data-arg');
    if (raw === null) return null;
    return raw.split('|').map(function (p) {
      return /^-?\d+$/.test(p) ? Number(p) : p;
    });
  }

  function run(el, event, extraArgs) {
    var name = el.getAttribute('data-act');
    if (!name) return false;
    var args = argsOf(el) || [];
    if (extraArgs) args = args.concat(extraArgs);
    if (Object.prototype.hasOwnProperty.call(EXTRA, name)) {
      EXTRA[name].apply(el, [el].concat(args).concat([event]));
      return true;
    }
    var fn = window[name];
    if (typeof fn === 'function') {
      fn.apply(el, args.concat([event]));
      return true;
    }
    // Не ломаем страницу: событие просто игнорируется, но пишем в консоль.
    console.warn('actions.js: обработчик не найден — ' + name);
    return false;
  }

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act],[data-nav]') : null;
    if (!el) return;
    var nav = el.getAttribute('data-nav');
    if (nav) {
      window.location.href = nav;
      return;
    }
    run(el, e);
  });

  document.addEventListener('change', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act-change]') : null;
    if (!el) return;
    var name = el.getAttribute('data-act-change');
    var fn = window[name];
    if (typeof fn !== 'function') {
      console.warn('actions.js: обработчик не найден — ' + name);
      return;
    }
    var args = argsOf(el);
    if (args) fn.apply(el, args.concat([el.value, e]));
    else fn.call(el, el.value, e);
  });

  document.addEventListener('keydown', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act-key]') : null;
    if (!el) return;
    var mode = el.getAttribute('data-act-key');
    var isEnter = e.key === 'Enter';
    var isSpace = e.key === ' ' || e.key === 'Spacebar';
    if ((mode === 'enter' && isEnter) || (mode === 'enterSpace' && (isEnter || isSpace))) {
      e.preventDefault();
      run(el, e);
    }
  });

  // Бывшее onfocus="this.select()" — выделяем текст при фокусе.
  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (el && el.hasAttribute && el.hasAttribute('data-select-on-focus') && typeof el.select === 'function') {
      el.select();
    }
  });
})();
