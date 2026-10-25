#!/usr/bin/env node
// Минимальные статические проверки сайта (ссылки, canonical, sw-ассеты, манифест).
// Запуск: node tools/check-site.mjs   (из корня репозитория)
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

const root = process.cwd();
const errors = [];
const htmlFiles = readdirSync(root).filter((f) => f.endsWith('.html')).sort();

function stripUrl(u) {
  return u.split('#')[0].split('?')[0];
}

// 1. Ссылки
for (const f of htmlFiles) {
  const html = readFileSync(join(root, f), 'utf8');
  const attrs = [...html.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  for (const raw of attrs) {
    if (/^(https?:|mailto:|tel:|data:|#|javascript:)/i.test(raw)) continue;
    const target = stripUrl(raw);
    if (target === '') continue;
    const abs = target === '/'
      ? join(root, 'oge.html')
      : (target.startsWith('/')
        ? join(root, target.slice(1))
        : resolve(dirname(join(root, f)), target));
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      errors.push(`${f}: битая ссылка ${raw}`);
    }
  }
}

// 2. canonical
for (const f of htmlFiles) {
  const html = readFileSync(join(root, f), 'utf8');
  const m = html.match(/<link rel="canonical" href="([^"]+)"/);
  if (!m) continue;
  const expected = 'https://oge.nayanovaacademy.ru/' + (f === 'oge.html' ? '' : f);
  if (m[1] !== expected) errors.push(`${f}: canonical=${m[1]} (ожидалось ${expected})`);
}

// 3. sw.js ASSETS существуют (включая 40 файлов задания 15, добавляемых циклом)
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const block = sw.slice(sw.indexOf('var ASSETS = ['), sw.indexOf('];', sw.indexOf('var ASSETS = [')));
const swAssets = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
for (const p of swAssets) {
  if (!p.startsWith('/')) continue;
  const abs = p === '/' ? join(root, 'oge.html') : join(root, p.slice(1));
  if (!existsSync(abs)) errors.push(`sw.js: отсутствует ассет ${p}`);
}
// Те же 40 файлов, что генерирует цикл for (1..20) в sw.js.
for (let i = 1; i <= 20; i++) {
  const n = String(i).padStart(2, '0');
  const names = [`oge-15-2026-${n}.json`, `oge-15-2026-e-${n}.json`];
  for (const name of names) {
    const p = `files/oge15/${name}`;
    if (!existsSync(join(root, p))) errors.push(`sw.js: отсутствует ассет /${p}`);
  }
}

// 4. manifest + иконки
if (!existsSync(join(root, 'favicon.ico'))) errors.push('нет favicon.ico (браузеры запрашивают /favicon.ico)');
try {
  const mf = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  for (const ic of mf.icons || []) {
    if (ic.src.startsWith('data:')) continue;
    if (!existsSync(join(root, ic.src))) errors.push(`manifest.json: нет иконки ${ic.src}`);
  }
  if (mf.start_url !== '/') errors.push(`manifest.json: start_url=${mf.start_url} (ожидалось /)`);
} catch (e) {
  errors.push('manifest.json: ' + e.message);
}

// 5. обязательные head-теги
for (const f of htmlFiles) {
  const html = readFileSync(join(root, f), 'utf8');
  if (f === '404.html' || f === 'offline.html') continue;
  for (const [re, name] of [
    [/<meta name="charset"|charset="UTF-8"/i, 'charset'],
    [/<meta name="viewport"/, 'viewport'],
    [/<meta name="theme-color"/, 'theme-color'],
    [/<link rel="manifest"/, 'manifest'],
    [/<link rel="icon"/, 'favicon'],
    [/<link rel="apple-touch-icon"/, 'apple-touch-icon'],
    [/<title>/, 'title'],
    [/<meta property="og:image"/, 'og:image'],
  ]) {
    if (!re.test(html)) errors.push(`${f}: нет ${name}`);
  }
}

// 6. UTF-8 BOM во всех HTML (конвенция проекта)
for (const f of htmlFiles) {
  const buf = readFileSync(join(root, f));
  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  if (!hasBom) errors.push(`${f}: нет UTF-8 BOM`);
}

// 7. sitemap покрывает все страницы, кроме служебных
const sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
for (const f of htmlFiles) {
  if (f === '404.html' || f === 'offline.html') continue;
  const expected = 'https://oge.nayanovaacademy.ru/' + (f === 'oge.html' ? '' : f);
  if (!locs.includes(expected)) errors.push(`sitemap.xml: нет ${expected}`);
}

// 8. служебные страницы не индексируются
for (const f of ['404.html', 'offline.html']) {
  const html = readFileSync(join(root, f), 'utf8');
  if (!/<meta name="robots" content="noindex"/.test(html)) {
    errors.push(`${f}: нет meta robots noindex`);
  }
}

if (errors.length) {
  console.error('Найдено проблем: ' + errors.length);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log(`OK: проверено ${htmlFiles.length} страниц, ссылки/ассеты/иконки/SEO корректны`);
