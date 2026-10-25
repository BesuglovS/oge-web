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

// 1b. Якоря: href="файл.html#id" — id должен существовать на целевой странице.
const idsCache = new Map();
const idsOf = (file) => {
  if (!idsCache.has(file)) {
    const html = readFileSync(join(root, file), 'utf8')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');
    idsCache.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  }
  return idsCache.get(file);
};
for (const f of htmlFiles) {
  const html = readFileSync(join(root, f), 'utf8');
  for (const m of html.matchAll(/href="([^"]*#[^"]+)"/g)) {
    const raw = m[1];
    if (/^https?:\/\//i.test(raw) && !raw.startsWith('https://oge.nayanovaacademy.ru/')) continue;
    const [filePart, anchor] = raw.split('#');
    if (!anchor) continue;
    const rel = filePart.replace(/^https:\/\/oge\.nayanovaacademy\.ru\//, '').replace(/^\.?\//, '');
    const file = rel === '' ? f : rel;
    if (!htmlFiles.includes(file)) continue;
    if (!idsOf(file).has(anchor)) errors.push(`${f}: якорь #${anchor} отсутствует в ${file}`);
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
  for (const sc of mf.shortcuts || []) {
    const file = String(sc.url || '').replace(/^\//, '');
    if (!file || !existsSync(join(root, file))) {
      errors.push(`manifest.json: ярлык «${sc.name}» ведёт на несуществующий ${sc.url}`);
    }
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

// 9. Разметка и доступность: один h1, уникальные id, alt у картинок,
// type у кнопок, noopener у внешних ссылок в новой вкладке.
const markupOnly = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '');
for (const f of htmlFiles) {
  const html = readFileSync(join(root, f), 'utf8');
  const markup = markupOnly(html);

  const h1 = (markup.match(/<h1[\s>]/gi) || []).length;
  if (h1 !== 1) errors.push(`${f}: заголовков <h1> ${h1} (ожидался ровно один)`);

  const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set();
  const dupes = new Set();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    else seen.add(id);
  }
  if (dupes.size) errors.push(`${f}: повторяющиеся id: ${[...dupes].join(', ')}`);

  for (const m of markup.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt\s*=/.test(m[0])) errors.push(`${f}: <img> без alt: ${m[0].slice(0, 70)}`);
  }
  for (const m of html.matchAll(/<button\b[^>]*>/gi)) {
    if (!/\btype\s*=/.test(m[0])) errors.push(`${f}: <button> без type: ${m[0].slice(0, 70)}`);
  }
  for (const m of markup.matchAll(/<a\b[^>]*target="_blank"[^>]*>/gi)) {
    if (!/\brel\s*=\s*"[^"]*noopener/.test(m[0])) {
      errors.push(`${f}: target="_blank" без rel="noopener": ${m[0].slice(0, 70)}`);
    }
  }
}

// 10. Подключение скриптов: аналитика везде, прогресс — на интерактивных.
for (const f of htmlFiles) {
  if (f === '404.html' || f === 'offline.html') continue;
  const html = readFileSync(join(root, f), 'utf8');
  for (const script of ['js/tracking-client.js', 'js/metrika.js']) {
    if (!html.includes(script)) errors.push(`${f}: не подключён ${script}`);
  }
  const markup = markupOnly(html);
  const interactive = /id="taskCard"/.test(markup) && !/-t\.html$/.test(f);
  if (interactive) {
    for (const script of ['js/progress.js', 'js/progress-client.js', 'js/progress-sync.js']) {
      if (!html.includes(script)) errors.push(`${f}: интерактив без ${script}`);
    }
  }
}

// 11. SEO-гигиена: язык, og:url = canonical, уникальные title/description,
// description разумной длины, все адреса из sitemap существуют.
{
  const titles = new Map();
  const descriptions = new Map();
  for (const f of htmlFiles) {
    const html = readFileSync(join(root, f), 'utf8');
    if (!/<html[^>]*\blang="ru"/i.test(html)) errors.push(`${f}: нет lang="ru" у <html>`);

    const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    const ogUrl = (html.match(/<meta property="og:url" content="([^"]+)"/) || [])[1];
    if (canonical && ogUrl && canonical !== ogUrl) errors.push(`${f}: og:url ≠ canonical`);
    if (canonical && !ogUrl) errors.push(`${f}: нет og:url`);

    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
    if (!title || !title.trim()) errors.push(`${f}: пустой <title>`);
    else if (titles.has(title)) errors.push(`${f}: <title> совпадает с ${titles.get(title)}`);
    else titles.set(title, f);

    if (f !== '404.html' && f !== 'offline.html') {
      const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
      if (!desc) errors.push(`${f}: нет meta description`);
      else if (desc.length < 50 || desc.length > 200) errors.push(`${f}: description ${desc.length} символов`);
      else if (descriptions.has(desc)) errors.push(`${f}: description совпадает с ${descriptions.get(desc)}`);
      else descriptions.set(desc, f);
    }
  }

  for (const loc of locs) {
    const rel = loc.replace(/^https:\/\/oge\.nayanovaacademy\.ru\/?/, '');
    const file = rel === '' ? 'oge.html' : rel;
    if (!existsSync(join(root, file))) errors.push(`sitemap.xml: ${loc} не существует (${file})`);
  }
}

// 12. Бюджет размера: страницы и общие ассеты не должны незаметно разрастаться.
const budgets = [
  { dir: '.', ext: '.html', max: 200 * 1024, label: 'HTML' },
  { dir: '.', ext: '.css', max: 120 * 1024, label: 'CSS' },
  { dir: 'js', ext: '.js', max: 80 * 1024, label: 'JS' },
];
for (const b of budgets) {
  for (const f of readdirSync(join(root, b.dir)).filter((x) => x.endsWith(b.ext))) {
    const size = statSync(join(root, b.dir, f)).size;
    if (size > b.max) {
      errors.push(`${b.dir === '.' ? '' : b.dir + '/'}${f}: ${Math.round(size / 1024)} КБ > бюджета ${Math.round(b.max / 1024)} КБ (${b.label})`);
    }
  }
}

if (errors.length) {
  console.error('Найдено проблем: ' + errors.length);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log(`OK: проверено ${htmlFiles.length} страниц, ссылки/ассеты/иконки/SEO корректны`);
