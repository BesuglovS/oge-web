#!/usr/bin/env node
// Проверки данных и логики заданий:
//  1) задание 16 — каждое эталонное решение проходит все тесты;
//  2) задание 15 — .kum-эталоны совпадают с e-*.json, генератор строит
//     валидные обстановки;
//  3) задание 7 — структура data/oge7.json (oge7.txt удалён как легаси);
//  4) задание 12 — ответы совпадают с содержимым files/Задание11-12.zip.
// Запуск: node tools/check-data.mjs   (нужен python 3)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const errors = [];

function runPython(script, payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oge-check-'));
  const py = path.join(dir, 'check.py');
  const json = path.join(dir, 'data.json');
  fs.writeFileSync(py, script, 'utf8');
  fs.writeFileSync(json, JSON.stringify(payload), 'utf8');
  const r = spawnSync(python, ['-I', '-S', '-X', 'utf8', py, json], {
    encoding: 'utf8',
    timeout: 180000,
  });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error((r.stderr || '') + (r.stdout || ''));
  return JSON.parse(r.stdout.trim() || '[]');
}

function extractArray(html, marker) {
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('не найден фрагмент: ' + marker);
  const bracket = html.indexOf('[', start);
  const end = html.indexOf('\n      ];', bracket);
  if (bracket < 0 || end < 0) throw new Error('не найден конец массива: ' + marker);
  return vm.runInNewContext(html.slice(bracket, end + 8));
}

/* ─────────── 1. Задание 16 ─────────── */
try {
  const html = fs.readFileSync(path.join(root, 'oge16.html'), 'utf8');
  const tasks = extractArray(html, 'var tasks = [');
  const ids16 = tasks.map((t) => t.id);
  if (ids16.length !== 60) errors.push(`oge16: ожидалось 60 задач, найдено ${ids16.length}`);
  if (new Set(ids16).size !== ids16.length) errors.push('oge16: дублирующиеся id задач');
  const cases = [];
  for (const t of tasks) {
    if (String(t.testData.input) !== t.tests[0].input ||
        String(t.testData.expected) !== String(t.tests[0].expected)) {
      errors.push(`oge16 ${t.id}: testData не совпадает с tests[0]`);
    }
    t.tests.forEach((tc, j) => {
      cases.push({ id: t.id, j, input: tc.input, expected: tc.expected, code: t.solutionCode });
    });
  }
  const bad = runPython(`
import json, re, subprocess, sys
cases = json.load(open(sys.argv[1], encoding='utf-8'))
def norm(s):
    return re.sub(r'\\s+', ' ', s).strip()
bad = []
for c in cases:
    p = subprocess.run([sys.executable, '-I', '-S', '-X', 'utf8', '-c', c['code']],
                       input=c['input'].encode('utf-8'), capture_output=True, timeout=10)
    out = p.stdout.decode('utf-8', 'replace')
    err = p.stderr.decode('utf-8', 'replace').strip()
    if err:
        bad.append([c['id'], c['j'], 'stderr: ' + err.splitlines()[-1]])
    elif norm(out) != norm(str(c['expected'])):
        bad.append([c['id'], c['j'], 'got %r, expected %r' % (out, c['expected'])])
print(json.dumps(bad, ensure_ascii=False))
`, cases);
  for (const [id, j, msg] of bad) errors.push(`oge16 ${id} тест #${j + 1}: ${msg}`);
  console.log(`oge16: проверено ${cases.length} тестов`);
} catch (e) {
  errors.push('oge16: ' + e.message);
}

/* ─────────── 2. Задание 15 ─────────── */
try {
  const html = fs.readFileSync(path.join(root, 'oge15.html'), 'utf8');
  const slice = (from, to) => {
    const i = html.indexOf(from);
    const j = html.indexOf(to, i);
    if (i < 0 || j < 0) throw new Error('не найден фрагмент: ' + from);
    return html.slice(i, j);
  };
  const sb = { console };
  vm.createContext(sb);
  vm.runInContext(
    slice('function lex(code) {', 'class Parser {') + '\n' +
    slice('class Parser {', '// 5. INTERPRETER') + '\n' +
    slice('const field = {', '// 2. CANVAS RENDERER') + '\n' +
    '; globalThis.__lex = lex; globalThis.__Parser = Parser; globalThis.__field = field;',
    sb
  );
  const s2 = { console };
  s2.window = s2;
  s2.globalThis = s2;
  vm.createContext(s2);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/oge15-ref.js'), 'utf8'), s2);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/oge15-gen.js'), 'utf8'), s2);
  const gen = s2.OGE15Gen.create({ lex: sb.__lex, Parser: sb.__Parser, fieldProto: sb.__field });

  let checked = 0;
  for (let n = 1; n <= 20; n++) {
    const id = String(n).padStart(2, '0');
    const base = JSON.parse(fs.readFileSync(path.join(root, `files/oge15/oge-15-2026-${id}.json`), 'utf8'));
    const exp = JSON.parse(fs.readFileSync(path.join(root, `files/oge15/oge-15-2026-e-${id}.json`), 'utf8'));
    let res;
    try {
      res = gen.runReference(id, base);
    } catch (e) {
      errors.push(`oge15 ${id}: эталон не выполняется — ${e.message}`);
      continue;
    }
    const got = new Set(res.painted);
    const want = new Set(exp.painted);
    const missing = [...want].filter((k) => !got.has(k));
    const extra = [...got].filter((k) => !want.has(k));
    if (missing.length || extra.length) {
      errors.push(`oge15 ${id}: эталон не совпадает с e-${id}.json (нет: ${missing.join(' ') || '—'}; лишние: ${extra.join(' ') || '—'})`);
    }
    checked++;
  }
  console.log(`oge15: сверено ${checked} эталонов с e-*.json`);

  // tasks.json: ровно 20 заданий с id 1..20.
  const tasks15 = JSON.parse(fs.readFileSync(path.join(root, 'files/oge15/tasks.json'), 'utf8'));
  const ids15 = Array.isArray(tasks15) ? tasks15.map((t) => t.id).sort((a, b) => a - b) : [];
  const expectedIds = Array.from({ length: 20 }, (_, i) => i + 1);
  if (JSON.stringify(ids15) !== JSON.stringify(expectedIds)) {
    errors.push('oge15: tasks.json должен содержать 20 заданий с id 1..20');
  }

  // js/oge15-ref.js — автогенерация из .kum; иначе «оракул» генератора
  // расходится с эталонными решениями.
  const refSandbox = { window: {} };
  vm.createContext(refSandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/oge15-ref.js'), 'utf8'), refSandbox);
  const REF = refSandbox.window.OGE15_REF || {};
  for (let n = 1; n <= 20; n++) {
    const id = String(n).padStart(2, '0');
    const kumPath = path.join(root, `files/oge15/oge-15-2026-${id}.kum`);
    const buf = fs.readFileSync(kumPath);
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      errors.push(`oge15 ${id}.kum: не UTF-8`);
    }
    const kum = buf.toString('utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '');
    if (!REF[id]) {
      errors.push(`oge15-ref.js: нет эталона ${id}`);
    } else if (REF[id] !== kum) {
      errors.push(`oge15-ref.js: ${id} расходится с .kum — запустите node tools/gen-oge15-ref.mjs`);
    }
  }
  console.log('oge15: js/oge15-ref.js синхронен с 20 .kum');

  let variants = 0;
  for (let taskId = 1; taskId <= 20; taskId++) {
    for (let seed = 1; seed <= 25; seed++) {
      const rng = s2.OGE15Gen.makeRng(taskId * 100000 + seed);
      let v;
      try {
        v = gen.generate(taskId, rng);
      } catch (e) {
        errors.push(`oge15 генератор, задание ${taskId}, seed ${seed}: ${e.message}`);
        continue;
      }
      variants++;
      if (!v.target.length) errors.push(`oge15 генератор, задание ${taskId}, seed ${seed}: пустой эталон`);
      if (v.robot.row < 1 || v.robot.row > v.rows || v.robot.col < 1 || v.robot.col > v.cols) {
        errors.push(`oge15 генератор, задание ${taskId}, seed ${seed}: робот вне поля`);
      }
      for (const w of v.walls) {
        const [t, pos] = w.split(':');
        const [r, c] = pos.split(',').map(Number);
        if (!'hv'.includes(t) || r < 1 || r > v.rows || c < 1 || c > v.cols) {
          errors.push(`oge15 генератор, задание ${taskId}, seed ${seed}: стена вне поля (${w})`);
        }
      }
    }
  }
  console.log(`oge15: проверено ${variants} сгенерированных вариантов`);

  // Парсер КуМира: «нц для» в частом случае (переменная не используется в теле).
  const parseKum = (src) => new sb.__Parser(sb.__lex(src)).parseProgram();
  const firstRepeat = (src) => {
    const ast = parseKum(src);
    const found = [];
    const walk = (list) => {
      for (const s of list || []) {
        if (!s) continue;
        if (s.type === 'repeat') found.push(s);
        walk(s.body);
        walk(s.thenBody);
        walk(s.elseBody);
      }
    };
    walk(ast);
    return found[0];
  };
  const forCases = [
    ['нц для i от 1 до 3\n  вправо\nкц', 3],
    ['нц для i от 1 до 10 шаг 2\n  вниз\nкц', 5],
    ['нц для i от 5 до 1\n  влево\nкц', 0],
    ['нц для i от 3 до 1 шаг -1\n  вверх\nкц', 3],
    ['нц для счётчик от 0 до 0\n  закрасить\nкц', 1],
  ];
  for (const [src, want] of forCases) {
    try {
      const node = firstRepeat(src);
      if (!node) errors.push('oge15 парсер: «' + src.split('\n')[0] + '» не распознан как цикл');
      else if (node.count !== want) {
        errors.push(`oge15 парсер: «${src.split('\n')[0]}» — повторений ${node.count}, ожидалось ${want}`);
      }
    } catch (e) {
      errors.push('oge15 парсер: «' + src.split('\n')[0] + '» — ' + e.message);
    }
  }
  const forErrors = [
    ['нц для от 1 до 3\n  вправо\nкц', /«от»/],
    ['нц для i от 1 до 3\n  вправо i\nкц', /Переменная «i»/],
    ['нц для i от 1 до n\n  вправо\nкц', /числами/],
    ['нц для i от 1 до 3 шаг 0\n  вправо\nкц', /Шаг/],
    ['нц для i от -2 до -5 шаг -1\n  вправо i\nкц', /Переменная/],
  ];
  for (const [src, re] of forErrors) {
    let msg = null;
    try { parseKum(src); } catch (e) { msg = e.message; }
    if (!msg) errors.push('oge15 парсер: ожидалась ошибка для «' + src.split('\n')[0] + '»');
    else if (!re.test(msg)) errors.push('oge15 парсер: неожиданная ошибка «' + msg + '»');
  }
  console.log('oge15: парсер «нц для» проверен');
} catch (e) {
  errors.push('oge15: ' + e.message);
}

/* ─────────── 2b. Задание 6: ответы генератора ─────────── */
// Проверяем не «те же функции», а независимую семантику из условия задачи:
// для подсчётов — пересчёт по парам, для параметра A — минимальность /
// максимальность найденного A относительно условия программы.
try {
  const html = fs.readFileSync(path.join(root, 'oge6.html'), 'utf8');
  const from = html.indexOf('const taskGenerators = [');
  const to = html.indexOf('let currentTask = null;', from);
  if (from < 0 || to < 0) throw new Error('не найден блок генераторов');
  const sandbox = { Math, console };
  vm.createContext(sandbox);
  vm.runInContext(html.slice(from, to) + '\n; globalThis.__gens = taskGenerators;', sandbox);
  const gens = sandbox.__gens;

  const countYes = (task) => {
    const p = task.pairs;
    if (task.condition === 'mod') return p.filter((x) => x.s % task.divisor === x.t).length;
    if (task.condition === 'or') return p.filter((x) => Math.abs(x.s) < task.threshold || Math.abs(x.t) < task.threshold).length;
    if (task.condition === 'and') return p.filter((x) => x.s > task.thresholdS && x.t < task.thresholdT).length;
    throw new Error('неизвестное условие ' + task.condition);
  };
  const yesAt4 = (pairs, A) => pairs.filter((x) => x.s >= A && x.t < 1).length;
  const yesAt5 = (pairs, A) => pairs.filter((x) => x.s < A || x.t < A).length;

  let sixTasks = 0;
  for (const gen of gens) {
    for (let k = 0; k < 60; k++) {
      let task = null;
      for (let attempt = 0; attempt < 30 && !task; attempt++) task = gen.generate();
      if (!task) continue;
      sixTasks++;
      const label = `oge6 (${task.taskType}/${task.condition})`;

      if (!Array.isArray(task.pairs) || task.pairs.length !== 10) {
        errors.push(`${label}: ожидалось 10 пар, найдено ${task.pairs && task.pairs.length}`);
        continue;
      }
      for (const p of task.pairs) {
        if (!Number.isInteger(p.s) || !Number.isInteger(p.t)) errors.push(`${label}: нецелые данные (${p.s}, ${p.t})`);
      }

      if (task.taskType === 'count') {
        const yes = countYes(task);
        const want = task.countType === 'no' ? 10 - yes : yes;
        if (task.answer !== want) {
          errors.push(`${label}: ответ ${task.answer}, по условию ${want}`);
        }
        if (task.answer < 0 || task.answer > 10) errors.push(`${label}: ответ вне 0..10 (${task.answer})`);
      } else {
        const fn = task.condition === 'and' ? yesAt4 : yesAt5;
        const at = Number(task.answer);
        if (!Number.isInteger(at)) {
          errors.push(`${label}: ответ не целый (${task.answer})`);
          continue;
        }
        if (fn(task.pairs, at) !== task.targetYes) {
          errors.push(`${label}: при A=${at} YES ${fn(task.pairs, at)}, ожидалось ${task.targetYes}`);
        }
        if (task.findType === 'min') {
          if (fn(task.pairs, at - 1) === task.targetYes) {
            errors.push(`${label}: A=${at} не наименьшее (A=${at - 1} тоже подходит)`);
          }
        } else if (fn(task.pairs, at + 1) === task.targetYes) {
          errors.push(`${label}: A=${at} не наибольшее (A=${at + 1} тоже подходит)`);
        }
      }
    }
  }
  if (sixTasks === 0) errors.push('oge6: генератор не выдал ни одной задачи');
  console.log(`oge6: проверено ${sixTasks} сгенерированных задач (ответы сверены по условию)`);
} catch (e) {
  errors.push('oge6: ' + e.message);
}

/* ─────────── 2c. Задание 4: кратчайший путь ─────────── */
// Ответ проверяем «в лоб»: полный перебор простых путей, а не Дейкстра.
try {
  const html = fs.readFileSync(path.join(root, 'oge4.html'), 'utf8');
  const from = html.indexOf('const graphTemplates = [');
  const to = html.indexOf('function renderTask() {', from);
  if (from < 0 || to < 0) throw new Error('не найден блок генераторов');
  const sb = { Math, console, renderTask() {}, hideHintsAndSolution() {} };
  vm.createContext(sb);
  vm.runInContext(html.slice(from, to) + '\n; globalThis.__generateTask = generateTask; globalThis.__current = () => currentTask;', sb);

  const matrixOf = (task) => {
    const n = task.vertices.length;
    const m = Array.from({ length: n }, () => Array(n).fill(null));
    for (const e of task.edges) {
      const i = task.vertices.indexOf(e.from);
      const j = task.vertices.indexOf(e.to);
      m[i][j] = e.weight;
      m[j][i] = e.weight;
    }
    return m;
  };

  // Полный перебор простых путей: истинно минимальное расстояние.
  const brute = (m, s, e) => {
    const n = m.length;
    let best = Infinity;
    const used = new Set([s]);
    const dfs = (u, dist) => {
      if (u === e) { if (dist < best) best = dist; return; }
      for (let v = 0; v < n; v++) {
        if (m[u][v] === null || used.has(v)) continue;
        used.add(v);
        dfs(v, dist + m[u][v]);
        used.delete(v);
      }
    };
    dfs(s, 0);
    return best;
  };

  let fourTasks = 0;
  let withVia = 0;
  for (let k = 0; k < 150; k++) {
    sb.__generateTask();
    const task = sb.__current();
    if (!task) { errors.push('oge4: генератор не создал задачу'); continue; }
    fourTasks++;
    const m = matrixOf(task);
    const idx = (name) => task.vertices.indexOf(name);
    const s = idx(task.startVertex);
    const e = idx(task.endVertex);

    if (task.viaVertex) {
      withVia++;
      const v = idx(task.viaVertex);
      const want = brute(m, s, v) + brute(m, v, e);
      if (task.answer !== want) {
        errors.push(`oge4 (через ${task.viaVertex}): ответ ${task.answer}, перебор ${want}`);
      }
      if (task.answer <= 0 || !Number.isFinite(task.answer)) {
        errors.push(`oge4: некорректный ответ ${task.answer}`);
      }
      if (task.solutionPaths.pathsToVia.length === 0 || task.solutionPaths.pathsFromVia.length === 0) {
        errors.push('oge4: пустое решение для промежуточного пункта');
      }
      if (task.solutionPaths.bestToVia !== brute(m, s, v) ||
          task.solutionPaths.bestFromVia !== brute(m, v, e)) {
        errors.push(`oge4 (через ${task.viaVertex}): неверные расстояния в решении`);
      }
    } else {
      const want = brute(m, s, e);
      if (task.answer !== want) {
        errors.push(`oge4: ответ ${task.answer}, перебор ${want}`);
      }
      if (task.solutionPaths.bestDistance !== want) {
        errors.push(`oge4: bestDistance ${task.solutionPaths.bestDistance}, перебор ${want}`);
      }
      const best = task.solutionPaths.allPaths[0];
      if (!best || best.distance !== want) {
        errors.push('oge4: первый путь в решении не кратчайший');
      }
    }
  }
  console.log(`oge4: проверено ${fourTasks} задач перебором путей (из них с промежуточным пунктом: ${withVia})`);
} catch (e) {
  errors.push('oge4: ' + e.message);
}

/* ─────────── 2d. Задание 10: ответы по тексту задачи ─────────── */
// Ответ сверяется с тем, что видит ученик: числа вытаскиваются из текста
// задачи и переводятся в десятичную систему независимой реализацией.
try {
  const html = fs.readFileSync(path.join(root, 'oge10.html'), 'utf8');
  const from = html.indexOf('function toDecimal(numStr, base) {');
  const to = html.indexOf('function checkAnswer() {', from);
  if (from < 0 || to < 0) throw new Error('не найден блок генераторов');
  const sb = { Math, console };
  vm.createContext(sb);
  vm.runInContext(html.slice(from, to) + `
    ; globalThis.__gens = {
        convertToBinary: generateConvertToBinary,
        convertFromBinary: generateConvertFromBinary,
        arithmeticSimple: generateArithmeticSimple,
        arithmeticComplex: generateArithmeticComplex,
        compareSmallest: () => generateCompareTwo('smallest'),
        compareLargest: () => generateCompareTwo('largest'),
        maxEven: () => generateFindCondition('max', 'even'),
        minOdd: () => generateFindCondition('min', 'odd'),
        maxDiv: () => generateFindDivisible('max'),
        minDiv: () => generateFindDivisible('min'),
        maxPrime: () => generateFindPrime('max'),
        minPrime: () => generateFindPrime('min'),
        minBase: generateFindMinBase,
      };
    globalThis.__current = () => currentTask;
  `, sb);
  // Перехватываем разметку задачи вместо записи в DOM.
  vm.runInContext('renderTask = function (text) { globalThis.__text = text; };', sb);

  const toDec = (raw, base) => {
    let value = 0;
    for (const ch of String(raw)) {
      const digit = parseInt(ch, 36);
      if (!(digit >= 0 && digit < base)) throw new Error(`цифра ${ch} недопустима в системе ${base}`);
      value = value * base + digit;
    }
    return value;
  };
  const isPrimeNum = (n) => {
    if (n < 2) return false;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
    return true;
  };
  const numRe = /([0-9A-F]+)<span class="base">(\d+)<\/span>/g;
  const numsOf = (text) => [...text.matchAll(numRe)].map((m) => ({
    raw: m[1], base: Number(m[2]), value: toDec(m[1], m[2]),
  }));

  const checkOne = (name, label) => {
    const task = sb.__current();
    const text = sb.__text;
    if (!task || !text) { errors.push(`oge10 ${label}: задача не сгенерирована`); return false; }
    const answer = String(task.answer);
    const fail = (want) => errors.push(`oge10 ${label}: ответ ${answer}, по тексту ${want}`);

    if (/Сколько единиц содержит полученное число/.test(text)) {
      const m = text.match(/число <span class="highlight">(\d+)<\/span>/);
      const bin = Number(m[1]).toString(2);
      const want = String([...bin].filter((c) => c === '1').length);
      if (answer !== want) fail(want);
    } else if (/разряде десятков полученного числа/.test(text)) {
      const m = text.match(/<span class="highlight">([01]+)<\/span>/);
      const dec = String(toDec(m[1], 2));
      const want = dec.length >= 2 ? dec[dec.length - 2] : '0';
      if (answer !== want) fail(want);
    } else if (/Вычислите значение арифметического выражения/.test(text)) {
      const block = text.match(/<div class="numbers-list">([\s\S]*?)<\/div>/);
      const expr = block[1]
        .replace(numRe, (m, raw, base) => String(toDec(raw, base)))
        .replace(/<[^>]+>/g, '')
        .replace(/:/g, '/')
        .replace(/\s+/g, '');
      if (!/^[\d+\-*/().]+$/.test(expr)) { errors.push(`oge10 ${label}: неразобранное выражение «${expr}»`); return false; }
      const value = Function('"use strict";return (' + expr + ')')();
      if (Number(answer) !== value) fail(value);
    } else if (/найдите два (наименьших|наибольших)/.test(text)) {
      const nums = numsOf(text).map((n) => n.value);
      nums.sort((a, b) => a - b);
      const want = /наименьших/.test(text) ? nums[0] + nums[1] : nums[1] + nums[2];
      if (Number(answer) !== want) fail(want);
    } else if (/(чётное|нечётное) число/.test(text)) {
      // «нечётное» содержит «чётное» как подстроку — проверяем отрицание первым.
      const wantEven = !/нечётное/.test(text);
      const nums = numsOf(text).map((n) => n.value);
      const parts = nums.filter((n) => (n % 2 === 0) === wantEven);
      if (!parts.length) { errors.push(`oge10 ${label}: нет подходящих чисел`); return false; }
      const want = /максимальное/.test(text) ? Math.max(...parts) : Math.min(...parts);
      if (Number(answer) !== want) fail(want);
    } else if (/делящееся на <span class="highlight">(\d+)<\/span>/.test(text)) {
      const divisor = Number(text.match(/делящееся на <span class="highlight">(\d+)<\/span>/)[1]);
      const parts = numsOf(text).map((n) => n.value).filter((n) => n % divisor === 0);
      if (!parts.length) { errors.push(`oge10 ${label}: нет чисел, делящихся на ${divisor}`); return false; }
      const want = /максимальное/.test(text) ? Math.max(...parts) : Math.min(...parts);
      if (Number(answer) !== want) fail(want);
    } else if (/простое число/.test(text)) {
      const parts = numsOf(text).map((n) => n.value).filter(isPrimeNum);
      if (!parts.length) { errors.push(`oge10 ${label}: нет простых чисел`); return false; }
      const want = /максимальное/.test(text) ? Math.max(...parts) : Math.min(...parts);
      if (Number(answer) !== want) fail(want);
    } else if (/основанием n &gt; 1|основанием n > 1/.test(text)) {
      const m = text.match(/highlight">([0-9A-F]+)<sub>n<\/sub>/);
      const digits = m[1];
      const minBase = Math.max(...[...digits].map((c) => parseInt(c, 36))) + 1;
      if (minBase <= 1) { errors.push(`oge10 ${label}: неверное основание ${minBase}`); return false; }
      const want = toDec(digits, minBase);
      if (Number(answer) !== want) fail(want);
    } else {
      errors.push(`oge10 ${label}: неизвестный тип задачи`);
      return false;
    }
    return true;
  };

  let tenTasks = 0;
  for (const [name, gen] of Object.entries(sb.__gens)) {
    for (let k = 0; k < 40; k++) {
      sb.__text = null;
      gen();
      if (checkOne(name, name)) tenTasks++;
    }
  }
  console.log(`oge10: проверено ${tenTasks} задач (ответ пересчитан по тексту задания)`);
} catch (e) {
  errors.push('oge10: ' + e.message);
}

/* ─────────── 2e. Задание 3: высказывания о числе x ─────────── */
// Условие задачи разбирается из текста («x кратно 5», «x > 73», «НЕ», «ИЛИ»…)
// и превращается в независимый предикат. Ответ страницы сверяется с
// перебором по этому предикату, плюс проверяется экстремальность.
try {
  const html = fs.readFileSync(path.join(root, 'oge3.html'), 'utf8');
  const from = html.indexOf('const conditionTypes = {');
  const to = html.indexOf('function renderTask() {', from);
  const ansFrom = html.indexOf('function getCorrectAnswer() {', to);
  const ansTo = html.indexOf('function checkAnswer() {', ansFrom);
  if (from < 0 || to < 0 || ansFrom < 0 || ansTo < 0) throw new Error('не найден блок генераторов');
  const sb = { Math, console, renderTask() {}, hideHintsAndSolution() {} };
  vm.createContext(sb);
  vm.runInContext(
    html.slice(from, to) + '\n' + html.slice(ansFrom, ansTo) +
    '\n; globalThis.__generate = generateTask; globalThis.__current = () => currentTask; globalThis.__answer = getCorrectAnswer;',
    sb
  );

  const compileCondition = (text) => {
    let js = text;
    const repl = [
      [/\(x кратно (\d+)\)/g, '(x % $1 === 0)'],
      [/\(x > (\d+)\)/g, '(x > $1)'],
      [/\(x < (\d+)\)/g, '(x < $1)'],
      [/\(x ≤ (\d+)\)/g, '(x <= $1)'],
      [/\(x ≥ (\d+)\)/g, '(x >= $1)'],
      [/\(x чётное\)/g, '(x % 2 === 0)'],
      [/\(x нечётное\)/g, '(x % 2 !== 0)'],
      [/\(в записи числа x нет повторяющихся цифр\)/g, '(new Set(String(x)).size === String(x).length)'],
      [/НЕ/g, '!'],
      [/ИЛИ/g, '||'],
      [/И/g, '&&'],
    ];
    for (const [re, to2] of repl) js = js.replace(re, to2);
    if (/[\u0400-\u04FF]/.test(js)) throw new Error('неразобранное условие: ' + text);
    return Function('"use strict"; return function (x) { return (' + js + '); };')();
  };

  let threeTasks = 0;
  for (let k = 0; k < 200; k++) {
    sb.__generate();
    const task = sb.__current();
    if (!task) { errors.push('oge3: задача не сгенерирована'); continue; }
    threeTasks++;
    let pred;
    try {
      pred = compileCondition(task.condition);
    } catch (e) {
      errors.push('oge3: ' + e.message);
      continue;
    }
    const ok = (x) => (task.isTrue ? pred(x) : !pred(x));

    let want = null;
    if (task.findGreatest) {
      for (let x = 10000; x >= 1; x--) if (ok(x)) { want = x; break; }
    } else {
      for (let x = 1; x <= 10000; x++) if (ok(x)) { want = x; break; }
    }
    const pageAnswer = sb.__answer();
    if (want === null) {
      errors.push(`oge3: по условию «${task.condition}» нет решения`);
      continue;
    }
    if (pageAnswer !== want) {
      errors.push(`oge3: ответ ${pageAnswer}, по условию «${task.condition}» — ${want}`);
    }
    // Экстремальность: соседнее число уже не подходит.
    const neighbour = task.findGreatest ? want + 1 : want - 1;
    if (ok(neighbour)) {
      errors.push(`oge3: ${want} не ${task.findGreatest ? 'наибольшее' : 'наименьшее'} («${task.condition}»)`);
    }
  }
  console.log(`oge3: проверено ${threeTasks} задач (условие разобрано из текста, ответ — перебор)`);
} catch (e) {
  errors.push('oge3: ' + e.message);
}

/* ─────────── 2f. Задание 5: программы исполнителя Омега ─────────── */
// Программа из ответа прогоняется независимой реализацией команд:
// для «определи b» — проверяется, что при b из ответа получается endNum
// (и что такое b единственно), для «составь алгоритм» — что программа
// переводит startNum в endNum и укладывается в лимит команд.
try {
  const html = fs.readFileSync(path.join(root, 'oge5.html'), 'utf8');
  const from = html.indexOf('const taskGenerators = [');
  const to = html.indexOf('function renderTask() {', from);
  if (from < 0 || to < 0) throw new Error('не найден блок генераторов');
  const sb = { Math, console, renderTask() {}, hideHintsAndSolution() {} };
  vm.createContext(sb);
  vm.runInContext(
    html.slice(from, to) + '\n; globalThis.__generate = generateTask; globalThis.__current = () => currentTask;',
    sb
  );

  const squareLast = (n) => {
    const str = String(n);
    const d = Number(str[str.length - 1]);
    return Number(str.slice(0, -1) + String(d * d));
  };
  const apply = (task, ch, n, b) => {
    const [first, second] = task.commands;
    if (ch === '1') {
      if (first.includes('прибавь b')) return n + b;
      const m = first.match(/\d+/);
      return n + (m ? Number(m[0]) : 1);
    }
    if (ch !== '2') throw new Error('недопустимый номер команды «' + ch + '»');
    if (second.includes('возведи в квадрат последнюю цифру')) return squareLast(n);
    if (second.includes('возведи в квадрат')) return n * n;
    if (second.includes('припиши слева')) return Number(String(b) + String(n));
    const m = second.match(/\d+/);
    return n * (m ? Number(m[0]) : 2);
  };
  const run = (task, program, b) => {
    let n = task.startNum;
    for (const ch of program) n = apply(task, ch, n, b);
    return n;
  };

  let fiveTasks = 0;
  let algos = 0;
  for (let k = 0; k < 300; k++) {
    sb.__generate();
    const task = sb.__current();
    if (!task) { errors.push('oge5: задача не сгенерирована'); continue; }
    fiveTasks++;

    if (task.taskType === 'algorithm') {
      algos++;
      const program = String(task.answer);
      if (!/^[12]+$/.test(program)) { errors.push(`oge5: ответ-программа «${program}» содержит не 1/2`); continue; }
      if (program.length > task.maxCommands) {
        errors.push(`oge5: программа «${program}» длиннее ${task.maxCommands} команд`);
      }
      const got = (() => { try { return run(task, program, 0); } catch (e) { errors.push('oge5: ' + e.message); return null; } })();
      if (got !== null && got !== task.endNum) {
        errors.push(`oge5: программа «${program}» даёт ${got}, ожидалось ${task.endNum}`);
      }
    } else {
      const b = task.answer;
      if (!Number.isInteger(b) || b < 1) { errors.push(`oge5: b = ${b}`); continue; }
      if (run(task, task.program, b) !== task.endNum) {
        errors.push(`oge5: при b = ${b} программа ${task.program} не даёт ${task.endNum}`);
      }
      // Значение b должно определяться однозначно.
      const fits = [];
      for (let cand = 1; cand <= 9; cand++) {
        if (run(task, task.program, cand) === task.endNum) fits.push(cand);
      }
      if (fits.length !== 1) {
        errors.push(`oge5: b неоднозначно (${fits.join(', ') || 'нет решений'}) для программы ${task.program}`);
      }
    }
  }
  console.log(`oge5: проверено ${fiveTasks} задач (из них «составь алгоритм»: ${algos})`);
} catch (e) {
  errors.push('oge5: ' + e.message);
}

/* ─────────── 2g. Задание 1: размер текста в кодировке ─────────── */
// Из текста задачи берутся цена символа (бит/байт), изменение размера и
// список слов. Проверяется: (длина ответа + 2) × цена = изменение, ответ
// есть в списке, и других слов с такой же длиной нет.
try {
  const html = fs.readFileSync(path.join(root, 'oge1.html'), 'utf8');
  const from = html.indexOf('const encodings = [');
  const to = html.indexOf('function checkAnswer() {', from);
  if (from < 0 || to < 0) throw new Error('не найден блок генераторов');
  const sb = { Math, console, renderTask(t) { this.text = t; }, hideHintsAndSolution() {} };
  vm.createContext(sb);
  vm.runInContext(html.slice(from, to) + '\n; globalThis.__generate = generateTask; globalThis.__current = () => currentTask;', sb);
  vm.runInContext('renderTask = function (t) { globalThis.__text = t; };', sb);

  let oneTasks = 0;
  let checkedBits = 0;
  for (let k = 0; k < 250; k++) {
    sb.__text = null;
    sb.__generate();
    const task = sb.__current();
    const text = sb.__text;
    if (!task || !text) { errors.push('oge1: задача не сгенерирована'); continue; }
    oneTasks++;

    const bitsMatch = text.match(/каждый символ кодируется <span class="highlight">(\d+) битами<\/span>/);
    const deltaMatch = text.match(/оказался на <span class="highlight">(\d+) (бит|байт)/);
    const listMatch = text.match(/как ([^,«»]+(?:, [^,«»]+)*), известны многим/);
    if (!bitsMatch || !deltaMatch || !listMatch) {
      errors.push('oge1: не удалось разобрать текст задачи');
      continue;
    }
    const bits = Number(bitsMatch[1]);
    const delta = Number(deltaMatch[1]);
    const deltaUnit = deltaMatch[2];
    const items = listMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
    const answer = String(task.answer);

    // Цена одного символа в тех же единицах, что и изменение размера.
    const perChar = deltaUnit === 'бит' ? bits : bits / 8;
    if (!Number.isFinite(perChar) || perChar <= 0) {
      errors.push(`oge1: некорректная цена символа (${bits} бит, ${deltaUnit})`);
      continue;
    }
    if (deltaUnit === 'бит') checkedBits++;
    const charCount = delta / perChar;
    if (!Number.isInteger(charCount)) {
      errors.push(`oge1: изменение ${delta} ${deltaUnit} не кратно цене символа ${perChar}`);
      continue;
    }
    if (charCount !== answer.length + 2) {
      errors.push(`oge1: ${charCount} символов, а «${answer}» + «, » даёт ${answer.length + 2}`);
    }
    if (!items.includes(answer)) {
      errors.push(`oge1: ответа «${answer}» нет в списке (${items.join(', ')})`);
    }
    const sameLength = items.filter((it) => it !== answer && it.length === answer.length);
    if (sameLength.length) {
      errors.push(`oge1: ответ неоднозначен — «${sameLength.join('», «')}» такой же длины`);
    }
    if (task.unit !== deltaUnit) {
      errors.push(`oge1: единица в задаче (${task.unit}) и в тексте (${deltaUnit}) расходятся`);
    }
  }
  console.log(`oge1: проверено ${oneTasks} задач (в битах: ${checkedBits})`);
} catch (e) {
  errors.push('oge1: ' + e.message);
}

/* ─────────── 2h. Задание 2: расшифровка по таблице кодов ─────────── */
// Таблица кодов проверяется на условие Фано (прямое/обратное), а сообщение —
// на однозначность расшифровки: число разбиений на кодовые слова должно быть
// ровно 1, и оно обязано давать исходное слово.
try {
  const html = fs.readFileSync(path.join(root, 'oge2.html'), 'utf8');
  const from = html.indexOf('let answered = false;');
  const to = html.indexOf('function createInteractiveMessage(encoded) {', from);
  if (from < 0 || to < 0) throw new Error('не найден блок генератора');
  const el = () => ({
    className: '', style: {}, value: '', innerHTML: '', textContent: '',
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, focus() {}, appendChild() {}, append() {},
    querySelectorAll: () => [], children: [],
  });
  const ids = new Map();
  const documentStub = {
    getElementById(id) { if (!ids.has(id)) ids.set(id, el()); return ids.get(id); },
    createElement: el,
    querySelector: el,
    querySelectorAll: () => [],
    addEventListener() {},
    body: el(),
  };
  const sb = { Math, console, document: documentStub, createInteractiveMessage() {} };
  vm.createContext(sb);
  vm.runInContext(html.slice(from, to) + '\n; globalThis.__generate = generateTask; globalThis.__current = () => currentTask;', sb);

  let twoTasks = 0;
  let direct = 0;
  for (let k = 0; k < 200; k++) {
    sb.__generate();
    const task = sb.__current();
    if (!task) { errors.push('oge2: задача не сгенерирована'); continue; }
    twoTasks++;
    const entries = Object.entries(task.codes);
    if (!entries.length) { errors.push('oge2: пустая таблица кодов'); continue; }

    // Условие Фано, заявленное в задаче.
    if (task.fanoType === 'direct') {
      direct++;
      for (const [a, ca] of entries) {
        for (const [b, cb] of entries) {
          if (a !== b && cb.startsWith(ca)) {
            errors.push(`oge2: прямое условие Фано нарушено (${a}=${ca} — начало ${b}=${cb})`);
          }
        }
      }
    } else {
      for (const [a, ca] of entries) {
        for (const [b, cb] of entries) {
          if (a !== b && cb.endsWith(ca)) {
            errors.push(`oge2: обратное условие Фано нарушено (${a}=${ca} — конец ${b}=${cb})`);
          }
        }
      }
    }

    // Сообщение должно быть кодом слова.
    const expected = [...String(task.word)].map((ch) => task.codes[ch]).join('');
    if (expected !== task.encoded) {
      errors.push(`oge2: шифрограмма ${task.encoded} не соответствует слову «${task.word}»`);
    }
    if (!/^[01]+$/.test(task.encoded)) {
      const alphabet = new Set(task.symbols || []);
      const bad = [...task.encoded].filter((ch) => !alphabet.has(ch));
      if (!alphabet.size || bad.length) {
        errors.push(`oge2: шифрограмма содержит символы вне алфавита (${task.encoded})`);
      }
    }

    // Однозначность расшифровки: ровно одно разбиение на кодовые слова.
    const codeValues = entries.map(([, c]) => c);
    const msg = task.encoded;
    const memo = new Map();
    const countWays = (pos) => {
      if (pos === msg.length) return 1;
      if (memo.has(pos)) return memo.get(pos);
      let total = 0;
      for (const c of codeValues) if (msg.startsWith(c, pos)) total += countWays(pos + c.length);
      memo.set(pos, total);
      return total;
    };
    const ways = countWays(0);
    if (ways !== 1) {
      errors.push(`oge2: у шифрограммы ${msg} ${ways} расшифровок (ожидалась одна)`);
    }
  }
  console.log(`oge2: проверено ${twoTasks} задач (прямое условие Фано: ${direct}), расшифровка однозначна`);
} catch (e) {
  errors.push('oge2: ' + e.message);
}

/* ─────────── 2i. Задание 9: количество путей в графе ─────────── */
// Ответ сверяется с полным перебором всех путей в графе (DFS), включая
// варианты «через вершину» и «не через вершину».
try {
  const html = fs.readFileSync(path.join(root, 'oge9.html'), 'utf8');
  const from = html.indexOf('const VERTEX_NAMES = [');
  const to = html.indexOf('function calculateVertexPositions(', from);
  if (from < 0 || to < 0) throw new Error('не найден блок генератора');
  const sb = { Math, console, renderTask() {}, hideHintsAndSolution() {} };
  vm.createContext(sb);
  vm.runInContext(
    html.slice(from, to) + '\n; globalThis.__generate = generateTask; globalThis.__current = () => currentTask;',
    sb
  );

  const countPaths = (edges, n, through) => {
    let total = 0;
    const seen = new Set([0]);
    const dfs = (u, passed) => {
      if (u === n - 1) { if (through < 0 || passed) total++; return; }
      for (let v = 1; v < n; v++) {
        if (!edges[u][v] || seen.has(v)) continue;
        seen.add(v);
        dfs(v, passed || v === through);
        seen.delete(v);
      }
    };
    dfs(0, through === 0);
    return total;
  };

  let nineTasks = 0;
  let throughTasks = 0;
  for (let k = 0; k < 200; k++) {
    sb.__generate();
    const task = sb.__current();
    if (!task) { errors.push('oge9: задача не сгенерирована'); continue; }
    nineTasks++;
    const n = task.graph.vertexCount;
    const edges = task.graph.edges;
    const total = countPaths(edges, n, -1);
    if (total !== task.paths[n - 1]) {
      errors.push(`oge9: путей ${total}, в задаче ${task.paths[n - 1]}`);
    }
    if (task.throughIndex >= 0) {
      throughTasks++;
      const via = countPaths(edges, n, task.throughIndex);
      const want = task.typeClass === 'through' ? via : total - via;
      if (task.answer !== want) {
        errors.push(`oge9 (${task.typeClass}): ответ ${task.answer}, перебор ${want}`);
      }
      if (task.answer < 1) errors.push(`oge9: вырожденный ответ ${task.answer}`);
    } else if (task.answer !== total) {
      errors.push(`oge9 (всего): ответ ${task.answer}, перебор ${total}`);
    }
    if (!task.graph.layers.flat().every((v) => Number.isInteger(v))) {
      errors.push('oge9: в слоях графа нецелые вершины');
    }
  }
  console.log(`oge9: проверено ${nineTasks} графов (из них через/не через вершину: ${throughTasks})`);
} catch (e) {
  errors.push('oge9: ' + e.message);
}

/* ─────────── 2j. Задание 8: формула включений-исключений ─────────── */
// Каждый тип задачи сверяется по формуле включений-исключений, а запросы
// разбираются из данных задачи (имена множеств произвольные).
try {
  const html = fs.readFileSync(path.join(root, 'oge8.html'), 'utf8');
  const from = html.indexOf('const setNames = {');
  const to = html.indexOf('function randomInt(min, max) {', from);
  const end = html.indexOf('function generateTask() {', to);
  if (from < 0 || to < 0 || end < 0) throw new Error('не найден блок генераторов');
  const sb = { Math, console };
  vm.createContext(sb);
  vm.runInContext(
    html.slice(from, end) + '\n; globalThis.__types = taskTypes; globalThis.__sets = allSets;',
    sb
  );

  const roles = (data) => {
    const out = { single: [], pairAnd: [], pairOr: [], tripleAnd: [], tripleOr: [], andOr: [] };
    for (const { query, value } of data) {
      let m;
      if ((m = query.match(/^([^&|()]+) & \(([^&|()]+) \| ([^&|()]+)\)$/))) out.andOr.push({ a: m[1], b: m[2], c: m[3], value });
      else if ((m = query.match(/^([^&|()]+) & ([^&|()]+) & ([^&|()]+)$/))) out.tripleAnd.push({ a: m[1], b: m[2], c: m[3], value });
      else if ((m = query.match(/^([^&|()]+) \| ([^&|()]+) \| ([^&|()]+)$/))) out.tripleOr.push({ a: m[1], b: m[2], c: m[3], value });
      else if ((m = query.match(/^([^&|()]+) & ([^&|()]+)$/))) out.pairAnd.push({ a: m[1], b: m[2], value });
      else if ((m = query.match(/^([^&|()]+) \| ([^&|()]+)$/))) out.pairOr.push({ a: m[1], b: m[2], value });
      else if ((m = query.match(/^([^&|()]+)$/))) out.single.push({ a: m[1], value });
      else throw new Error('неразобранный запрос: ' + query);
    }
    return out;
  };

  let eightTasks = 0;
  const typesSeen = new Set();
  for (const [typeName, type] of Object.entries(sb.__types)) {
    for (let k = 0; k < 60; k++) {
      const sets = sb.__sets[k % sb.__sets.length];
      const task = type.generate(sets);
      typesSeen.add(typeName);
      eightTasks++;
      const r = roles(task.data);
      const single = (name) => {
        const hit = r.single.filter((s) => s.a === name);
        if (!hit.length) throw new Error(`нет значения для «${name}»`);
        return hit[0].value;
      };
      let want = null;
      if (typeName === 'intersection2') {
        want = single(r.single[0].a) + single(r.single[1].a) - r.pairOr[0].value;
      } else if (typeName === 'union2') {
        want = single(r.single[0].a) + single(r.single[1].a) - r.pairAnd[0].value;
      } else if (typeName === 'intersection3') {
        const u = r.tripleOr[0].value;
        want = u - single(r.single[0].a) - single(r.single[1].a) - single(r.single[2].a)
          + r.pairAnd[0].value + r.pairAnd[1].value + r.pairAnd[2].value;
      } else if (typeName === 'union3') {
        want = single(r.single[0].a) + single(r.single[1].a) + single(r.single[2].a)
          - r.pairAnd[0].value - r.pairAnd[1].value - r.pairAnd[2].value
          + r.tripleAnd[0].value;
      } else if (typeName === 'formulaABorC') {
        want = r.andOr[0].value - r.pairAnd[0].value + r.tripleAnd[0].value;
      } else {
        errors.push(`oge8: неизвестный тип ${typeName}`);
        continue;
      }
      if (task.answer !== want) {
        errors.push(`oge8 (${typeName}): ответ ${task.answer}, по формуле ${want}`);
      }
      if (!(task.answer >= 0)) errors.push(`oge8 (${typeName}): отрицательный ответ ${task.answer}`);
      // Ответ не должен встречаться в данных задачи.
      if (task.data.some((d) => d.query === task.question)) {
        errors.push(`oge8 (${typeName}): искомый запрос уже есть в данных`);
      }
    }
  }
  console.log(`oge8: проверено ${eightTasks} задач (${[...typesSeen].length} типов) по формуле включений-исключений`);
} catch (e) {
  errors.push('oge8: ' + e.message);
}

/* ─────────── 2k. Задание 7: сборка URL ─────────── */
// Проверяется, что «правильный ответ» собирается из полей задачи
// (протокол, домен, каталоги, файл), является корректным URL и что в
// тексте задания упомянуты те же протокол, домен, каталог и файл.
try {
  const html = fs.readFileSync(path.join(root, 'oge7.html'), 'utf8');
  const from = html.indexOf('function generateSimpleTask(domains, files) {');
  const to = html.indexOf('function renderTask() {', from);
  if (from < 0 || to < 0) throw new Error('не найден блок генераторов');
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data/oge7.json'), 'utf8'));
  const sb = {
    Math, console,
    protocols: data.protocols,
    currentTask: null,
  };
  vm.createContext(sb);
  vm.runInContext(html.slice(from, to) + `
    ; globalThis.__simple = generateSimpleTask;
    globalThis.__withPath = generateWithPathTask;
    globalThis.__deepPath = generateDeepPathTask;
  `, sb);

  let sevenTasks = 0;
  const variants = [
    ['simple', () => sb.__simple(data.domainsLatin, data.filesLatin)],
    ['withPath', () => sb.__withPath(data.domainsLatin, data.pathsLatin, data.filesLatin)],
    ['deepPath', () => sb.__deepPath(data.domainsLatin, data.pathsLatin, data.filesLatin)],
    ['simple-cyr', () => sb.__simple(data.domainsCyrillic, data.filesCyrillic)],
    ['withPath-cyr', () => sb.__withPath(data.domainsCyrillic, data.pathsCyrillic, data.filesCyrillic)],
  ];
  for (const [label, gen] of variants) {
    for (let k = 0; k < 60; k++) {
      const task = gen();
      sevenTasks++;
      if (!task) { errors.push(`oge7 ${label}: задача не создана`); continue; }
      const path = (task.pathParts || []).map((p) => '/' + p).join('');
      const want = `${task.protocol}://${task.domain}${path}/${task.file}`;
      if (task.correctUrl !== want) {
        errors.push(`oge7 ${label}: URL «${task.correctUrl}», из полей — «${want}»`);
      }
      const cyrillic = /[\u0400-\u04FF]/.test(task.correctUrl);
      if (!cyrillic) {
        try {
          const url = new URL(task.correctUrl);
          if (url.protocol !== task.protocol + ':') errors.push(`oge7 ${label}: протокол URL ${url.protocol}`);
          if (url.hostname !== task.domain) errors.push(`oge7 ${label}: хост URL ${url.hostname} ≠ ${task.domain}`);
          if (!url.pathname.endsWith('/' + task.file)) errors.push(`oge7 ${label}: файл не в пути URL`);
        } catch (e) {
          errors.push(`oge7 ${label}: URL не разбирается (${task.correctUrl})`);
        }
      }
      for (const [what, value] of [['протокол', task.protocol], ['домен', task.domain], ['файл', task.file]]) {
        if (!task.text.includes(value)) errors.push(`oge7 ${label}: в тексте нет ${what} «${value}»`);
      }
      for (const part of task.pathParts || []) {
        if (!task.text.includes(part)) errors.push(`oge7 ${label}: в тексте нет каталога «${part}»`);
      }
      if (!data.protocols.includes(task.protocol)) errors.push(`oge7 ${label}: протокол вне списка`);
    }
  }
  console.log(`oge7: проверено ${sevenTasks} URL (5 вариантов, латиница и кириллица)`);
} catch (e) {
  errors.push('oge7: ' + e.message);
}

/* ─────────── 3. Задание 7: структура данных ─────────── */
// oge7.txt был легаси-копией данных (его никто не загружал) и удалён —
// единственный источник теперь data/oge7.json.
try {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data/oge7.json'), 'utf8'));
  const keys = ['protocols', 'domainsCyrillic', 'domainsLatin', 'pathsCyrillic', 'pathsLatin', 'filesCyrillic', 'filesLatin'];
  for (const key of keys) {
    if (!Array.isArray(data[key]) || data[key].length === 0) {
      errors.push(`oge7: ${key} отсутствует или пуст`);
      continue;
    }
    if (data[key].some((v) => typeof v !== 'string' || !v.trim())) {
      errors.push(`oge7: ${key} содержит нестроковые/пустые значения`);
    }
    if (new Set(data[key]).size !== data[key].length) {
      errors.push(`oge7: ${key} содержит дубликаты`);
    }
  }
  if (Array.isArray(data.protocols) && !data.protocols.every((p) => /^[a-z]+$/.test(p))) {
    errors.push('oge7: протоколы должны быть латиницей в нижнем регистре');
  }
  console.log(`oge7: data/oge7.json корректен (${keys.length} списков)`);
} catch (e) {
  errors.push('oge7: ' + e.message);
}

/* ─────────── 4. Задание 12 ─────────── */
try {
  const html = fs.readFileSync(path.join(root, 'oge12.html'), 'utf8');
  const tasks = extractArray(html, 'const tasks = [');
  if (tasks.length !== 20) errors.push(`oge12: ожидалось 20 задач, найдено ${tasks.length}`);
  if (new Set(tasks.map((t) => t.id)).size !== tasks.length) errors.push('oge12: дублирующиеся id задач');
  const zipPath = path.join(root, 'files/Задание11-12.zip');
  const bad = runPython(`
import json, os, re, sys, zipfile

payload = json.load(open(sys.argv[1], encoding='utf-8'))
z = zipfile.ZipFile(payload['zip'])

def fix(name):
    try:
        return name.encode('cp437').decode('utf-8')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return name

# Архив должен хранить кириллические имена с флагом UTF-8 (bit 11), иначе
# Проводник/Expand-Archive показывают кракозябры.
no_flag = [i.filename for i in z.infolist()
           if not (i.flag_bits & 0x800)
           and any(ord(ch) > 127 for ch in i.filename)]
if no_flag:
    print(json.dumps([['zip', 'имена без флага UTF-8: %d (например, %r)' % (len(no_flag), no_flag[0])]], ensure_ascii=False))
    sys.exit(0)

names = [fix(i.filename) for i in z.infolist() if not i.is_dir()]
sizes = {}
for i in z.infolist():
    if not i.is_dir():
        sizes[fix(i.filename)] = i.file_size

bad = []
for t in payload['tasks']:
    text = t['text']
    m = re.search(r'каталога <strong>([^<]+)</strong>', text)
    if not m:
        continue
    cat = m.group(1).strip()
    subs = None
    sm = re.search(r'в подкаталогах <strong>([^<]+)</strong> каталога', text)
    if sm:
        subs = {s.strip() for s in sm.group(1).split(',')}
    exts = {'.' + e for e in re.findall(r'class="code">\\.([a-z0-9]+)<', text)}
    gt = lt = None
    bm = re.search(r'более (\\d+) Кбайт', text)
    if bm:
        gt = int(bm.group(1))
    nm = re.search(r'менее (\\d+) Кбайт', text)
    if nm:
        lt = int(nm.group(1))

    count = 0
    for name in names:
        if not name.startswith(cat + '/'):
            continue
        rel = name[len(cat) + 1:]
        top = rel.split('/')[0]
        if subs and top not in subs:
            continue
        if exts and os.path.splitext(name)[1].lower() not in exts:
            continue
        size = sizes.get(name, 0)
        if gt is not None and not size > gt * 1024:
            continue
        if lt is not None and not size < lt * 1024:
            continue
        count += 1
    if str(count) != str(t['answer']):
        bad.append([t['id'], 'вычислено %d, указано %s' % (count, t['answer'])])
print(json.dumps(bad, ensure_ascii=False))
`, { zip: zipPath, tasks });
  for (const [id, msg] of bad) errors.push(`oge12 задача ${id}: ${msg}`);
  console.log(`oge12: проверено ${tasks.length} ответов по архиву`);
} catch (e) {
  errors.push('oge12: ' + e.message);
}

/* ─────────── 4b. Задание 14: данные таблиц и ответы ─────────── */
try {
  const html = fs.readFileSync(path.join(root, 'oge14.html'), 'utf8');
  const sheets14 = extractArray(html, 'const sheets = [');
  const tasks14 = extractArray(html, 'const tasks = [');
  const byId = new Map(sheets14.map((s) => [s.id, s]));

  // Таблицы: строки совпадают с заголовками, есть и текст, и числа.
  for (const s of sheets14) {
    if (!Array.isArray(s.headers) || !s.headers.length) errors.push(`oge14: у листа ${s.id} нет заголовков`);
    for (const [i, row] of s.rows.entries()) {
      if (row.length !== s.headers.length) errors.push(`oge14 ${s.id}: строка ${i + 1} длиной ${row.length}, ожидалось ${s.headers.length}`);
      for (const v of row) {
        if (typeof v !== 'number' && typeof v !== 'string') errors.push(`oge14 ${s.id}: недопустимое значение ${JSON.stringify(v)}`);
      }
    }
  }

  const numbersIn = (sheet, col, from, to) => {
    const out = [];
    for (let r = from; r <= to; r++) {
      const v = sheet.rows[r] && sheet.rows[r][col];
      if (typeof v === 'number') out.push(v);
    }
    return out;
  };
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const cmp = (a, op, b) => {
    if (op === '=') return a === b;
    if (op === '<>') return a !== b;
    if (op === '<') return a < b;
    if (op === '>') return a > b;
    if (op === '<=') return a <= b;
    if (op === '>=') return a >= b;
    throw new Error('неизвестный оператор ' + op);
  };
  const matches14 = (sheet, chk, v) => {
    const op = chk.op;
    const val = chk.val;
    if (val && typeof val === 'object' && 'avgOf' in val) {
      return typeof v === 'number' && cmp(v, op, mean(numbersIn(sheet, val.avgOf, chk.from, chk.to)));
    }
    if (typeof val === 'number') return typeof v === 'number' && cmp(v, op, val);
    return typeof v === 'string' && cmp(v.toLowerCase(), op, String(val).toLowerCase());
  };
  const round14 = (x, digits) => {
    const f = Math.pow(10, digits);
    return (x < 0 ? -Math.round(-x * f) : Math.round(x * f)) / f;
  };

  const ids14 = new Set();
  for (const t of tasks14) {
    if (ids14.has(t.id)) errors.push(`oge14: дублирующийся id ${t.id}`);
    ids14.add(t.id);
    if (!byId.has(t.sheet)) { errors.push(`oge14 ${t.id}: нет листа ${t.sheet}`); continue; }
    if (typeof t.answer !== 'number' || !isFinite(t.answer)) { errors.push(`oge14 ${t.id}: ответ не число`); continue; }
    if (typeof t.formula !== 'string' || t.formula[0] !== '=') errors.push(`oge14 ${t.id}: нет эталонной формулы`);
    if (!Array.isArray(t.solution) || !t.solution.length) errors.push(`oge14 ${t.id}: нет решения`);
    if (typeof t.hint !== 'string' || !t.hint) errors.push(`oge14 ${t.id}: нет подсказки`);
    const c = t.check;
    if (!c || !c.kind) { errors.push(`oge14 ${t.id}: нет описания check`); continue; }
    const sheet = byId.get(t.sheet);
    let got;
    if (c.kind === 'countif') {
      got = 0;
      for (let r = c.from; r <= c.to; r++) {
        if (matches14(sheet, c, sheet.rows[r][c.col])) got++;
      }
    } else if (c.kind === 'sumif') {
      got = 0;
      for (let r = c.from; r <= c.to; r++) {
        if (!matches14(sheet, c, sheet.rows[r][c.col])) continue;
        const v = sheet.rows[r][c.sumCol];
        if (typeof v === 'number') got += v;
      }
    } else if (c.kind === 'sumproduct') {
      got = 0;
      for (let r = c.from; r <= c.to; r++) got += sheet.rows[r][c.c1] * sheet.rows[r][c.c2];
    } else if (c.kind === 'max') {
      got = Math.max(...numbersIn(sheet, c.col, c.from, c.to));
    } else if (c.kind === 'roundavg') {
      got = round14(mean(numbersIn(sheet, c.col, c.from, c.to)), c.digits);
    } else {
      errors.push(`oge14 ${t.id}: неизвестный тип check ${c.kind}`);
      continue;
    }
    if (Math.abs(got - t.answer) > 1e-6) {
      errors.push(`oge14 ${t.id}: независимый пересчёт ${got}, в задаче ${t.answer}`);
    }
  }
  if (tasks14.length < 20) errors.push(`oge14: задач ${tasks14.length}, ожидалось не менее 20`);
  console.log(`oge14: проверено ${tasks14.length} ответов по ${sheets14.length} таблицам`);
} catch (e) {
  errors.push('oge14: ' + e.message);
}

/* ─────────── 4b-2. Задание 14: 20 вариантов формата ОГЭ ─────────── */
try {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data/oge14-exam.json'), 'utf8'));
  const expectedRows = { museum: 330, physics: 266, applicants: 208, school: 272, shop: 315 };

  for (const [id, ds] of Object.entries(data.datasets || {})) {
    if (!Array.isArray(ds.headers) || !ds.headers.length) errors.push(`oge14 (ОГЭ) ${id}: нет заголовков`);
    if (expectedRows[id] !== ds.rows.length) {
      errors.push(`oge14 (ОГЭ) ${id}: строк ${ds.rows.length}, ожидалось ${expectedRows[id]}`);
    }
    for (const [i, row] of ds.rows.entries()) {
      if (row.length !== ds.headers.length) {
        errors.push(`oge14 (ОГЭ) ${id}: строка ${i + 1} длиной ${row.length}, ожидалось ${ds.headers.length}`);
      }
      for (const value of row) {
        if (typeof value !== 'number' && typeof value !== 'string') {
          errors.push(`oge14 (ОГЭ) ${id}: недопустимое значение ${JSON.stringify(value)}`);
        }
      }
    }
  }

  const cmp = (a, op, b) => {
    if (op === '=') return a === b;
    if (op === '<>') return a !== b;
    if (op === '<') return a < b;
    if (op === '>') return a > b;
    if (op === '<=') return a <= b;
    if (op === '>=') return a >= b;
    throw new Error('неизвестный оператор ' + op);
  };
  const match = (value, op, val) => {
    if (typeof val === 'number') return typeof value === 'number' && cmp(value, op, val);
    return typeof value === 'string' && cmp(value.toLowerCase(), op, String(val).toLowerCase());
  };
  const where = (rows, conds) => rows.filter((row) => conds.every((c) => match(row[c.col], c.op, c.val)));
  const round = (x, digits) => {
    const f = Math.pow(10, digits);
    return Math.round((x + (x >= 0 ? 1e-9 : -1e-9)) * f) / f;
  };
  const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const compute = (rows, spec) => {
    const conds = spec.conds || [];
    switch (spec.kind) {
      case 'sum':
        return where(rows, conds).reduce((s, row) => s + (typeof row[spec.col] === 'number' ? row[spec.col] : 0), 0);
      case 'count':
        return where(rows, conds).length;
      case 'countany':
        return rows.filter((row) => spec.cols.some((col) => match(row[col], spec.op, spec.val))).length;
      case 'countor':
        return rows.filter((row) => spec.groups.some((group) => group.every((c) => match(row[c.col], c.op, c.val)))).length;
      case 'countsum': {
        const a = spec.cols[0];
        const b = spec.cols[1];
        return rows.filter((row) => conds.every((c) => cmp(row[a] + row[b], c.op, c.val))).length;
      }
      case 'maxdiff':
        return Math.max(...rows.map((row) => row[spec.a] - row[spec.b]));
      case 'mindiff':
        return Math.min(...rows.map((row) => row[spec.a] - row[spec.b]));
      case 'maxsum':
        return Math.max(...rows.map((row) => row[spec.a] + row[spec.b]));
      case 'minsum':
        return Math.min(...rows.map((row) => row[spec.a] + row[spec.b]));
      case 'maxmin': {
        const xs = rows.map((row) => row[spec.col]).filter((v) => typeof v === 'number');
        return Math.max(...xs) - Math.min(...xs);
      }
      case 'avg':
        return round(mean(where(rows, conds).map((row) => row[spec.col]).filter((v) => typeof v === 'number')), spec.digits);
      case 'avgsum': {
        const xs = where(rows, conds).map((row) => row[spec.cols[0]] + row[spec.cols[1]]);
        return round(mean(xs), spec.digits);
      }
      case 'avgsum_not': {
        const ex = spec.exclude;
        const xs = rows.filter((row) => row[ex.col] !== ex.val)
          .map((row) => row[spec.cols[0]] + row[spec.cols[1]]);
        return round(mean(xs), spec.digits);
      }
      case 'avgdiff':
        return round(mean(where(rows, conds).map((row) => row[spec.a] - row[spec.b])), spec.digits);
      case 'percent':
        return round(where(rows, conds).length / rows.length * 100, spec.digits);
      case 'percent_gt':
        return round(rows.filter((row) => row[spec.cols[0]] > row[spec.cols[1]] && row[spec.cols[1]] >= spec.min).length / rows.length * 100, spec.digits);
      default:
        throw new Error('неизвестный тип проверки ' + spec.kind);
    }
  };

  const ids = new Set();
  const families = new Map();
  let checks = 0;
  for (const v of data.variants || []) {
    if (!/^v(?:[1-9]|1\d|20)$/.test(v.id)) errors.push(`oge14 (ОГЭ): неожиданный id ${v.id}`);
    if (ids.has(v.id)) errors.push(`oge14 (ОГЭ): дублирующийся id ${v.id}`);
    ids.add(v.id);
    const ds = data.datasets[v.dataset];
    if (!ds) { errors.push(`oge14 (ОГЭ) ${v.id}: нет набора ${v.dataset}`); continue; }
    families.set(v.dataset, (families.get(v.dataset) || 0) + 1);
    if (!Array.isArray(v.questions) && (!v.q1 || !v.q2)) errors.push(`oge14 (ОГЭ) ${v.id}: нет двух вопросов`);
    for (const q of [v.q1, v.q2]) {
      if (!q || typeof q.text !== 'string' || !q.text) { errors.push(`oge14 (ОГЭ) ${v.id}: пустой текст вопроса`); continue; }
      if (typeof q.cell !== 'string' || !/^[A-Z]\d+$/.test(q.cell)) errors.push(`oge14 (ОГЭ) ${v.id}: неверная ячейка ${q.cell}`);
      let got;
      try { got = compute(ds.rows, q); } catch (e) { errors.push(`oge14 (ОГЭ) ${v.id}: ${e.message}`); continue; }
      if (typeof q.answer !== 'number' || Math.abs(got - q.answer) > 1e-6) {
        errors.push(`oge14 (ОГЭ) ${v.id}, «${q.text.slice(0, 40)}…»: пересчёт ${got}, в задаче ${q.answer}`);
      }
      checks++;
    }
    const chart = v.chart;
    if (!chart || !Array.isArray(chart.labels) || chart.labels.length !== 3 ||
        !Array.isArray(chart.values) || chart.values.length !== 3 ||
        !Array.isArray(chart.sectors) || chart.sectors.length !== 3) {
      errors.push(`oge14 (ОГЭ) ${v.id}: диаграмма должна содержать три сектора`);
      continue;
    }
    if (typeof chart.text !== 'string' || !chart.text) errors.push(`oge14 (ОГЭ) ${v.id}: нет текста задания с диаграммой`);
    if (chart.values.some((x) => typeof x !== 'number' || x <= 0)) {
      errors.push(`oge14 (ОГЭ) ${v.id}: все сектора диаграммы должны быть положительными`);
    }
    chart.sectors.forEach((sec, i) => {
      let got;
      try { got = compute(ds.rows, sec); } catch (e) { errors.push(`oge14 (ОГЭ) ${v.id}: диаграмма — ${e.message}`); return; }
      if (Math.abs(got - chart.values[i]) > 1e-6) {
        errors.push(`oge14 (ОГЭ) ${v.id}, сектор ${i + 1}: пересчёт ${got}, в задаче ${chart.values[i]}`);
      }
      checks++;
    });
  }
  if ((data.variants || []).length !== 20) {
    errors.push(`oge14 (ОГЭ): вариантов ${(data.variants || []).length}, ожидалось 20`);
  }
  for (const [id, count] of Object.entries(expectedRows)) {
    if (families.get(id) !== 4) errors.push(`oge14 (ОГЭ): в наборе ${id} ${families.get(id) || 0} вариантов, ожидалось 4`);
  }
  console.log(`oge14 (ОГЭ): проверено ${(data.variants || []).length} вариантов и ${checks} ответов по данным из сборника`);
} catch (e) {
  errors.push('oge14 (ОГЭ): ' + e.message);
}

/* ─────────── 4c. Задания 13.1/13.2: шаги чек-листов ─────────── */
try {
  for (const page of ['oge131.html', 'oge132.html']) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const steps = extractArray(html, 'const steps = [');
    if (steps.length < 10) errors.push(`${page}: шагов ${steps.length}, ожидалось не менее 10`);
    const ids = new Set();
    for (const [i, s] of steps.entries()) {
      const at = `${page} шаг ${i + 1}`;
      if (!s.id || ids.has(s.id)) errors.push(`${at}: пустой или повторяющийся id`);
      ids.add(s.id);
      for (const field of ['title', 'text', 'question', 'hint', 'why']) {
        if (typeof s[field] !== 'string' || !s[field].trim()) errors.push(`${at}: пустое поле ${field}`);
      }
      if (!Array.isArray(s.options) || s.options.length < 2 || s.options.length > 4) {
        errors.push(`${at}: вариантов ${s.options ? s.options.length : 0}, ожидалось 2–4`);
      } else {
        if (new Set(s.options.map((o) => String(o).toLowerCase())).size !== s.options.length) {
          errors.push(`${at}: одинаковые варианты ответа`);
        }
        for (const o of s.options) {
          if (typeof o !== 'string' || !o.trim()) errors.push(`${at}: пустой вариант ответа`);
        }
      }
      if (!Number.isInteger(s.correct) || s.correct < 0 || s.correct >= (s.options || []).length) {
        errors.push(`${at}: correct вне диапазона вариантов`);
      }
      if (/(?:^|[^\w.-])on(?:click|change|focus|load)\s*=/i.test(String(s.text) + String(s.question))) {
        errors.push(`${at}: inline-обработчик в тексте шага (CSP)`);
      }
    }
    // Верные ответы должны быть в разных позициях, иначе тренажёр проходится «всё время первым».
    const positions = new Set(steps.map((s) => s.correct));
    if (positions.size < 3) errors.push(`${page}: верные ответы на ${positions.size} позициях — похоже на шаблон`);
    console.log(`${page}: проверено ${steps.length} шагов чек-листа`);
  }
} catch (e) {
  errors.push('checklist: ' + e.message);
}

if (errors.length) {
  console.error(`\nОшибок: ${errors.length}`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log('\nOK: данные заданий 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13.1/13.2, 14, 15 и 16 согласованы');
