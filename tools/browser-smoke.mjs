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
// 3. Собирает ошибки консоли и нарушения CSP по всем страницам.
//
// Нужен Chrome/Chromium (CHROME=путь) и запущенный сервер сайта на BASE.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  const { policy, hashes } = buildPolicy(rootDir);
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
  console.log(`CSP-прокси: ${target} (хешей inline-скриптов: ${hashes.length})`);
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

const results = [];
const errors = [];

const pages = fs.readdirSync(rootDir).filter((f) => f.endsWith('.html')).sort();

// 1. Все страницы: ошибки консоли и CSP.
for (const page of pages) {
  process.stdout.write('.');
  const { cdp, targetId } = await openPage(page);
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
      const part = [...pool.querySelectorAll('.path-part')].find((el) => url.startsWith(el.dataset.text, pos));
      if (!part) break;
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
console.log(`\nOK: ${pages.length} страниц без ошибок, ответы и песочница работают`);
kill();
if (cspProxy) cspProxy.close();
process.exit(0);
