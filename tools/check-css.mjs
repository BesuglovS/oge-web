#!/usr/bin/env node
// CSS-аудит: синтаксис (баланс скобок), мёртвые правила (классы, которых нет
// в HTML/JS), точные дубли, полностью перекрытые правила и реестр известных
// конфликтов (page-секции, которые требуют визуального аудита).
//
// Запуск:            node tools/check-css.mjs
// Обновить реестр:   node tools/check-css.mjs --update
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRules, splitDeclarations, normalizeText } from './css-utils.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cssPath = path.join(root, 'assets/styles.css');
const allowPath = path.join(root, 'tools/css-known-conflicts.json');
const css = fs.readFileSync(cssPath, 'utf8');
const rules = parseRules(css);
const errors = [];
const update = process.argv.includes('--update');
const fix = process.argv.includes('--fix');
const merge = process.argv.includes('--merge');

function braceDepth(src) {
  let depth = 0;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '*') {
      const k = src.indexOf('*/', i + 2);
      i = k < 0 ? src.length : k + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth < 0) return -1;
    }
    i++;
  }
  return depth;
}

const depth = braceDepth(css);
if (depth !== 0) errors.push('несбалансированные скобки CSS: ' + depth);

// Корпус HTML/JS для поиска использования классов.
let corpus = '';
for (const f of fs.readdirSync(root)) {
  if (/\.(html|js)$/.test(f)) corpus += '\n' + fs.readFileSync(path.join(root, f), 'utf8');
}
for (const f of fs.readdirSync(path.join(root, 'js'))) {
  if (f.endsWith('.js')) corpus += '\n' + fs.readFileSync(path.join(root, 'js', f), 'utf8');
}
const usedCache = new Map();
function usedClass(name) {
  if (!usedCache.has(name)) {
    const re = new RegExp('(^|[^A-Za-z0-9_-])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z0-9_-])');
    usedCache.set(name, re.test(corpus));
  }
  return usedCache.get(name);
}

const keyOf = (r) => normalizeText(r.context) + '|' + normalizeText(r.selector);
const bodyKey = (body) => splitDeclarations(body)
  .map((d) => d.prop + ':' + d.value + (d.important ? '!important' : ''))
  .sort()
  .join(';');

// 1. Мёртвые правила: все классы селектора отсутствуют в HTML/JS.
const dead = [];
for (const r of rules) {
  const classes = [...r.selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
  if (!classes.length) continue;
  if (classes.every((c) => !usedClass(c))) dead.push(normalizeText(r.selector));
}
if (dead.length) errors.push('мёртвые CSS-правила: ' + dead.length + ' (' + [...new Set(dead)].slice(0, 8).join('; ') + ')');

// 2. Группы по контексту+селектору.
const groups = new Map();
for (const r of rules) {
  const key = keyOf(r);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

// --merge: объединить все правила одного селектора (в одном контексте)
// в один блок. Значение каждого свойства берётся из последнего объявления,
// порядок — по последнему появлению свойства, поэтому каскад не меняется.
if (merge) {
  const edits = [];
  let mergedGroups = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const order = [];
    const values = new Map();
    for (const r of list) {
      for (const d of splitDeclarations(r.body)) {
        if (!values.has(d.prop)) order.push(d.prop);
        values.set(d.prop, d.value + (d.important ? ' !important' : ''));
        const idx = order.indexOf(d.prop);
        if (idx >= 0) { order.splice(idx, 1); order.push(d.prop); }
      }
    }
    if (!order.length) continue;
    const body = '\n  ' + order.map((p) => `${p}: ${values.get(p)};`).join('\n  ') + '\n';
    const last = list[list.length - 1];
    edits.push({ start: last.bodyStart, end: last.bodyStart + last.body.length, text: body });
    for (const r of list.slice(0, -1)) edits.push({ start: r.start, end: r.end, text: '' });
    mergedGroups++;
  }
  edits.sort((a, b) => b.start - a.start);
  let out = css;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  fs.writeFileSync(cssPath, out, 'utf8');
  console.log(`--merge: объединено групп ${mergedGroups}; запустите --update и проверку`);
  process.exit(0);
}

// --fix: удалить точные дубли (порядок объявлений не важен, если нет
// повторяющихся свойств) и полностью перекрытые более поздними правила.
if (fix) {
  const remove = [];
  const taken = new Set();
  for (const list of groups.values()) {
    const seen = new Map();
    for (const r of list) {
      const ds = splitDeclarations(r.body);
      if (new Set(ds.map((d) => d.prop)).size !== ds.length) continue;
      const bk = bodyKey(r.body);
      if (seen.has(bk)) {
        const prev = seen.get(bk);
        if (!taken.has(prev.start)) { remove.push(prev); taken.add(prev.start); }
      }
      seen.set(bk, r);
    }
    if (list.length > 1) {
      const bodies = list.map((r) => splitDeclarations(r.body));
      const effective = new Map();
      bodies.forEach((ds, idx) => {
        for (const d of ds) {
          const prev = effective.get(d.prop);
          if (!prev || d.important || !prev.important) effective.set(d.prop, { important: d.important, idx });
        }
      });
      for (let i = 0; i < list.length - 1; i++) {
        const ds = bodies[i];
        if (!ds.length) continue;
        let safe = true;
        for (const d of ds) {
          const eff = effective.get(d.prop);
          if (!eff || eff.idx <= i) { safe = false; break; }
          if (d.important && !eff.important) { safe = false; break; }
        }
        if (safe && !taken.has(list[i].start)) {
          remove.push(list[i]);
          taken.add(list[i].start);
        }
      }
    }
  }
  remove.sort((a, b) => b.start - a.start);
  let out = css;
  for (const r of remove) out = out.slice(0, r.start) + out.slice(r.end);
  fs.writeFileSync(cssPath, out, 'utf8');
  console.log('--fix: удалено правил ' + remove.length + '; запустите --update и check');
  process.exit(0);
}

// 3. Точные дубли правил.
let exactDupes = 0;
for (const list of groups.values()) {
  const seen = new Map();
  for (const r of list) {
    const bk = bodyKey(r.body);
    if (seen.has(bk)) exactDupes++;
    else seen.set(bk, r);
  }
}
if (exactDupes) errors.push('точных дублей правил: ' + exactDupes);

// 4. Полностью перекрытые более поздним правилом.
let fullyOverridden = 0;
for (const list of groups.values()) {
  if (list.length < 2) continue;
  const bodies = list.map((r) => splitDeclarations(r.body));
  const effective = new Map();
  bodies.forEach((ds, idx) => {
    for (const d of ds) {
      const prev = effective.get(d.prop);
      if (!prev || d.important || !prev.important) effective.set(d.prop, { important: d.important, idx });
    }
  });
  for (let i = 0; i < list.length - 1; i++) {
    const ds = bodies[i];
    if (!ds.length) continue;
    let safe = true;
    for (const d of ds) {
      const eff = effective.get(d.prop);
      if (!eff || eff.idx <= i) { safe = false; break; }
      if (d.important && !eff.important) { safe = false; break; }
    }
    if (safe) fullyOverridden++;
  }
}
if (fullyOverridden) errors.push('полностью перекрытых правил: ' + fullyOverridden);

// 5. Известные конфликты (разные тела у одного контекста+селектора).
const conflicts = [];
for (const [key, list] of groups) {
  if (list.length < 2) continue;
  const bodies = new Set(list.map((r) => bodyKey(r.body)));
  if (bodies.size > 1) conflicts.push(key);
}
conflicts.sort();

let allow = [];
if (fs.existsSync(allowPath)) {
  try { allow = JSON.parse(fs.readFileSync(allowPath, 'utf8')); } catch (e) { errors.push('css-known-conflicts.json: ' + e.message); }
}
if (!Array.isArray(allow)) allow = [];

const newConflicts = conflicts.filter((k) => !allow.includes(k));
const stale = allow.filter((k) => !conflicts.includes(k));
if (update) {
  fs.writeFileSync(allowPath, JSON.stringify(conflicts, null, 2) + '\n', 'utf8');
  console.log('обновлён ' + path.relative(root, allowPath) + ': ' + conflicts.length + ' известных конфликтов');
} else {
  if (newConflicts.length) {
    errors.push('новые конфликтующие CSS-правила: ' + newConflicts.length + '\n    ' + newConflicts.slice(0, 8).join('\n    '));
  }
  if (stale.length) {
    errors.push('в реестре конфликтов устаревшие записи: ' + stale.length + ' (запустите --update)');
  }
}

if (errors.length) {
  console.error('Найдено проблем: ' + errors.length);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log('OK: CSS корректен; известных конфликтов (page-секции): ' + conflicts.length);
