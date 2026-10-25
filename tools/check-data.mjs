#!/usr/bin/env node
// Проверки данных и логики заданий:
//  1) задание 16 — каждое эталонное решение проходит все тесты;
//  2) задание 15 — .kum-эталоны совпадают с e-*.json, генератор строит
//     валидные обстановки;
//  3) задание 7 — data/oge7.json синхронен с oge7.txt;
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

/* ─────────── 3. Задание 7 ─────────── */
try {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data/oge7.json'), 'utf8'));
  const raw = fs.readFileSync(path.join(root, 'oge7.txt'), 'utf8');
  const mapping = {
    'Протоколы': 'protocols',
    'Домены (кириллица)': 'domainsCyrillic',
    'Домены (латиница)': 'domainsLatin',
    'Пути (кириллица)': 'pathsCyrillic',
    'Пути (латиница)': 'pathsLatin',
    'Имена файлов (кириллица)': 'filesCyrillic',
    'Имена файлов (латиница)': 'filesLatin',
  };
  const sections = {};
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      current = trimmed.replace(/^#+\s*/, '');
      sections[current] = [];
    } else if (trimmed && current) {
      sections[current].push(trimmed);
    }
  }
  for (const [section, key] of Object.entries(mapping)) {
    const a = sections[section] || [];
    const b = data[key] || [];
    const onlyTxt = a.filter((x) => !b.includes(x));
    const onlyJson = b.filter((x) => !a.includes(x));
    if (onlyTxt.length || onlyJson.length) {
      errors.push(`oge7: ${key} рассинхронизирован (только txt: ${onlyTxt.join(', ') || '—'}; только json: ${onlyJson.join(', ') || '—'})`);
    }
  }
  console.log('oge7: data/oge7.json и oge7.txt синхронны');
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

if (errors.length) {
  console.error(`\nОшибок: ${errors.length}`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log('\nOK: данные заданий 6, 7, 12, 15 и 16 согласованы');
