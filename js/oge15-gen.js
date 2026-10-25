/*
 * Генератор случайных обстановок для задания 15 (исполнитель Робот).
 *
 * Идея: для каждого из 20 вариантов задания есть «семейство» допустимых
 * обстановок (та же топология стен, но другие длины/расположение). Геометрия
 * генерируется случайно, а эталон закраски вычисляется «оракулом» — эталонным
 * решением задания (files/oge15/oge-15-2026-NN.kum, см. js/oge15-ref.js),
 * которое прогоняется прямо на сгенерированной обстановке. Так эталон всегда
 * согласован с той же семантикой поля, что и программа ученика, и гарантированно
 * достижим.
 *
 * Модуль самодостаточен (кроме lex/Parser, которые передаются при init из
 * oge15.html) и пригоден для запуска в Node для проверок.
 */
(function (root) {
  'use strict';

  // ---- Детерминированный ГПСЧ (mulberry32) ----
  function makeRng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const ri = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));

  // ---- построение стен (1-based, формат файла обстановки) ----
  const hr = (r, c1, c2) => { const o = []; for (let c = c1; c <= c2; c++) o.push('h:' + r + ',' + c); return o; };
  const vr = (c, r1, r2) => { const o = []; for (let r = r1; r <= r2; r++) o.push('v:' + r + ',' + c); return o; };

  // ---- семейства геометрий ----
  // Варианты задания объединены в семейства с общей топологией стен:
  // 1/2 -> 1, 3/4 -> 3, 5/6/7/8 -> 5, 9/10 -> 9, 11/12 -> 11,
  // 13/14 -> 13, 15/16 -> 15, 17/18 -> 17, 19/20 -> 19.
  const FAMILY_OF_TASK = {
    1: 1, 2: 1, 3: 3, 4: 3, 5: 5, 6: 5, 7: 5, 8: 5, 9: 9, 10: 9,
    11: 11, 12: 11, 13: 13, 14: 13, 15: 15, 16: 15, 17: 17, 18: 17, 19: 19, 20: 19
  };

  // Каждая функция возвращает { rows, cols, walls, robot } (1-based).
  const FAMILIES = {
    // №1,2: две вертикальные стены и горизонтальная, соединяющая низ 1-й со 2-й.
    1: function (rng) {
      const rows = 14, cols = 14;
      const a = 3;                         // столбец 1-й вертикальной
      const d = a + 2 + ri(rng, 0, 3);     // столбец 2-й вертикальной
      const b2 = 3 + ri(rng, 1, 2);        // низ 1-й вертикальной
      const b1 = b2 - ri(rng, 1, 2);       // верх 1-й
      const e1 = b2 - ri(rng, 1, 2);       // верх 2-й (ниже верхнего конца 1-й — не важно)
      const e2 = Math.min(b2 + ri(rng, 3, 4), rows - 2);
      return {
        rows, cols,
        walls: [...vr(a, b1, b2), ...hr(b2, a + 1, d), ...vr(d, e1, e2)],
        robot: { row: e2, col: d }
      };
    },
    // №3,4: две горизонтальные и вертикальная между их левыми концами.
    3: function (rng) {
      const rows = 14, cols = 14;
      const a = 3;
      const b1 = 3;
      const len = ri(rng, 3, 5);
      const b2 = b1 + len - 1;
      const W = ri(rng, 3, 5);
      const m = b1 + ri(rng, 1, len - 2);
      return {
        rows, cols,
        walls: [...hr(b1 - 1, a + 1, a + W), ...vr(a, b1, b2), ...hr(b2 + 1, a + 1, a + W)],
        robot: { row: m, col: a + 1 }
      };
    },
    // №5..8: нижняя горизонтальная стена с разрывом и верхняя такой же длины над разрывом.
    5: function (rng) {
      const rows = 16, cols = 16;
      const w = ri(rng, 1, 2);                       // ширина разрыва
      const leftLen = ri(rng, 1, 3), rightLen = ri(rng, 1, 3);
      const total = w + leftLen + rightLen;
      const l1 = 2 + ri(rng, 0, 2);                  // начало нижней стены
      const gap = l1 + leftLen;                      // первый столбец разрыва
      const L = 10 + ri(rng, 0, 2);                  // ряд нижней стены
      const U = L - ri(rng, 3, 5);                   // ряд верхней стены
      const walls = [
        ...hr(L, l1, gap - 1),
        ...hr(L, gap + w, l1 + total - 1),
        ...hr(U, gap, gap + w - 1)
      ];
      const robotCol = gap + ri(rng, 0, w - 1);
      return { rows, cols, walls, robot: { row: U - 1, col: robotCol } };
    },
    // №9,10: две одинаковые стены-прямоугольники одна под другой.
    9: function (rng) {
      const rows = 16, cols = 16;
      const W = ri(rng, 4, 7);
      const H = 2;
      const a = 2 + ri(rng, 0, 1);
      const t1 = 2 + ri(rng, 0, 1);
      const gap = 1 + ri(rng, 0, 2);
      const t2 = t1 + H + gap;
      const rect = (t) => [
        ...hr(t - 1, a, a + W - 1),
        ...hr(t + H - 1, a, a + W - 1),
        ...vr(a - 1, t, t + H - 1),
        ...vr(a + W - 1, t, t + H - 1)
      ];
      return {
        rows, cols,
        walls: [...rect(t1), ...rect(t2)],
        robot: { row: t1 - 1, col: a + Math.floor(W / 2) }
      };
    },
    // №11,12: две одинаковые стены-прямоугольники рядом, на одном уровне.
    11: function (rng) {
      const rows = 14, cols = 16;
      const H = ri(rng, 3, 5);
      const W = 2;
      const a = 2;
      const t = 3;
      const gap = 2 + ri(rng, 0, 2);
      const b = a + W + gap;
      const rect = (l) => [
        ...hr(t - 1, l, l + W - 1),
        ...hr(t + H - 1, l, l + W - 1),
        ...vr(l - 1, t, t + H - 1),
        ...vr(l + W - 1, t, t + H - 1)
      ];
      return {
        rows, cols,
        walls: [...rect(a), ...rect(b)],
        robot: { row: t - 1, col: a + W - 1 }
      };
    },
    // №13,14: «П»-образная фигура: горизонтальная стена и две вертикальные вниз от её концов.
    13: function (rng) {
      const rows = 16, cols = 14;
      const a = 3;                       // столбец левой вертикальной
      const d = a + ri(rng, 4, 6);       // столбец правой вертикальной
      const t = 3;                       // верхний ряд (стена над ним)
      const lenL = ri(rng, 3, 5);
      const lenR = ri(rng, 4, 6);
      const robotRow = t + ri(rng, 1, Math.min(lenL, lenR) - 1);
      return {
        rows, cols,
        walls: [...vr(a, t, t + lenL - 1), ...hr(t - 1, a + 1, d), ...vr(d, t, t + lenR - 1)],
        robot: { row: robotRow, col: a + 1 + ri(rng, 0, d - a - 2) }
      };
    },
    // №15,16: Г-образная фигура, в обеих стенах по проходу.
    15: function (rng) {
      const rows = 16, cols = 14;
      const t = 3;
      const a = 2 + ri(rng, 0, 1);
      const W = 5 + ri(rng, 0, 2);                 // длина горизонтальной стены
      const b = a + W - 1;
      const pw = 1 + ri(rng, 0, 1);                // проход в горизонтальной стене
      const p1 = a + 1 + ri(rng, 0, W - pw - 2);
      const Vlen = 5 + ri(rng, 0, 2);
      const qw = 1 + ri(rng, 0, 1);                // проход в вертикальной стене
      const q1 = t + 1 + ri(rng, 0, Vlen - qw - 2);
      const hWall = [];
      for (let c = a; c <= b; c++) if (c < p1 || c >= p1 + pw) hWall.push('h:' + t + ',' + c);
      const vWall = [];
      for (let r = t + 1; r <= t + Vlen; r++) if (r < q1 || r >= q1 + qw) vWall.push('v:' + r + ',' + b);
      return {
        rows, cols,
        walls: [...hWall, ...vWall],
        robot: { row: t + 1, col: a }
      };
    },
    // №17,18: две горизонтальные стены равной длины и две вертикальные.
    17: function (rng) {
      const rows = 16, cols = 14;
      const a = 2 + ri(rng, 0, 1);
      const W = 5 + ri(rng, 0, 2);
      const b = a + W - 1;
      const t1 = 3;                                // верхняя горизонтальная
      const t2 = t1 + 3 + ri(rng, 0, 2);           // нижняя горизонтальная
      const upperVlen = 2 + ri(rng, 0, 1);         // верхняя вертикальная (вверх от правого края верхней)
      const lowerVlen = 3 + ri(rng, 0, 2);         // нижняя вертикальная (вниз от левого края нижней)
      const robotRow = t1 + 1 + ri(rng, 0, t2 - t1 - 2);
      const robotCol = a + 1 + ri(rng, 0, W - 2);
      return {
        rows, cols,
        walls: [
          ...hr(t1, a, b),
          ...vr(b, t1 - upperVlen + 1, t1),
          ...hr(t2, a, b),
          ...vr(a - 1, t2 + 1, t2 + lowerVlen)
        ],
        robot: { row: robotRow, col: robotCol }
      };
    },
    // №19,20: как 17/18, но нижняя вертикальная не доходит до верхней стены.
    19: function (rng) {
      const rows = 16, cols = 14;
      const a = 2 + ri(rng, 0, 1);
      const W = 5 + ri(rng, 0, 2);
      const b = a + W - 1;
      const t1 = 3;
      const t2 = t1 + 4 + ri(rng, 0, 2);
      const upperVlen = 2 + ri(rng, 0, 1);
      const lowerVlen = 2 + ri(rng, 0, Math.max(0, t2 - t1 - 2));
      const robotRow = t1 + 1 + ri(rng, 0, t2 - t1 - 2);
      const robotCol = a + 1 + ri(rng, 0, W - 2);
      return {
        rows, cols,
        walls: [
          ...hr(t1, a, b),
          ...vr(b, t1 - upperVlen + 1, t1),
          ...hr(t2, a, b),
          ...vr(a - 1, t2 - lowerVlen + 1, t2)
        ],
        robot: { row: robotRow, col: robotCol }
      };
    }
  };

  // ---- синхронное исполнение эталонной программы на обстановке ----
  function makeField(geo, fieldProto) {
    const f = Object.create(fieldProto);
    f.rows = geo.rows;
    f.cols = geo.cols;
    f.walls = new Set(geo.walls.map(function (k) {
      const parts = k.split(':');
      const rc = parts[1].split(',').map(Number);
      return parts[0] + ':' + (rc[0] - 1) + ',' + (rc[1] - 1);
    }));
    f.painted = new Set();
    f.robot = { row: geo.robot.row - 1, col: geo.robot.col - 1 };
    f.paintedByProgram = false;
    return f;
  }

  function evalCond(cond, f) {
    const dirMap = { 'сверху': 'up', 'снизу': 'down', 'слева': 'left', 'справа': 'right' };
    switch (cond.type) {
      case 'check': return f.isFree(f.robot.row, f.robot.col, dirMap[cond.value]);
      case 'wall': return !f.isFree(f.robot.row, f.robot.col, dirMap[cond.value]);
      case 'painted': return f.painted.has(f.robot.row + ',' + f.robot.col);
      case 'not': return !evalCond(cond.operand, f);
      case 'and': return evalCond(cond.left, f) && evalCond(cond.right, f);
      case 'or': return evalCond(cond.left, f) || evalCond(cond.right, f);
      default: return false;
    }
  }

  function runAst(ast, f, maxSteps) {
    let steps = 0;
    const dirMap = { 'вверх': 'up', 'вниз': 'down', 'влево': 'left', 'вправо': 'right' };
    function exec(stmt) {
      if (++steps > maxSteps) throw new Error('Превышено число шагов');
      if (stmt.type === 'command') {
        if (stmt.value === 'закрасить') { f.painted.add(f.robot.row + ',' + f.robot.col); f.paintedByProgram = true; }
        else { const r = f.moveRobot(dirMap[stmt.value]); if (r.error) throw new Error(r.error); }
      } else if (stmt.type === 'if') {
        if (evalCond(stmt.condition, f)) { for (const s of stmt.thenBody) exec(s); }
        else if (stmt.elseBody) { for (const s of stmt.elseBody) exec(s); }
      } else if (stmt.type === 'while') {
        while (evalCond(stmt.condition, f)) { for (const s of stmt.body) exec(s); }
      } else if (stmt.type === 'repeat') {
        for (let n = 0; n < stmt.count; n++) { for (const s of stmt.body) exec(s); }
      }
    }
    for (const s of ast) exec(s);
    return steps;
  }

  function OGE15Gen(deps) {
    const lex = deps.lex, Parser = deps.Parser, fieldProto = deps.fieldProto;
    const REF = (root.OGE15_REF) || {};

    function runReference(taskKey, geo) {
      const src = REF[taskKey];
      if (!src) throw new Error('Нет эталона для задания ' + taskKey);
      const ast = new Parser(lex(src)).parseProgram();
      const f = makeField(geo, fieldProto);
      runAst(ast, f, 100000);
      return {
        painted: [...f.painted].map(function (k) {
          const rc = k.split(',').map(Number);
          return (rc[0] + 1) + ',' + (rc[1] + 1);
        }),
        robot: { row: f.robot.row + 1, col: f.robot.col + 1 },
        steps: 0
      };
    }

    // Генерирует обстановку для taskId (1..20). Бросает, если не удалось
    // получить валидный вариант за разумное число попыток.
    function generate(taskId, rng) {
      const famId = FAMILY_OF_TASK[taskId];
      const fam = FAMILIES[famId];
      if (!fam) throw new Error('Нет генератора для задания ' + taskId);
      const key = String(taskId).padStart(2, '0');
      for (let attempt = 0; attempt < 200; attempt++) {
        const geo = fam(rng);
        try {
          const target = runReference(key, geo);
          if (!target.painted.length) continue;
          return {
            taskId: taskId,
            rows: geo.rows, cols: geo.cols,
            walls: geo.walls, robot: geo.robot,
            target: target.painted
          };
        } catch (e) { /* пробуем ещё раз */ }
      }
      throw new Error('Не удалось сгенерировать обстановку для задания ' + taskId);
    }

    function randomTaskId(rng) { return ri(rng, 1, 20); }

    return { generate: generate, randomTaskId: randomTaskId, runReference: runReference, families: FAMILIES };
  }

  root.OGE15Gen = { create: OGE15Gen, makeRng: makeRng };

  if (typeof module !== 'undefined' && module.exports) module.exports = root.OGE15Gen;
})(typeof window !== 'undefined' ? window : globalThis);
