#!/usr/bin/env node
// Браузерный smoke-тест: реальный Chrome, реальные страницы.
//
//   node tools/browser-smoke.mjs [http://127.0.0.1:8080]
//
// 1. Для интерактивных заданий 1–12: подставляет currentTask.answer в поле,
//    вызывает checkAnswer() и ждёт «Правильно». Проверяет, что цепочка
//    «задача → ввод → проверка» жива.
// 2. Задание 16: вставляет эталонное решение в редактор, вызывает runCode()
//    и ждёт таблицу результатов «Все тесты пройдены» (нужен PHP на BASE).
// 3. Задание 12: скачивает архив заданий 11/12 настоящим Chrome и проверяет
//    файл на диске (сигнатура, флаг UTF-8 у имён, распаковка записи по CRC32).
// 4. Собирает ошибки консоли и нарушения CSP по всем страницам.
//
// Нужен Chrome/Chromium (CHROME=путь) и запущенный сервер сайта на BASE.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';

const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error('Chrome/Chromium не найден (задайте CHROME=путь)');
  process.exit(1);
}

const base = (process.argv[2] || process.env.BASE || 'http://127.0.0.1:8080').replace(/\/$/, '');
if (typeof WebSocket === 'undefined') {
  console.error('Нужен Node 22+ (глобальный WebSocket для CDP)');
  process.exit(1);
}

// --csp: прогоняем всё через локальный прокси, который добавляет строгую CSP
// (script-src с хешами inline-скриптов, без 'unsafe-inline'). Так проверяется
// и работоспособность страниц под реальной политикой, и отсутствие нарушений.
let cspProxy = null;
let target = base;
if (process.argv.includes('--csp')) {
  const { buildPolicy } = await import('./csp-policy.mjs');
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
  const { policy, scriptHashes, styleHashes } = buildPolicy(rootDir);
  const http = await import('node:http');
  const proxyPort = 0;
  cspProxy = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const headers = Object.assign({}, req.headers);
      // undici не даёт выставлять hop-by-hop заголовки — выкидываем их.
      for (const h of ['host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'content-length']) {
        delete headers[h];
      }
      const upstream = await fetch(base + req.url, {
        method: req.method,
        headers,
        body: body.length ? body : undefined,
        redirect: 'manual',
      });
      const outHeaders = {};
      upstream.headers.forEach((v, k) => {
        if (['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) return;
        outHeaders[k] = v;
      });
      if ((upstream.headers.get('content-type') || '').includes('text/html')) {
        outHeaders['content-security-policy'] = policy;
      }
      res.writeHead(upstream.status, outHeaders);
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (e) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('proxy error: ' + e.message);
    }
  });
  await new Promise((r) => cspProxy.listen(proxyPort, '127.0.0.1', r));
  target = `http://127.0.0.1:${cspProxy.address().port}`;
  console.log(`CSP-прокси: ${target} (хеши inline-скриптов: ${scriptHashes.length}, стилей: ${styleHashes.length})`);
}
const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
let port = 0;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'oge-smoke-'));
const chromeArgs = ['--headless=new', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'];
// В CI контейнеры часто запускают Chrome без user-namespace — иначе он падает
// или зависает на старте (в логах «Failed to move to new namespace»).
if (process.env.CI || (typeof process.getuid === 'function' && process.getuid() === 0)) {
  chromeArgs.unshift('--no-sandbox', '--disable-setuid-sandbox');
}
const chrome = spawn(CHROME, chromeArgs, { stdio: 'ignore', detached: process.platform !== 'win32' });
const kill = () => {
  if (!chrome || !chrome.pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      // Chrome запущен отдельной группой — гасим её целиком, иначе его
      // дочерние процессы остаются жить и держат пайпы шага CI.
      process.kill(-chrome.pid, 'SIGKILL');
    }
  } catch (e) {
    try { chrome.kill('SIGKILL'); } catch (e2) { /* ignore */ }
  }
};
process.on('exit', () => { kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

// Chrome пишет фактический порт DevTools в <profile>/DevToolsActivePort.
const portFile = path.join(profile, 'DevToolsActivePort');
for (let i = 0; i < 200; i++) {
  try {
    const raw = fs.readFileSync(portFile, 'utf8').split('\n');
    const p = Number(raw[0]);
    if (p > 0) { port = p; break; }
  } catch (e) { /* ещё не создан */ }
  await sleep(100);
}
if (!port) throw new Error('Chrome не сообщил порт DevTools');

class Cdp {
  constructor(u) {
    this.ws = new WebSocket(u); this.id = 0; this.pending = new Map(); this.events = [];
    this.ready = new Promise((res) => this.ws.addEventListener('open', () => res()));
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
      } else if (m.method) this.events.push(m);
    });
  }
  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP timeout: ' + method));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }
  async evalJs(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

async function openPage(page) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
  const cdp = new Cdp(t.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));`,
  });
  await cdp.send('Page.navigate', { url: `${target}/${page}` });
  await sleep(1500);
  return { cdp, targetId: t.id };
}

/* ── ZIP без внешних зависимостей ────────────────────────────────────
   Скачанный архив разбираем сами: нужны флаги записей (UTF-8, bit 11)
   и содержимое — проверяем распаковку и CRC32. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Записи из central directory. Имя берём как UTF-8, если стоит флаг (bit 11)
// или байты чисто ASCII; иначе — best-effort UTF-8 (пакеры часто пишут UTF-8
// без флага, и тогда Проводник показывает кракозябры).
function zipEntries(buf) {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('не ZIP: нет сигнатуры PK\\x03\\x04');
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('не ZIP: нет EOCD');
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (cdOff + cdSize > buf.length) throw new Error('central directory выходит за файл');
  const entries = [];
  let p = cdOff;
  for (let k = 0; k < total; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('битый central directory');
    const flags = buf.readUInt16LE(p + 8);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const rawName = buf.subarray(p + 46, p + 46 + nameLen);
    const utf8Flag = (flags & 0x800) !== 0;
    const asciiOnly = rawName.every((b) => b < 0x80);
    entries.push({
      name: rawName.toString('utf8'),
      utf8Flag,
      asciiOnly,
      isDir: rawName.length > 0 && rawName[rawName.length - 1] === 0x2f, // «/»
      method: buf.readUInt16LE(p + 10),
      crc: buf.readUInt32LE(p + 16),
      csize: buf.readUInt32LE(p + 20),
      usize: buf.readUInt32LE(p + 24),
      localOff: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Данные записи: локальный заголовок → смещение данных → распаковка.
function zipEntryData(buf, e) {
  if (buf.readUInt32LE(e.localOff) !== 0x04034b50) throw new Error('битый local header');
  const start = e.localOff + 30 + buf.readUInt16LE(e.localOff + 26) + buf.readUInt16LE(e.localOff + 28);
  const raw = buf.subarray(start, start + e.csize);
  if (e.method === 0) return raw;
  if (e.method !== 8) throw new Error('неизвестный метод сжатия ' + e.method);
  return zlib.inflateRawSync(raw);
}

const results = [];
const errors = [];

const pages = fs.readdirSync(rootDir).filter((f) => f.endsWith('.html')).sort();

// 1. Все страницы: ошибки консоли и CSP.
for (const page of pages) {
  process.stdout.write('.');
  const { cdp, targetId } = await openPage(page);
  // Подсказка и решение генерируют разметку со style="…" уже после загрузки —
  // эти значения тоже должны быть в policy, иначе стили молча пропадут.
  await cdp.evalJs(`(() => {
    for (const act of ['showHint', 'showSolution']) {
      const el = document.querySelector('[data-act="' + act + '"]');
      if (el) el.click();
    }
    return true;
  })()`).catch(() => {});
  await sleep(300);
  const bad = cdp.events
    .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    // CORS локального портала ожидаем при проверке не на проде
    .filter((e) => !/auth\.nayanovaacademy\.ru/.test(String(e.params.entry.url || '')))
    .filter((e) => !/auth\.nayanovaacademy\.ru/.test(e.params.entry.text))
    .map((e) => e.params.entry.text);
  const exceptions = cdp.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails.text);
  const csp = await cdp.evalJs('JSON.stringify(window.__csp || [])').then((s) => JSON.parse(s || '[]'));
  if (bad.length || exceptions.length || csp.length) {
    errors.push(`${page}: ${[...bad, ...exceptions, ...csp.map((c) => 'CSP ' + c)].join(' | ')}`);
  }
  cdp.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`);
}

// 2. Ответы заданий 1–12 через настоящий checkAnswer().
for (const page of pages) {
  if (!/^oge\d+\.html$/.test(page) || /-t\.html$/.test(page)) continue;
  const { cdp, targetId } = await openPage(page);
  const ok = await cdp.evalJs(`(() => {
    const input = document.getElementById('answerInput');
    if (!input || typeof currentTask === 'undefined' || !currentTask) return 'skip';
    let answer = null;
    if (currentTask.answer !== undefined) answer = String(currentTask.answer);
    else if (typeof currentTask.word === 'string') answer = currentTask.word;
    else if (typeof getCorrectAnswer === 'function') {
      const a = getCorrectAnswer();
      if (a !== undefined && a !== null) answer = String(a);
    }
    if (answer === null) return 'skip';
    input.value = answer;
    const btn = document.querySelector('.btn-check');
    if (btn) {
      // Реальный клик: проверяет делегирование data-act (CSP без inline).
      btn.click();
    } else if (typeof checkAnswer === 'function') {
      checkAnswer();
    } else {
      return 'no-check';
    }
    const box = document.getElementById('result') || document.getElementById('feedback');
    const text = box ? (box.textContent || '') : '';
    return /равильн|оверно|✅/i.test(text) ? 'ok' : 'fail: ' + text.trim().slice(0, 60);
  })()`).catch((e) => 'error: ' + e.message);
  results.push(`${page}: ${ok}`);
  if (ok.startsWith('fail') || ok.startsWith('error') || ok === 'no-check') errors.push(`${page}: проверка ответа — ${ok}`);
  cdp.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`);
}

// 2b. Задание 7: собираем URL кликами по частям в правильном порядке.
{
  const { cdp, targetId } = await openPage('oge7.html');
  const res = await cdp.evalJs(`(() => {
    if (typeof currentTask === 'undefined' || !currentTask || !currentTask.correctUrl) return 'skip';
    const url = currentTask.correctUrl;
    const pool = document.getElementById('partsPool');
    if (!pool) return 'no-pool';
    let pos = 0;
    let guard = 0;
    while (pos < url.length && guard++ < 200) {
      // Самый длинный подходящий фрагмент: в пуле есть обманки-префиксы
      // (folder и folder1, info.doc и info.docx).
      const candidates = [...pool.querySelectorAll('.path-part')].filter((el) => url.startsWith(el.dataset.text, pos));
      if (!candidates.length) break;
      const part = candidates.reduce((best, el) => (el.dataset.text.length > best.dataset.text.length ? el : best), candidates[0]);
      part.click();
      pos += part.dataset.text.length;
    }
    if (pos !== url.length) return 'fail: собрано ' + pos + ' из ' + url.length;
    if (typeof checkAnswer !== 'function') return 'no-check';
    checkAnswer();
    const box = document.getElementById('feedback');
    const text = box ? (box.textContent || '') : '';
    return /равильн/i.test(text) ? 'ok' : 'fail: ' + text.trim().slice(0, 80);
  })()`).catch((e) => 'error: ' + e.message);
  results.push(`oge7.html (сборка URL): ${res}`);
  if (res !== 'ok' && !/skip|no-pool|no-check/.test(String(res))) errors.push(`oge7.html: сборка URL — ${res}`);
  cdp.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`);
}

// 2c. Задание 15: загрузка обстановки → эталонный .kum → запуск → проверка.
{
  const { cdp, targetId } = await openPage('oge15.html');
  const res = await cdp.evalJs(`(async () => {
    if (typeof loadCurrentTask !== 'function' || typeof runProgram !== 'function') return 'no-api';
    loadCurrentTask();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (typeof field !== 'undefined' && field.targetPainted && field.targetPainted.size > 0) break;
    }
    if (typeof field === 'undefined' || !field.targetPainted || field.targetPainted.size === 0) return 'fail: эталон не загрузился';
    const id = String(currentTaskId).padStart(2, '0');
    const kum = await fetch('files/oge15/oge-15-2026-' + id + '.kum').then((r) => (r.ok ? r.text() : Promise.reject(r.status)));
    document.getElementById('codeEditor').value = kum;
    stopAutoRun();
    runProgram();
    stopAutoRun();
    for (let i = 0; i < 60000 && interpreter && !interpreter.finished; i++) interpreter.step();
    if (!interpreter || !interpreter.finished) return 'fail: программа не завершилась';
    if (interpreter.error) return 'fail: ' + interpreter.error;
    checkProgram();
    if (field.rewarded) return 'ok';
    const logText = (document.getElementById('logArea') || {}).textContent || '';
    return 'fail: не зачтено — ' + logText.replace(/\\s+/g, ' ').trim().slice(-140);
  })()`).catch((e) => 'error: ' + e.message);
  results.push(`oge15.html (обстановка+эталон): ${String(res).slice(0, 170)}`);
  if (res !== 'ok' && !/no-api/.test(String(res))) errors.push(`oge15.html: e2e — ${res}`);
  cdp.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`);
}

// 2d. Задание 4-path: правка клетки через change-делегирование (data-act-change).
{
  const { cdp, targetId } = await openPage('oge4-path.html');
  const res = await cdp.evalJs(`(() => {
    if (typeof getMatrixData !== 'function') return 'no-api';
    const input = document.querySelector('td.editable input');
    if (!input) return 'no-input';
    input.value = '7';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const m = getMatrixData();
    const cellId = input.parentElement.id; // cell_i_j
    const mm = /^cell_(\\d+)_(\\d+)$/.exec(cellId);
    const got = mm ? m[Number(mm[1])][Number(mm[2])] : null;
    return got === 7 ? 'ok' : 'fail: в матрице ' + JSON.stringify(got);
  })()`).catch((e) => 'error: ' + e.message);
  results.push(`oge4-path.html (change): ${String(res).slice(0, 120)}`);
  if (res !== 'ok' && !/no-api|no-input/.test(String(res))) errors.push(`oge4-path.html: change — ${res}`);
  cdp.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`);
}

// 2e. Задание 2: клавиатура/клик по диаграмме Фано (data-act / data-act-key).
{
  const { cdp, targetId } = await openPage('oge2.html');
  const res = await cdp.evalJs(`(async () => {
    const el = document.querySelector('[data-act="toggleFano"]');
    if (!el) return 'skip';
    const before = el.getAttribute('aria-pressed') || el.className;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const after = el.getAttribute('aria-pressed') || el.className;
    return before !== after ? 'ok' : 'fail: состояние не изменилось';
  })()`).catch((e) => 'error: ' + e.message);
  results.push(`oge2.html (клавиатура Фано): ${String(res).slice(0, 120)}`);
  if (res !== 'ok' && !/skip/.test(String(res))) errors.push(`oge2.html: toggleFano — ${res}`);
  cdp.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`);
}

// 2g. Задание 14: движок формул — каждая эталонная формула даёт ответ задачи,
//     и ввод формулы в поле ответа зачитывается (а не только число).
{
  const { cdp, targetId } = await openPage('oge14.html');
  const res = await cdp.evalJs(`(() => {
    if (typeof evalTaskFormula !== 'function' || typeof tasks === 'undefined') return 'no-api';
    const bad = [];
    for (const t of tasks) {
      let v;
      try { v = evalTaskFormula(t.id); } catch (e) { bad.push(t.id + ': ' + ((e && e.code) || e.message)); continue; }
      if (typeof v !== 'number' || Math.abs(v - t.answer) > 1e-6) bad.push(t.id + ': ' + v + ' ≠ ' + t.answer);
    }
    const extra = [['=1+2*3', 7], ['=ЕСЛИ(1>2;10;20)', 20], ['=ОКРУГЛ(62,85;0)', 63], ['=2*(3+4)', 14]];
    for (const [src, want] of extra) {
      let v;
      try { v = evalFormula(src); } catch (e) { bad.push(src + ': ' + ((e && e.code) || e.message)); continue; }
      if (v !== want) bad.push(src + ' = ' + v + ', ожидалось ' + want);
    }
    if (bad.length) return 'fail: ' + bad.slice(0, 3).join('; ');

    const input = document.getElementById('answerInput');
    const btn = document.querySelector('.btn-check');
    if (!input || !btn) return 'no-ui';
    input.value = currentTask.formula;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const preview = (document.getElementById('formulaPreview') || {}).textContent || '';
    btn.click();
    const box = document.getElementById('result');
    const text = box ? (box.textContent || '') : '';
    if (!/равильн/i.test(text)) return 'fail: формула не зачтена — ' + text.trim().slice(0, 60);
    if (!/Значение формулы/.test(preview)) return 'fail: нет предпросмотра значения (' + preview.slice(0, 40) + ')';
    return 'ok: ' + tasks.length + ' формул, ввод формулы зачтен';
  })()`).catch((e) => 'error: ' + e.message);
  results.push(`oge14.html (движок формул): ${String(res).slice(0, 150)}`);
  if (!String(res).startsWith('ok') && !/no-api/.test(String(res))) errors.push(`oge14.html: формулы — ${res}`);
  cdp.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`);
}

// 2h. Задания 13.1/13.2: чек-листы — шаги проходятся только с верным ответом,
//     прогресс сохраняется после последнего шага.
for (const [page, taskId] of [['oge131.html', 'oge131'], ['oge132.html', 'oge132']]) {
  const { cdp, targetId } = await openPage(page);
  const expr = '(() => {' +
    'if (typeof steps === "undefined" || typeof checklistInit !== "function") return "no-api";' +
    'const next = () => document.querySelector(".cl-next");' +
    'const feedback = () => (document.getElementById("clFeedback") || {}).textContent || "";' +
    'const wrong = (steps[0].correct + 1) % steps[0].options.length;' +
    'document.querySelectorAll(".cl-option")[wrong].click();' +
    'if (!/Не совсем/.test(feedback())) return "fail: неверный ответ не отмечен";' +
    'if (!next() || !next().disabled) return "fail: неверный ответ разблокировал шаг";' +
    'for (let i = 0; i < steps.length; i++) {' +
    '  const opts = document.querySelectorAll(".cl-option");' +
    '  if (!opts[steps[i].correct]) return "fail: нет верного варианта на шаге " + (i + 1);' +
    '  opts[steps[i].correct].click();' +
    '  if (!/Верно/.test(feedback())) return "fail: шаг " + (i + 1) + " не принят — " + feedback().slice(0, 60);' +
    '  const btn = next();' +
    '  if (!btn || btn.disabled) return "fail: следующий шаг заблокирован на " + (i + 1);' +
    '  btn.click();' +
    '}' +
    'const body = document.getElementById("clBody");' +
    'if (!body || !/Чек-лист пройден/.test(body.textContent)) return "fail: нет финального экрана";' +
    'const progress = typeof OGEProgress !== "undefined" ? OGEProgress.get("' + taskId + '") : null;' +
    'if (!progress || progress.score !== steps.length) return "fail: прогресс не сохранён (" + JSON.stringify(progress) + ")";' +
    'return "ok: " + steps.length + " шагов, прогресс " + progress.score + "/" + progress.total;' +
    '})()';
  const res = await cdp.evalJs(expr).catch((e) => 'error: ' + e.message);
  results.push(`${page} (чек-лист): ${String(res).slice(0, 150)}`);
  if (!String(res).startsWith('ok') && !/no-api/.test(String(res))) errors.push(`${page}: чек-лист — ${res}`);
  cdp.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`);
}

// 2f. Задания 11/12: скачивание архива настоящим Chrome + проверка файла.
//     Ловит и мёртвую ссылку, и поломку UTF-8-флагов (Проводник покажет
//     кракозябры вместо «Классика/Проза»), и битые записи (CRC32).
{
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oge-dl-'));
  const { cdp, targetId } = await openPage('oge12.html');
  let res = 'error: шаг не выполнился';
  try {
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir, eventsEnabled: true });
    const href = await cdp.evalJs(`(() => {
      const a = document.querySelector('a.download-link[href$=".zip"]') || document.querySelector('a[href$=".zip"][download]');
      if (!a) return 'no-link';
      a.click();
      return decodeURIComponent(new URL(a.href).pathname.split('/').pop());
    })()`).catch((e) => 'error: ' + e.message);
    if (href === 'no-link') {
      res = 'no-link';
    } else if (String(href).startsWith('error')) {
      res = href;
    } else {
      // Chrome пишет файл как *.crdownload, пока качает; ждём готовый целиком.
      let file = null;
      for (let i = 0; i < 240 && !file; i++) {
        await sleep(250);
        const names = fs.readdirSync(dlDir);
        const done = names.filter((n) => !n.endsWith('.crdownload'));
        if (done.length !== 1 || names.length !== done.length) continue;
        const p = path.join(dlDir, done[0]);
        const size = fs.statSync(p).size;
        await sleep(200);
        if (size > 0 && fs.statSync(p).size === size) file = p;
      }
      if (!file) {
        res = 'fail: загрузка не завершилась';
      } else {
        const buf = fs.readFileSync(file);
        const entries = zipEntries(buf);
        const files = entries.filter((e) => !e.isDir);
        const noFlag = entries.filter((e) => !e.asciiOnly && !e.utf8Flag);
        const broken = entries.filter((e) => /[\uFFFD]/.test(e.name));
        const localPath = path.join(rootDir, 'files', href);
        const localSize = fs.existsSync(localPath) ? fs.statSync(localPath).size : -1;
        // Распаковка: .txt из «Классики» целиком + сверка размера и CRC32.
        let sample = null;
        let sampleErr = '';
        const e0 = files.find((e) => /\.txt$/.test(e.name) && e.name.startsWith('Классика/'));
        if (e0) {
          try {
            const data = zipEntryData(buf, e0);
            if (data.length !== e0.usize) sampleErr = `размер ${data.length} ≠ ${e0.usize}`;
            else if (crc32(data) !== e0.crc) sampleErr = 'CRC32 не совпал';
            else sample = e0.name;
          } catch (e) {
            sampleErr = e.message;
          }
        }
        const problems = [];
        if (!files.length) problems.push('в архиве нет файлов');
        if (!entries.some((e) => e.name.startsWith('Классика/'))) problems.push('нет каталога «Классика»');
        if (noFlag.length) problems.push(`имён без флага UTF-8: ${noFlag.length} (например, ${noFlag[0].name})`);
        if (broken.length) problems.push(`имён с битой кодировкой: ${broken.length}`);
        if (!e0) problems.push('не нашёл .txt для распаковки');
        if (!sample) problems.push('распаковка: ' + (sampleErr || 'не выполнена'));
        if (localSize < 0) problems.push(`локального файла files/${href} нет`);
        else if (localSize !== buf.length) problems.push(`скачано ${buf.length} байт, в репозитории ${localSize} (устаревший деплой?)`);
        res = problems.length
          ? 'fail: ' + problems.join('; ')
          : `ok: ${files.length} файлов, ${(buf.length / 1048576).toFixed(1)} МБ, UTF-8-флаги, распакован «${sample}»`;
      }
    }
  } finally {
    cdp.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`).catch(() => {});
    try { fs.rmSync(dlDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
  results.push(`oge12.html (скачивание архива): ${String(res).slice(0, 190)}`);
  if (!String(res).startsWith('ok')) errors.push(`oge12.html: архив 11/12 — ${res}`);
}

// 3. Задание 16: прогон эталонного решения через песочницу (если PHP доступен).
{
  const { cdp, targetId } = await openPage('oge16.html');
  const res = await cdp.evalJs(`(async () => {
    if (typeof task === 'undefined' || !task) return 'no-tasks';
    const t = task;
    const ed = document.getElementById('codeEditor');
    if (!ed) return 'no-editor';
    ed.value = t.solutionCode;
    const btn = document.getElementById('runBtn');
    if (btn) btn.disabled = false;
    if (typeof runCode !== 'function') return 'no-run';
    // Кликаем по кнопке: проверяем и делегирование data-act, и прогон.
    if (btn) btn.click();
    else runCode();
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const os = document.getElementById('outputSection');
      if (!os) continue;
      if (os.classList.contains('success')) return 'ok';
      if (os.classList.contains('error')) return 'fail: ' + (os.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
    }
    return 'timeout';
  })()`).catch((e) => 'error: ' + e.message);
  results.push(`oge16.html (прогон): ${String(res).slice(0, 160)}`);
  if (res !== 'ok' && !/no-tasks|no-editor|no-run/.test(String(res))) errors.push(`oge16.html: прогон — ${res}`);
  cdp.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`);
}

console.log('\nРезультаты:');
for (const r of results) console.log('  ' + r);
if (errors.length) {
  console.error(`\nПроблем: ${errors.length}`);
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log(`\nOK: ${pages.length} страниц без ошибок, ответы, архив и песочница работают`);
kill();
if (cspProxy) cspProxy.close();
process.exit(0);
