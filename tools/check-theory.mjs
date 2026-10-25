#!/usr/bin/env node
// Проверка примеров кода в теории: примеры должны быть валидны.
//
// 1. Блоки Python (<div class="code-block">) компилируются через py_compile.
//    Из разметки убираются <br>, &nbsp; и теги; отступ исходника HTML
//    срезается по первой непустой строке.
// 2. Блоки КуМира (<div class="algo-block">) разбираются настоящим парсером
//    из oge15.html. Блоки с заглушками («условие», «последовательность
//    команд») пропускаются — это шаблоны, а не программы.
//
// Запуск: node tools/check-theory.mjs   (нужен python 3)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const errors = [];

// Разметка → текст. В блоках с <pre> переводы строк значимы, в остальных
// строками служат <br>, а реальные переводы строк — лишь форматирование HTML.
function unescape(s) {
  return s
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/<(?:\/?[a-zA-Z][^>]*|!--[\s\S]*?--)>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function dedent(code) {
  const lines = code.split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => (l.match(/^ */) || [''])[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join('\n').replace(/[ \t]+$/gm, '').trim();
}

function blockToText(block) {
  const pre = block.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (pre) {
    const code = pre[1].replace(/<br\s*\/?>/gi, '\n');
    return dedent(unescape(code));
  }
  const code = unescape(block.replace(/<br\s*\/?>/gi, '\u0001').replace(/\r?\n/g, ''))
    .replace(/\u0001/g, '\n');
  return dedent(code);
}

const htmlFiles = fs.readdirSync(root).filter((f) => f.endsWith('.html')).sort();
const blocksOf = (html, cls) => [...html.matchAll(new RegExp('<div class="' + cls + '">([\\s\\S]*?)</div>', 'g'))]
  .map((m) => m[1]);

/* ── 1. Python ── */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oge-theory-'));
let pyChecked = 0;
for (const f of htmlFiles) {
  const html = fs.readFileSync(path.join(root, f), 'utf8');
  const blocks = blocksOf(html, 'code-block');
  for (const [i, block] of blocks.entries()) {
    const code = blockToText(block);
    // Pascal-примеры не проверяем (компилятора нет), остальное — Python.
    if (/\b(begin|end\.|writeln|readln|var\s+\w+\s*:)/i.test(code)) continue;
    const looksLikeCode = /print\s*\(|input\s*\(|=|\bfor\s|\bwhile\s|\bif\s|\bdef\s/.test(code);
    if (!looksLikeCode) continue;
    const file = path.join(tmp, `${f}-${i}.py`);
    fs.writeFileSync(file, code + '\n', 'utf8');
    try {
      execFileSync(python, ['-c', 'import py_compile,sys; py_compile.compile(sys.argv[1], doraise=True)', file], {
        stdio: 'pipe',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
      pyChecked++;
    } catch (e) {
      const msg = String(e.stderr || e.message).split('\n').filter((l) => /Error|error/.test(l)).slice(-1)[0] || 'ошибка компиляции';
      errors.push(`${f}, блок Python #${i + 1}: ${msg.trim()}`);
    }
  }
}
fs.rmSync(tmp, { recursive: true, force: true });

/* ── 2. КуМир ── */
const trainer = fs.readFileSync(path.join(root, 'oge15.html'), 'utf8');
const slice = (from, to) => {
  const i = trainer.indexOf(from);
  const j = trainer.indexOf(to, i + 1);
  if (i < 0 || j < 0) throw new Error('не найден фрагмент парсера: ' + from);
  return trainer.slice(i, j);
};
const sb = { console };
vm.createContext(sb);
vm.runInContext(
  slice('function lex(code) {', 'class Parser {') + '\n' +
  slice('class Parser {', '// 5. INTERPRETER') +
  '\n; globalThis.__lex = lex; globalThis.__Parser = Parser;',
  sb
);

const placeholders = /условие|последовательность|команды|команда/i;
let kumirChecked = 0;
let kumirSkipped = 0;
for (const f of htmlFiles) {
  const html = fs.readFileSync(path.join(root, f), 'utf8');
  const blocks = blocksOf(html, 'algo-block');
  for (const [i, block] of blocks.entries()) {
    const code = blockToText(block);
    if (!/нц/i.test(code) || placeholders.test(code)) { kumirSkipped++; continue; }
    try {
      new sb.__Parser(sb.__lex(code)).parseProgram();
      kumirChecked++;
    } catch (e) {
      errors.push(`${f}, блок КуМира #${i + 1}: ${e.message}`);
    }
  }
}

if (errors.length) {
  console.error('Найдено проблем: ' + errors.length);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log(`OK: примеры кода валидны (Python: ${pyChecked}, КуМир: ${kumirChecked}, пропущено шаблонов: ${kumirSkipped})`);
