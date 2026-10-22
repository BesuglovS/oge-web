/**
 * Редактор кода Python для тренажёра ОГЭ (задание 16).
 *
 * Подсветка синтаксиса + номера строк по технике overlay: прозрачная
 * textarea поверх слоя с подсвеченным кодом. Переносы длинных строк
 * в слое и в textarea обязаны совпадать пиксель в пиксель, иначе
 * каретка «уезжает» от подсвеченного текста.
 *
 * Использование: OgeCodeEditor.init({ draftKey: 'oge16-draft-16-01' })
 * после вставки разметки редактора в DOM.
 */
(function () {
  'use strict';

  var INDENT = '    '; // шаг отступа Python
  var PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
  var CLOSERS = { ')': 1, ']': 1, '}': 1, '"': 1, "'": 1 };

  // Единое регулярное выражение токенов Python (собирается один раз).
  // Порядок альтернатив важен: длинные совпадения идут раньше коротких.
  var TOKEN_RE = new RegExp(
    [
      // строки в тройных кавычках (с префиксом r/b/u/f и их комбинациями)
      '(?:[rRbBuUfF]{0,2}"""[\\s\\S]*?""")',
      "(?:[rRbBuUfF]{0,2}'''[\\s\\S]*?''')",
      // обычные строки; \\[\s\S] — экранированный символ, в том числе перенос строки
      '(?:[rRbBuUfF]{0,2}"[^"\\\\]*(?:\\\\[\\s\\S][^"\\\\]*)*")',
      "(?:[rRbBuUfF]{0,2}'[^'\\\\]*(?:\\\\[\\s\\S][^'\\\\]*)*')",
      // комментарии
      '(?:#[^\\n]*)',
      // числа: 0x1F, 1_000, 3.5, .5, 1., 1e-3, 2j
      '(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|' +
        '(?:\\d[\\d_]*(?:\\.[\\d_]*)?|\\.[\\d_]+)(?:[eE][+-]?[\\d_]+)?[jJ]?)',
      // идентификаторы
      '(?:[a-zA-Z_][a-zA-Z0-9_]*)'
    ].join('|'),
    'g'
  );

  var KEYWORDS = {
    False: 1, None: 1, True: 1, and: 1, as: 1, assert: 1, async: 1, await: 1,
    break: 1, class: 1, continue: 1, def: 1, del: 1, elif: 1, else: 1, except: 1,
    finally: 1, for: 1, from: 1, global: 1, if: 1, import: 1, in: 1, is: 1,
    lambda: 1, nonlocal: 1, not: 1, or: 1, pass: 1, raise: 1, return: 1,
    try: 1, while: 1, with: 1, yield: 1
  };

  var BUILTINS = {
    abs: 1, all: 1, any: 1, bin: 1, bool: 1, callable: 1, chr: 1, dict: 1,
    dir: 1, divmod: 1, enumerate: 1, filter: 1, float: 1, format: 1, getattr: 1,
    hasattr: 1, hash: 1, hex: 1, id: 1, input: 1, int: 1, isinstance: 1,
    iter: 1, len: 1, list: 1, map: 1, max: 1, min: 1, next: 1, object: 1,
    oct: 1, open: 1, ord: 1, pow: 1, print: 1, range: 1, repr: 1, reversed: 1,
    round: 1, set: 1, sorted: 1, str: 1, sum: 1, tuple: 1, type: 1, zip: 1
  };

  // Текущее состояние: при каждой отрисовке задания textarea создаётся заново
  var state = null;
  var draftKey = null;
  var draftTimer = null;
  var highlightFrame = 0;
  var resizeObserver = null;
  var globalsBound = false;

  /**
   * CSS-класс токена (пустая строка — обычный текст).
   */
  function tokenClass(token) {
    var stringMatch = /^([rRbBuUfF]{0,2})(["'])/.exec(token);
    if (stringMatch) {
      var prefix = stringMatch[1];
      var quote = stringMatch[2];
      var isF = /[fF]/.test(prefix);
      if (token.indexOf(quote + quote + quote) === prefix.length) {
        return 'oge-hl-string oge-hl-multiline' + (isF ? ' oge-hl-fstring' : '');
      }
      return isF ? 'oge-hl-string oge-hl-fstring' : 'oge-hl-string';
    }
    if (token.charAt(0) === '#') return 'oge-hl-comment';
    if (/^[0-9.]/.test(token)) return 'oge-hl-number';
    if (/^[a-zA-Z_]/.test(token)) {
      if (KEYWORDS[token]) return 'oge-hl-keyword';
      if (BUILTINS[token]) return 'oge-hl-builtin';
    }
    return '';
  }

  /**
   * Подсветка кода с разбивкой по логическим строкам:
   * массив HTML-фрагментов, по одному на строку.
   */
  function highlightLines(code) {
    var lines = [];
    var current = '';

    function append(fragment, cssClass) {
      var parts = fragment.split('\n');
      for (var i = 0; i < parts.length; i++) {
        if (i > 0) {
          lines.push(current);
          current = '';
        }
        if (!parts[i]) continue;
        current += cssClass
          ? '<span class="' + cssClass + '">' + parts[i] + '</span>'
          : parts[i];
      }
    }

    if (!code) return [''];

    // Экранируем HTML
    var amp = String.fromCharCode(38);
    var escaped = code
      .replace(/&/g, amp + 'amp;')
      .replace(/</g, amp + 'lt;')
      .replace(/>/g, amp + 'gt;');

    TOKEN_RE.lastIndex = 0;

    var pos = 0;
    var match;
    while ((match = TOKEN_RE.exec(escaped)) !== null) {
      if (match.index > pos) {
        append(escaped.substring(pos, match.index), '');
      }
      append(match[0], tokenClass(match[0]));
      pos = TOKEN_RE.lastIndex;
    }
    if (pos < escaped.length) {
      append(escaped.substring(pos), '');
    }

    lines.push(current);
    return lines;
  }

  /**
   * Перерисовка слоя подсветки и номеров строк.
   */
  function updateLayer() {
    if (!state) return;
    var textarea = state.textarea;
    var layer = state.layer;

    // Размер слоя повторяет клиентскую область textarea: полоса прокрутки
    // отнимает у textarea несколько пикселей ширины, и без синхронизации
    // переносы строк в слое и в textarea не совпадают
    layer.style.width = textarea.clientWidth + 'px';
    layer.style.height = textarea.clientHeight + 'px';

    var htmlLines = highlightLines(textarea.value);
    var html = '';
    for (var i = 0; i < htmlLines.length; i++) {
      html += '<div class="oge-code-line">' +
        '<span class="oge-code-line-num">' + (i + 1) + '</span>' +
        htmlLines[i] + '</div>';
    }
    layer.innerHTML = html;

    layer.scrollTop = textarea.scrollTop;
    layer.scrollLeft = textarea.scrollLeft;
  }

  // Перерисовка не чаще одного кадра: ввод не «дёргает» layout
  function scheduleHighlight() {
    if (highlightFrame) return;
    highlightFrame = (window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); })(function () {
      highlightFrame = 0;
      updateLayer();
    });
  }

  /**
   * Позиция курсора в статусбаре.
   */
  function updateCursorPosition() {
    if (!state) return;
    var pos = document.getElementById('editorPosition');
    if (!pos) return;
    var textarea = state.textarea;
    var before = textarea.value.substring(0, textarea.selectionStart);
    var lines = before.split('\n');
    pos.textContent = lines.length + ':' + (lines[lines.length - 1].length + 1);
  }

  /**
   * Заменяет диапазон [from, to) текстом text с сохранением нативного undo.
   * execCommand('insertText'/'delete') выполняется как пользовательский ввод
   * и сам порождает событие input — подсветка и черновик обновятся штатно.
   * Если браузер команду не поддерживает — обычная запись value.
   */
  function replaceRange(textarea, from, to, text) {
    var value = textarea.value;
    if (from === to && text === '') return;

    textarea.focus();
    textarea.setSelectionRange(from, to);

    var done = false;
    try {
      done = text === ''
        ? document.execCommand('delete')
        : document.execCommand('insertText', false, text);
    } catch (err) {
      done = false;
    }
    if (done) {
      // input обычно уже пришёл; дублируем (идемпотентно) — в части
      // браузеров события может не быть
      scheduleHighlight();
      scheduleDraftSave();
      return;
    }

    textarea.value = value.substring(0, from) + text + value.substring(to);
    var caret = from + text.length;
    textarea.setSelectionRange(caret, caret);
    updateCursorPosition();
    scheduleHighlight();
    scheduleDraftSave();
  }

  /**
   * Сдвиг отступа строк, затронутых выделением: +1 — добавить шаг,
   * -1 — убрать (до 4 пробелов или один табулятор). Пустые строки не трогаем.
   */
  function shiftIndent(textarea, direction) {
    var value = textarea.value;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;

    // Строка, на начале которой заканчивается выделение, не затрагивается
    var blockEnd;
    if (end > lineStart && value.charAt(end - 1) === '\n') {
      blockEnd = end - 1;
    } else {
      var nl = value.indexOf('\n', end);
      blockEnd = nl === -1 ? value.length : nl;
    }
    if (blockEnd <= lineStart) return;

    var lines = value.substring(lineStart, blockEnd).split('\n');
    var caretLine = value.substring(lineStart, start).split('\n').length - 1;
    var caretShift = 0;
    var changed = false;

    for (var i = 0; i < lines.length; i++) {
      var before = lines[i];
      var after = before;

      if (before.trim() === '') {
        after = before;
      } else if (direction > 0) {
        after = INDENT + before;
      } else if (before.charAt(0) === '\t') {
        after = before.substring(1);
      } else {
        var n = 0;
        while (n < INDENT.length && before.charAt(n) === ' ') n++;
        after = before.substring(n);
      }

      if (i === caretLine) caretShift = after.length - before.length;
      lines[i] = after;
      if (after !== before) changed = true;
    }

    if (!changed) return;

    var newBlock = lines.join('\n');
    replaceRange(textarea, lineStart, blockEnd, newBlock);

    if (start === end) {
      var caret = Math.max(lineStart, start + caretShift);
      textarea.setSelectionRange(caret, caret);
    } else {
      textarea.setSelectionRange(lineStart, lineStart + newBlock.length);
    }
    updateCursorPosition();
  }

  // Tab: отступ до ближайшей позиции табуляции, на выделении — сдвиг блока
  function insertIndent(textarea) {
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;

    if (start !== end) {
      shiftIndent(textarea, 1);
      return;
    }

    var value = textarea.value;
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var spaces = INDENT.length - ((start - lineStart) % INDENT.length);
    replaceRange(textarea, start, start, new Array(spaces + 1).join(' '));
    updateCursorPosition();
  }

  // Ctrl+/ — закомментировать или раскомментировать выделенные строки
  function toggleComment(textarea) {
    var value = textarea.value;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;

    var blockEnd;
    if (end > lineStart && value.charAt(end - 1) === '\n') {
      blockEnd = end - 1;
    } else {
      var nl = value.indexOf('\n', end);
      blockEnd = nl === -1 ? value.length : nl;
    }
    if (blockEnd <= lineStart) return;

    var block = value.substring(lineStart, blockEnd);
    var lines = block.split('\n');
    var nonEmpty = lines.filter(function (line) { return line.trim() !== ''; });
    if (nonEmpty.length === 0) return;

    var allCommented = nonEmpty.every(function (line) { return /^\s*#/.test(line); });
    var result = lines.map(function (line) {
      if (line.trim() === '') return line;
      return allCommented
        ? line.replace(/^(\s*)#[ \t]?/, '$1')
        : line.replace(/^(\s*)/, '$1# ');
    }).join('\n');

    if (result === block) return;

    replaceRange(textarea, lineStart, blockEnd, result);
    textarea.setSelectionRange(lineStart, lineStart + result.length);
    updateCursorPosition();
  }

  // Enter: сохраняем отступ строки, после «:» — плюс один шаг (начало блока)
  function autoIndentNewline(textarea, e) {
    var value = textarea.value;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var beforeCaret = value.substring(lineStart, start);

    var indent = /^[ \t]*/.exec(beforeCaret)[0];
    var insert = '\n' + indent;
    if (/:\s*(#.*)?$/.test(beforeCaret)) insert += INDENT;

    e.preventDefault();
    replaceRange(textarea, start, end, insert);
    updateCursorPosition();
  }

  // Можно ли открыть кавычку в этой позиции (апостроф в «don't» не ломаем)
  function canOpenQuote(value, pos) {
    var prev = value.charAt(pos - 1);
    if (!prev) return true;
    if (!/[\w"')\]]/.test(prev)) return true;
    // исключение — префикс строки: f" rb" b" r" u"
    return /[rRbBuUfF]/.test(prev) && !/\w/.test(value.charAt(pos - 2));
  }

  /**
   * Автозакрытие скобок и кавычек: () [] {} "" ''. На выделении — обёртка.
   */
  function handleAutoPair(textarea, e) {
    var ch = e.key;
    if (ch.length !== 1) return false;

    var value = textarea.value;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var isQuote = ch === '"' || ch === "'";

    // 1) Закрывающий символ уже стоит за кареткой — «перешагиваем» его
    if (start === end && CLOSERS[ch] && value.charAt(start) === ch) {
      e.preventDefault();
      textarea.setSelectionRange(start + 1, start + 1);
      updateCursorPosition();
      return true;
    }

    if (!PAIRS[ch]) return false;

    // 2) Кавычку не открываем внутри слова
    if (isQuote && !canOpenQuote(value, start)) return false;

    e.preventDefault();
    if (start !== end) {
      var selected = value.substring(start, end);
      replaceRange(textarea, start, end, ch + selected + PAIRS[ch]);
      textarea.setSelectionRange(start + 1, end + 1);
    } else {
      replaceRange(textarea, start, start, ch + PAIRS[ch]);
      textarea.setSelectionRange(start + 1, start + 1);
    }
    updateCursorPosition();
    return true;
  }

  // Backspace между парой () [] {} "" '' удаляет обе половины
  function handlePairBackspace(textarea, e) {
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    if (start !== end || start === 0) return false;

    var value = textarea.value;
    var before = value.charAt(start - 1);
    var after = value.charAt(start);
    if (!PAIRS[before] || PAIRS[before] !== after) return false;

    e.preventDefault();
    replaceRange(textarea, start - 1, start + 1, '');
    textarea.setSelectionRange(start - 1, start - 1);
    updateCursorPosition();
    return true;
  }

  // Дублирование строки (или выделенного блока строк) — Ctrl+D
  function duplicateLine(textarea) {
    var value = textarea.value;
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;

    if (start === end) {
      var lineStart = value.lastIndexOf('\n', start - 1) + 1;
      var lineEnd = value.indexOf('\n', start);
      var line = value.substring(lineStart, lineEnd === -1 ? value.length : lineEnd);
      var insertPos = lineEnd === -1 ? value.length : lineEnd + 1;
      var insertText = lineEnd === -1 ? '\n' + line : line + '\n';
      replaceRange(textarea, insertPos, insertPos, insertText);
      var column = start - lineStart;
      var copyStart = insertPos + (insertText.charAt(0) === '\n' ? 1 : 0);
      textarea.setSelectionRange(copyStart + column, copyStart + column);
    } else {
      var blockLineStart = value.lastIndexOf('\n', start - 1) + 1;
      var blockEnd = end;
      if (value[end - 1] !== '\n') {
        var nl = value.indexOf('\n', end - 1);
        blockEnd = nl === -1 ? value.length : nl + 1;
      }
      var block = value.substring(blockLineStart, blockEnd);
      var blockInsertPos = blockEnd;
      var blockInsertText = block.charAt(block.length - 1) === '\n' ? block : '\n' + block;
      replaceRange(textarea, blockInsertPos, blockInsertPos, blockInsertText);
      textarea.setSelectionRange(
        blockEnd + blockInsertText.length,
        blockEnd + blockInsertText.length
      );
    }
    updateCursorPosition();
  }

  /**
   * Черновик: сохраняем введённый код, чтобы он не терялся при переходе
   * к другому заданию или случайном закрытии вкладки.
   */
  function saveDraft() {
    if (!draftKey || !state) return;
    clearTimeout(draftTimer);
    draftTimer = null;
    try {
      localStorage.setItem(draftKey, state.textarea.value);
      localStorage.setItem(draftKey + '-time', String(Date.now()));
    } catch (e) { /* localStorage недоступен — не критично */ }
  }

  function scheduleDraftSave() {
    if (!draftKey || !state) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 500);
  }

  function restoreDraft() {
    if (!draftKey || !state) return;
    var draft = null;
    var ts = 0;
    try {
      draft = localStorage.getItem(draftKey);
      ts = parseInt(localStorage.getItem(draftKey + '-time'), 10) || 0;
    } catch (e) { /* localStorage недоступен */ }
    if (!draft) return;

    state.textarea.value = draft;
    state.textarea.selectionStart = state.textarea.selectionEnd = draft.length;
    state.textarea.scrollTop = state.textarea.scrollHeight;

    var note = document.getElementById('editorNote');
    if (note && ts) {
      note.textContent = 'Черновик от ' + new Date(ts).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
      });
      note.title = 'Восстановлен сохранённый черновик';
    }
  }

  /**
   * Инициализация редактора после вставки разметки в DOM.
   * options.draftKey — ключ localStorage для черновика (необязательно).
   */
  function init(options) {
    var textarea = document.getElementById('codeEditor');
    var layer = document.getElementById('codeHighlight');
    if (!textarea || !layer) return;

    draftKey = (options && options.draftKey) || null;
    state = {
      textarea: textarea,
      layer: layer,
      box: textarea.closest ? textarea.closest('.code-editor-box') : null
    };

    // Черновик подставляем до первого рендера подсветки
    restoreDraft();

    // Сначала рисуем подсветку — и только потом прячем текст textarea,
    // чтобы код не мигал пустым блоком
    updateLayer();
    updateCursorPosition();

    // Если editor.js не загрузился, textarea остаётся с видимым текстом
    if (state.box) state.box.classList.add('is-ready');

    textarea.addEventListener('input', function () {
      updateCursorPosition();
      scheduleHighlight();
      scheduleDraftSave();
    });

    textarea.addEventListener('click', updateCursorPosition);
    textarea.addEventListener('keyup', updateCursorPosition);
    textarea.addEventListener('select', updateCursorPosition);

    textarea.addEventListener('keydown', function (e) {
      if (e.isComposing) return;

      // Ctrl+Enter — запустить проверку (как кнопка «Запустить и проверить»)
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        var runBtn = document.getElementById('runBtn');
        if (typeof runCode === 'function' && (!runBtn || !runBtn.disabled)) {
          runCode();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        duplicateLine(textarea);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '/' || e.code === 'Slash')) {
        e.preventDefault();
        toggleComment(textarea);
        return;
      }

      // Escape — выйти из редактора (Tab перехвачен, иначе не выбраться)
      if (e.key === 'Escape') {
        textarea.blur();
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Tab → отступ, Shift+Tab → снять отступ
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          shiftIndent(textarea, -1);
        } else {
          insertIndent(textarea);
        }
        return;
      }

      // Enter → автоотступ (Shift+Enter — обычный перевод строки)
      if (e.key === 'Enter' && !e.shiftKey) {
        autoIndentNewline(textarea, e);
        return;
      }

      if (handleAutoPair(textarea, e)) return;
      if (e.key === 'Backspace') handlePairBackspace(textarea, e);
    });

    // Прокрутка слоя подсветки следует за textarea
    textarea.addEventListener('scroll', function () {
      layer.scrollTop = textarea.scrollTop;
      layer.scrollLeft = textarea.scrollLeft;
    });

    textarea.addEventListener('paste', function () {
      setTimeout(function () {
        updateCursorPosition();
        scheduleHighlight();
        scheduleDraftSave();
      }, 0);
    });

    textarea.addEventListener('cut', function () {
      setTimeout(function () {
        updateCursorPosition();
        scheduleHighlight();
        scheduleDraftSave();
      }, 0);
    });

    // Ширина редактора влияет на переносы — перерисовываем слой
    if (resizeObserver) resizeObserver.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(function () {
        scheduleHighlight();
      });
      resizeObserver.observe(textarea);
    }

    // Глобальные слушатели навешиваем один раз на страницу
    if (!globalsBound) {
      globalsBound = true;

      document.addEventListener('selectionchange', function () {
        if (state && document.activeElement === state.textarea) {
          updateCursorPosition();
        }
      });

      window.addEventListener('pagehide', saveDraft);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') saveDraft();
      });

      if (typeof ResizeObserver === 'undefined') {
        window.addEventListener('resize', scheduleHighlight);
      }
    }
  }

  window.OgeCodeEditor = { init: init, flush: saveDraft };
})();
