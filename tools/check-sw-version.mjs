#!/usr/bin/env node
/**
 * Проверка версии Service Worker без сборки.
 *
 * Если в changeset изменился файл, который входит в precache sw.js,
 * то CACHE_NAME обязан измениться. Иначе пользователи с cache-first
 * получат старый JS/CSS/HTML до ручного бампа.
 *
 * Запуск:
 *   node tools/check-sw-version.mjs            # локально: рабочее дерево vs HEAD
 *   node tools/check-sw-version.mjs <base-rev> # CI: git diff base HEAD
 *
 * В CI для push передаётся GITHUB_BEFORE, для PR — база после fetch.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] || '';

function git(args, allowFail = false) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    if (allowFail) return '';
    throw e;
  }
}

if (!fs.existsSync(path.join(root, '.git'))) {
  console.log('sw-version: .git не найден, проверка пропущена');
  process.exit(0);
}

function changedFiles() {
  if (base) {
    return git(['diff', '--name-only', base, 'HEAD']).split(/\r?\n/).filter(Boolean);
  }
  const tracked = git(['diff', '--name-only', 'HEAD']).split(/\r?\n/).filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/).filter(Boolean);
  return [...new Set([...tracked, ...untracked])];
}

function cacheName(source) {
  const m = source.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

const swNow = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const currentCache = cacheName(swNow);
if (!currentCache) {
  console.error('sw-version: в sw.js не найден CACHE_NAME');
  process.exit(1);
}

// Статический список ASSETS + генерируемые 40 файлов задания 15.
const assets = new Set();
for (const m of swNow.matchAll(/['"](\/[^'"]+)['"]/g)) {
  if (m[1] === '/') continue;
  assets.add(m[1]);
}
for (let i = 1; i <= 20; i++) {
  const n = String(i).padStart(2, '0');
  assets.add(`/files/oge15/oge-15-2026-${n}.json`);
  assets.add(`/files/oge15/oge-15-2026-e-${n}.json`);
}

const changed = changedFiles().map((f) => '/' + f.replace(/^[./]+/, '').replace(/\\/g, '/'));
if (!changed.length) {
  console.log('sw-version: изменений нет');
  process.exit(0);
}

const affected = changed.filter((f) => assets.has(f));
if (!affected.length) {
  console.log('sw-version: предкэшируемые файлы не менялись');
  process.exit(0);
}

// Сравниваем именно CACHE_NAME, а не факт правки sw.js: правка комментария
// в sw.js не должна считаться бампом.
let oldSource = '';
if (base) {
  oldSource = git(['show', `${base}:sw.js`], true);
} else {
  oldSource = git(['show', `HEAD:sw.js`], true);
}
const oldCache = oldSource ? cacheName(oldSource) : null;

if (oldCache && oldCache === currentCache) {
  console.error('sw-version: изменились предкэшируемые файлы, но CACHE_NAME не поднят:');
  for (const f of affected.slice(0, 20)) console.error('  - ' + f);
  console.error(`  CACHE_NAME=${currentCache}; поднимите версию в sw.js.`);
  process.exit(1);
}

console.log(`sw-version: OK (CACHE_NAME ${oldCache || '—'} → ${currentCache}); затронуто файлов: ${affected.length}`);
