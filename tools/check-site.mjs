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

// 3. sw.js ASSETS существуют
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const block = sw.slice(sw.indexOf('var ASSETS = ['), sw.indexOf('];', sw.indexOf('var ASSETS = [')));
for (const m of block.matchAll(/'([^']+)'/g)) {
  const p = m[1];
  if (!p.startsWith('/')) continue;
  const abs = p === '/' ? join(root, 'oge.html') : join(root, p.slice(1));
  if (!existsSync(abs)) errors.push(`sw.js: отсутствует ассет ${p}`);
}

// 4. manifest + иконки
try {
  const mf = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  for (const ic of mf.icons || []) {
    if (ic.src.startsWith('data:')) continue;
    if (!existsSync(join(root, ic.src))) errors.push(`manifest.json: нет иконки ${ic.src}`);
  }
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
    [/<title>/, 'title'],
    [/<meta property="og:image"/, 'og:image'],
  ]) {
    if (!re.test(html)) errors.push(`${f}: нет ${name}`);
  }
}

if (errors.length) {
  console.error('Найдено проблем: ' + errors.length);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log(`OK: проверено ${htmlFiles.length} страниц, ссылки/ассеты/иконки корректны`);
