#!/usr/bin/env node
// Проверка внешних ссылок (не входит в CI: нужен интернет).
//
// Собирает все внешние href со страниц (кроме своего домена) и запрашивает
// их HEAD/GET. Полезно прогонять перед крупными обновлениями теории:
// ссылки на тренажёры sister-сайтов (office./python./vpr.) должны жить.
//
// Запуск: node tools/check-links.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ownHost = 'oge.nayanovaacademy.ru';

const links = new Map();
for (const f of fs.readdirSync(root).filter((x) => x.endsWith('.html')).sort()) {
  const html = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    const url = m[1];
    if (new URL(url).hostname === ownHost) continue;
    if (!links.has(url)) links.set(url, new Set());
    links.get(url).add(f);
  }
}

const errors = [];
let ok = 0;
for (const [url, pages] of links) {
  let status = 0;
  let err = '';
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'oge-web link check' },
    });
    status = r.status;
  } catch (e) {
    err = e.name || 'error';
  }
  const okStatus = status >= 200 && status < 400;
  if (okStatus) {
    ok++;
    console.log(`ok   ${status} ${url}`);
  } else {
    errors.push(`${url} → ${status || err} (${[...pages].join(', ')})`);
    console.log(`FAIL ${status || err} ${url}`);
  }
}

if (errors.length) {
  console.error(`\nБитых внешних ссылок: ${errors.length} из ${links.size}`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log(`\nOK: ${ok} внешних ссылок отвечают`);
