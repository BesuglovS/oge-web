#!/usr/bin/env node
// Проверка ответов задания 11 по содержимому архива files/Задание11-12.zip.
//
// Для каждой задачи из oge11.html: берём папку и файл произведения из
// подсказки, ищем в тексте файла ответ и ключевые слова из подсказки.
// Поддерживаются .txt/.htm/.html (UTF-8 и CP1251), .rtf (\\'hh-эскейпы)
// и .docx (word/document.xml). Задачи, для которых есть только .pdf,
// помечаются как «не проверено» (извлечение текста из PDF не делаем).
//
// Запуск: node tools/check-oge11-archive.mjs
// Нужен python 3 (распаковка архива через `python -m zipfile -e`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zip = path.join(root, 'files', 'Задание11-12.zip');
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

if (!fs.existsSync(zip)) {
  console.error('нет файла ' + path.relative(root, zip));
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oge11-'));
const cleanup = () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ } };
process.on('exit', cleanup);

const unzip = spawnSync(python, ['-m', 'zipfile', '-e', zip, tmp], { stdio: 'ignore' });
if (unzip.status !== 0) {
  console.error('не удалось распаковать архив (нужен python 3)');
  process.exit(1);
}

/* ── декодирование ── */
const rtfText = (src) => {
  const bytes = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      const next = src[i + 1];
      if (next === "'") { bytes.push(parseInt(src.substr(i + 2, 2), 16)); i += 4; continue; }
      if (next === 'u') {
        const m = /^\\u(-?\d+)\s?\??/.exec(src.slice(i));
        if (m) {
          let code = Number(m[1]);
          if (code < 0) code += 65536;
          for (const b of Buffer.from(String.fromCharCode(code), 'utf8')) bytes.push(b);
          i += m[0].length;
          continue;
        }
      }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i));
      if (m) { i += m[0].length; continue; }
      i += 2;
      continue;
    }
    if (ch === '{' || ch === '}') { i++; continue; }
    bytes.push(ch.charCodeAt(0) & 0xff);
    i++;
  }
  return new TextDecoder('windows-1251').decode(Uint8Array.from(bytes));
};

const decodeText = (file) => {
  const buf = fs.readFileSync(file);
  if (/\.rtf$/i.test(file)) return rtfText(buf.toString('latin1'));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) { return new TextDecoder('windows-1251').decode(buf); }
};

const docxText = (file) => {
  const r = spawnSync(python, ['-c', [
    'import re,sys,zipfile',
    'z=zipfile.ZipFile(sys.argv[1])',
    'x=z.read("word/document.xml").decode("utf-8","replace")',
    'print(re.sub(r"<[^>]+>"," ",x))',
  ].join(';'), file], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // Без этого Python на Windows печатает кириллицу в cp1251/cp866.
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  return r.status === 0 ? r.stdout : '';
};

/* ── корпус ── */
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(tmp);

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');
const docs = [];
let pdfOnly = 0;
for (const f of files) {
  const ext = path.extname(f).toLowerCase();
  if (ext === '.pdf') { pdfOnly++; continue; }
  if (!/\.(txt|htm|html|rtf|docx)$/.test(ext)) continue;
  const text = ext === '.docx' ? docxText(f) : decodeText(f);
  docs.push({
    name: path.relative(tmp, f),
    base: norm(path.basename(f, ext)),
    dir: norm(path.dirname(path.relative(tmp, f))),
    text: norm(text).replace(/<[^>]+>/g, ' '),
  });
}

/* ── задачи ── */
const html = fs.readFileSync(path.join(root, 'oge11.html'), 'utf8');
const i = html.indexOf('const tasks = [');
const j = html.indexOf('];', i);
if (i < 0 || j < 0) {
  console.error('не найден массив задач в oge11.html');
  process.exit(1);
}
const sb = {};
vm.runInNewContext(html.slice(i, j + 2) + ';this.t=tasks;', sb);
const tasks = sb.t;

const stem = (w) => {
  const s = norm(w).replace(/[^a-zа-я0-9 -]/g, '');
  return s.length > 4 ? s.slice(0, s.length - 1) : s;
};

const errors = [];
const skipped = [];
for (const t of tasks) {
  const answer = String(t.answer);
  const hint = String(t.hint || '');
  const quoted = [...hint.matchAll(/«([^»]{2,60})»/g)].map((m) => m[1].trim());
  const dirHint = norm((hint.match(/папку\s*<strong>([^<]+)<\/strong>/i) || [, ''])[1].replace(/\//g, '\\'));

  let scope = docs;
  if (dirHint) scope = docs.filter((d) => d.dir.endsWith(dirHint));
  const fileName = quoted.find((q) => scope.some((d) => d.base === norm(q)));
  if (fileName) scope = scope.filter((d) => d.base === norm(fileName));
  const keywords = quoted.filter((q) => q !== fileName && q.length > 2);

  if (!scope.length) {
    skipped.push(`задание ${t.id} («${answer}»): в папке ${dirHint || '—'} только PDF — текста для проверки нет`);
    continue;
  }
  const ans = stem(answer);
  const withAnswer = scope.filter((d) => d.text.includes(ans));
  if (!withAnswer.length) {
    errors.push(`задание ${t.id}: ответ «${answer}» не найден в ${scope.map((d) => d.name).join(', ')}`);
    continue;
  }
  if (keywords.length) {
    const withKeys = withAnswer.filter((d) => keywords.some((k) => d.text.includes(stem(k))));
    if (!withKeys.length) {
      errors.push(`задание ${t.id}: ответ «${answer}» есть, но рядом нет ключевых слов (${keywords.join(', ')})`);
    }
  }
}

if (skipped.length) {
  console.log('Пропущено (только PDF):');
  for (const s of skipped) console.log(' - ' + s);
}
if (errors.length) {
  console.error('\nПроблем: ' + errors.length + ' из ' + tasks.length);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log(`\nOK: ответы задания 11 подтверждены по архиву (${tasks.length} задач, документов: ${docs.length})`);
