#!/usr/bin/env node
// Обновляет <lastmod> в sitemap.xml по дате последнего коммита каждой страницы.
//
//   node tools/update-sitemap.mjs            # записать
//   node tools/update-sitemap.mjs --check    # только проверить (для CI)
//
// Дата берётся из `git log -1 --format=%cs -- <файл>`; корень сайта
// соответствует oge.html. Так lastmod отражает реальные правки, а не дату
// создания файла.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sitemapPath = path.join(root, 'sitemap.xml');
const checkOnly = process.argv.includes('--check');

if (!fs.existsSync(path.join(root, '.git'))) {
  console.log('sitemap: .git не найден, проверка lastmod пропущена');
  process.exit(0);
}

const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const today = new Date().toISOString().slice(0, 10);
const isDirty = (file) => {
  try {
    return git(['status', '--porcelain', '--', file]) !== '';
  } catch (e) {
    return false;
  }
};

const gitDate = (file) => {
  // Файл изменён, но ещё не закоммичен — считаем датой сегодняшний день:
  // так порядок «правки → update-sitemap → commit» даёт сходящийся lastmod.
  if (isDirty(file)) return today;
  try {
    return git(['log', '-1', '--format=%cs', '--', file]);
  } catch (e) {
    return '';
  }
};

const source = fs.readFileSync(sitemapPath, 'utf8');
const mismatches = [];
let updated = 0;

const out = source.replace(/<url><loc>([^<]+)<\/loc><lastmod>([^<]*)<\/lastmod>/g, (m, loc, oldDate) => {
  const rel = loc.replace(/^https:\/\/oge\.nayanovaacademy\.ru\/?/, '');
  const file = rel === '' ? 'oge.html' : rel;
  if (!fs.existsSync(path.join(root, file))) return m; // отсутствие файла ловит check-site
  const date = gitDate(file);
  if (!date) return m;
  if (date !== oldDate) {
    updated++;
    mismatches.push(`${file}: ${oldDate} → ${date}`);
    return m.replace(`<lastmod>${oldDate}</lastmod>`, `<lastmod>${date}</lastmod>`);
  }
  return m;
});

if (checkOnly) {
  if (updated) {
    console.error(`sitemap.xml: устаревших lastmod ${updated} (запустите node tools/update-sitemap.mjs)`);
    for (const line of mismatches.slice(0, 10)) console.error(' - ' + line);
    process.exit(1);
  }
  console.log('sitemap.xml: lastmod совпадает с датами коммитов');
} else if (updated) {
  fs.writeFileSync(sitemapPath, out, 'utf8');
  console.log(`sitemap.xml: обновлено lastmod ${updated}`);
  for (const line of mismatches) console.log('  ' + line);
} else {
  console.log('sitemap.xml: изменений нет');
}
