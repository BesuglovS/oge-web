#!/usr/bin/env node
// Визуальная регрессия: снимок вычисленных стилей сравнивается с эталоном.
//
//   node tools/check-visual.mjs                  # снять страницы и сравнить (нужен Chrome + сервер)
//   node tools/check-visual.mjs snapshot.json    # сравнить готовый снимок
//   node tools/check-visual.mjs --update         # снять заново и перезаписать эталон
//   node tools/check-visual.mjs [--raw]          # --raw: сравнивать всё точно (диагностика)
//
// Эталон — tools/visual-baseline.json.gz (14 МБ JSON сжимаются до ~270 КБ). Снимает
// его tools/visual-baseline.mjs в детерминированном режиме: Math.random/Date.now
// подменяются, Метрика и портал блокируются, страницы проверяются на двух ширинах.
//
// Windows и Linux рендерят шрифты по-разному, поэтому высоты текстовых блоков,
// line-height и auto-отступы (margin) не сравниваются. Так ловится потеря каскада
// (элемент скрыт, поехали display/цвет/границы/радиусы/flex/grid/паддинги), но нет
// шума из-за разницы шрифтов. Для диагностики платформенных расхождений есть --raw.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const baselineFile = path.join(root, 'tools/visual-baseline.json.gz');

const args = process.argv.slice(2);
const update = args.includes('--update');
const raw = args.includes('--raw');
const given = args.find((a) => !a.startsWith('--'));

// Свойства, значения которых зависят от метрик шрифта (нормальный line-height,
// высота/ширина текстовых блоков, auto-отступы, поглощающие свободное место во
// flex), поэтому они различаются на Windows и Linux. Их не сравниваем — иначе
// проверка шумит на ровном месте (первый прогон в CI: 837 ложных расхождений,
// все из этого списка). Для полной выборки — скриншоты: visual-baseline --shots
// + visual-shot-diff на одной машине.
const IGNORED = new Set([
  'line-height', 'height', 'width',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
]);
// У form-контролов UA-дефолты свои в каждой ОС и Chrome (фон 240 vs 239,
// цвет текста, толщина/цвет рамки). Наши стили остаются видны через
// background-image, box-shadow, border-radius, padding, font-*.
const CONTROL_TAGS = new Set(['button', 'input', 'select', 'textarea']);
const CONTROL_IGNORED = new Set([
  'background-color', 'color',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
]);
const tagOf = (sel) => {
  const mm = /\/([a-z0-9]+)\[\d+\]$/.exec(sel);
  return mm ? mm[1] : '';
};
// Числовой допуск — на случай дробных px из-за округления layout'а.
const TOLERANT = new Set(['padding-top', 'padding-right', 'padding-bottom', 'padding-left']);
const TOLERANCE = { rel: 0.05, abs: 1 }; // px: 5% или 1px

const readSnapshot = (file) => {
  const buf = fs.readFileSync(file);
  const json = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf;
  return JSON.parse(json.toString('utf8'));
};

const parseProps = (s) => {
  const m = new Map();
  for (const chunk of String(s).split(';')) {
    const i = chunk.indexOf(':');
    if (i > 0) m.set(chunk.slice(0, i), chunk.slice(i + 1));
  }
  return m;
};

const pxValue = (v) => {
  const mm = /^(-?\d+(?:\.\d+)?)px$/.exec(v);
  return mm ? Number(mm[1]) : null;
};

// Значения считаем одинаковыми, если строки совпали; для px из TOLERANT —
// если разница в пределах допуска (шрифты и округление layout'а).
function sameValue(prop, a, b) {
  if (a === b) return true;
  if (raw || !TOLERANT.has(prop)) return false;
  const na = pxValue(a);
  const nb = pxValue(b);
  if (na === null || nb === null) return false;
  const diff = Math.abs(na - nb);
  return diff <= Math.max(TOLERANCE.abs, Math.max(Math.abs(na), Math.abs(nb)) * TOLERANCE.rel);
}

const short = (v) => (v.length > 60 ? v.slice(0, 57) + '…' : v);

function compare(base, snap) {
  const diffs = [];
  const pages = [...new Set([...Object.keys(base), ...Object.keys(snap)])].sort();
  for (const page of pages) {
    if (!base[page]) { diffs.push(`${page}: новый снимок (в эталоне страницы нет)`); continue; }
    if (!snap[page]) { diffs.push(`${page}: снимок пропал`); continue; }
    const bEls = base[page];
    const sEls = snap[page];
    const els = [...new Set([...Object.keys(bEls), ...Object.keys(sEls)])].sort();
    for (const el of els) {
      if (!bEls[el]) { diffs.push(`${page} ${el}: новый элемент`); continue; }
      if (!sEls[el]) { diffs.push(`${page} ${el}: элемент исчез`); continue; }
      const bp = parseProps(bEls[el]);
      const sp = parseProps(sEls[el]);
      const control = CONTROL_TAGS.has(tagOf(el));
      const props = [...new Set([...bp.keys(), ...sp.keys()])].sort();
      const changed = [];
      for (const prop of props) {
        if (!raw && IGNORED.has(prop)) continue;
        if (!raw && control && CONTROL_IGNORED.has(prop)) continue;
        const bv = bp.has(prop) ? bp.get(prop) : '—';
        const sv = sp.has(prop) ? sp.get(prop) : '—';
        if (!sameValue(prop, bv, sv)) changed.push(`${prop} ${short(bv)} → ${short(sv)}`);
      }
      if (changed.length) diffs.push(`${page} ${el}: ${changed.join('; ')}`);
    }
  }
  return diffs;
}

let snapFile = given;
if (!snapFile) {
  snapFile = path.join(os.tmpdir(), `oge-visual-${process.pid}.json`);
  const r = spawnSync(process.execPath, [path.join(root, 'tools/visual-baseline.mjs'), snapFile], {
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) {
    console.error('visual-baseline завершился с ошибкой — нужен Chrome и сервер на BASE');
    process.exit(1);
  }
}

const snap = readSnapshot(snapFile);
if (update) {
  fs.writeFileSync(baselineFile, zlib.gzipSync(JSON.stringify(snap), { level: 9 }));
  console.log(`эталон обновлён: tools/visual-baseline.json.gz (${Object.keys(snap).length} снимков)`);
  process.exit(0);
}
if (!fs.existsSync(baselineFile)) {
  console.error('нет эталона tools/visual-baseline.json.gz — сгенерируйте: node tools/check-visual.mjs --update');
  process.exit(1);
}

const base = readSnapshot(baselineFile);
const diffs = compare(base, snap);
if (!diffs.length) {
  console.log(`OK: ${Object.keys(snap).length} снимков совпадают с эталоном (${raw ? 'точное сравнение' : 'без метрик шрифта'})`);
  process.exit(0);
}

console.error(`Расхождений с эталоном: ${diffs.length}`);
for (const d of diffs.slice(0, 60)) console.error(' - ' + d);
if (diffs.length > 60) console.error(` … и ещё ${diffs.length - 60}`);
console.error('\nЕсли правки стилей намеренные: node tools/check-visual.mjs --update и закоммитить эталон.');
process.exit(1);
