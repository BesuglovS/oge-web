#!/usr/bin/env node
// Генерирует Content-Security-Policy с хешами inline-скриптов и inline-стилей.
//
//   node tools/csp-policy.mjs        # напечатать политику
//   node tools/csp-policy.mjs --json # {"policy": "...", "scripts": N, "styles": M}
//
// Inline-обработчиков (onclick=…) в проекте больше нет — только data-активы,
// поэтому 'unsafe-inline' для script-src не нужен: каждому inline <script>
// соответствует 'sha256-…' в политике.
//
// У стилей так же: <style> и style="…" разрешены по хешу значения, а
// 'unsafe-inline' для style-src не нужен. Атрибуты требуют 'unsafe-hashes'
// (Chrome 69+, Firefox 109+, Safari 15.4+) — это разрешает только конкретные
// значения атрибутов, а не произвольные стили. Динамические значения
// (сборка строкой/интерполяцией) захешировать нельзя, поэтому их в проекте
// быть не должно: такие места ловит findDynamicStyles() (и check-site.mjs),
// а настраивать стили из JS нужно через CSSOM (el.style.width = …).
//
// Политику подставляет deploy.ps1 в nginx-конфиг при каждом деплое
// (хеши считаются по тем же файлам, что уезжают).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('base64');

// HTML-парсер нормализует CRLF/CR в LF — хеш считается по этому тексту.
const normalize = (text) => text.replace(/\r\n?/g, '\n');

export function collectInlineHashes(rootDir) {
  const hashes = new Set();
  for (const f of fs.readdirSync(rootDir).filter((x) => x.endsWith('.html')).sort()) {
    const html = fs.readFileSync(path.join(rootDir, f), 'utf8');
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      const code = m[1];
      if (!code.trim()) continue;
      hashes.add(sha256(normalize(code)));
    }
  }
  return [...hashes].sort();
}

// Границы <script>/<style>-блоков: внутри скрипта строка style="…" — это
// генерируемая разметка, а не разметка страницы.
function scriptRanges(html) {
  const ranges = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

const inRanges = (ranges, pos) => ranges.some(([a, b]) => pos >= a && pos < b);

// Признак динамического значения: интерполяция или конкатенация внутри атрибута.
const isDynamicValue = (value) => /\$\{/.test(value) || /['"]\s*\+|\+\s*['"]/.test(value);

// Значения style="…"/style='…' + хеши <style>. Возвращает и найденные
// динамические места — их нельзя захешировать, поэтому это ошибка сборки.
export function collectStyleInfo(rootDir) {
  const hashes = new Set();
  const dynamic = [];
  const blocks = [];
  const sources = [];
  for (const f of fs.readdirSync(rootDir).filter((x) => x.endsWith('.html')).sort()) {
    sources.push({ name: f, file: path.join(rootDir, f), script: false });
  }
  // JS-файлы тоже собирают разметку со style="…" (progress.js, code-editor.js).
  const jsFiles = [
    ...fs.readdirSync(rootDir).filter((x) => x.endsWith('.js')).map((x) => ({ name: x, file: path.join(rootDir, x) })),
    ...(fs.existsSync(path.join(rootDir, 'js'))
      ? fs.readdirSync(path.join(rootDir, 'js')).filter((x) => x.endsWith('.js')).map((x) => ({ name: 'js/' + x, file: path.join(rootDir, 'js', x) }))
      : []),
  ];
  for (const j of jsFiles) sources.push({ name: j.name, file: j.file, script: true });

  for (const src of sources) {
    const text = fs.readFileSync(src.file, 'utf8');
    if (!src.script) {
      for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
        if (!m[1].trim()) continue;
        hashes.add(sha256(normalize(m[1])));
        blocks.push(src.name);
      }
    }
    const scripts = src.script ? [[0, text.length]] : scriptRanges(text);
    const lineOf = (pos) => text.slice(0, pos).split('\n').length;
    for (const m of text.matchAll(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
      const value = normalize(m[2] !== undefined ? m[2] : m[3]);
      const insideScript = inRanges(scripts, m.index);
      if (insideScript && isDynamicValue(value)) {
        dynamic.push(`${src.name}:${lineOf(m.index)}: style="${value.slice(0, 60)}"`);
        continue;
      }
      if (value.trim()) hashes.add(sha256(value));
    }
    // setAttribute('style', '…') — статическое значение тоже по хешу.
    for (const m of text.matchAll(/setAttribute\(\s*['"]style['"]\s*,\s*(["'])((?:(?!\1)[\s\S])*)\1/gi)) {
      const value = normalize(m[2]);
      if (isDynamicValue(value)) {
        dynamic.push(`${src.name}:${lineOf(m.index)}: setAttribute('style', "${value.slice(0, 60)}")`);
      } else if (value.trim()) {
        hashes.add(sha256(value));
      }
    }
  }
  return { hashes: [...hashes].sort(), dynamic, blocks };
}

export function findDynamicStyles(rootDir) {
  return collectStyleInfo(rootDir).dynamic;
}

// nginx не принимает параметр длиннее ~4 КБ («too long parameter»), а политика
// с хешами стилей — 6–7 КБ. Поэтому режем её на куски и склеиваем переменными:
//   set $csp0 "…"; set $csp1 "…"; set $csp "$csp0$csp1";
export function buildNginxSet(policy, indent = '    ', chunkSize = 3000) {
  const chunks = [];
  for (let i = 0; i < policy.length; i += chunkSize) chunks.push(policy.slice(i, i + chunkSize));
  const names = chunks.map((_, i) => '$csp' + i);
  const lines = chunks.map((c, i) => `${indent}set $csp${i} "${c}";`);
  lines.push(`${indent}set $csp "${names.join('')}";`);
  return lines.join('\n');
}

export function buildPolicy(rootDir) {
  const scriptHashes = collectInlineHashes(rootDir);
  const { hashes: styleHashes, dynamic } = collectStyleInfo(rootDir);
  if (dynamic.length) {
    // Политика получилась бы неполной → на страницах молча пропали бы стили.
    throw new Error('динамические style= нельзя захешировать, переведите на CSSOM:\n  ' + dynamic.join('\n  '));
  }
  // Метрика может ходить и через .com (JSONP-колбэки, watch) — разрешаем оба домена.
  const YM = 'https://mc.yandex.ru https://mc.yandex.com';
  const scriptSrc = ["'self'", ...scriptHashes.map((h) => `'sha256-${h}'`), YM].join(' ');
  // 'unsafe-hashes' нужен только для атрибутов style="…"; <style> разрешены хешем.
  const styleSrc = ["'self'", "'unsafe-hashes'", ...styleHashes.map((h) => `'sha256-${h}'`)].join(' ');
  const policy = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `img-src 'self' data: ${YM}`,
    "font-src 'self'",
    `connect-src 'self' ${YM} https://auth.nayanovaacademy.ru`,
    `frame-src ${YM}`,
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
  return { policy, hashes: scriptHashes, scriptHashes, styleHashes };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { policy, scriptHashes, styleHashes } = buildPolicy(rootDir);
  if (process.argv.includes('--nginx')) {
    // Блок для nginx: несколько set-переменных (лимит 4 КБ на параметр).
    console.log(buildNginxSet(policy));
  } else if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ policy, scripts: scriptHashes.length, styles: styleHashes.length }));
  } else {
    console.log(policy);
  }
}
