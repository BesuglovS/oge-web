#!/usr/bin/env node
// Интеграционный smoke-тест run_python.php: поднимает `php -S` и проверяет
// реальные POST-запросы (успех, числовой допуск, строки/комментарии,
// запрещённый импорт, timeout, GET 405).
// Запуск: node tools/check-sandbox.mjs   (нужен php и python 3)
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const php = process.env.PHP || 'php';
const port = 18000 + Math.floor(Math.random() * 900);
const base = `http://127.0.0.1:${port}`;
const useShell = process.platform === 'win32' && !/\.exe$/i.test(php);

let server = null;
const errors = [];

function stopServer() {
  if (!server) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      server.kill('SIGKILL');
    }
  } catch (e) { /* ignore */ }
  server = null;
}

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(base + '/oge.html', { signal: AbortSignal.timeout(1000) });
      if (r.ok) return;
    } catch (e) { /* not ready */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('php -S не поднялся на ' + base);
}

async function post(code, input, expected) {
  const body = new URLSearchParams({ code, test_input: input, expected_output: expected });
  const r = await fetch(base + '/run_python.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  try {
    return { status: r.status, data: JSON.parse(text) };
  } catch (e) {
    return { status: r.status, data: null, text };
  }
}

function expect(name, cond, detail) {
  if (!cond) {
    errors.push(name + (detail ? ': ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  } else {
    console.log('ok   ' + name);
  }
}

try {
  server = spawn(php, ['-S', `127.0.0.1:${port}`, '-t', root], {
    cwd: root,
    env: { ...process.env, SANDBOX_ALLOW_FALLBACK: '1' },
    stdio: 'ignore',
    shell: useShell,
  });
  server.on('error', (e) => { errors.push('php spawn: ' + e.message); });

  await waitForServer();

  const sum = await post('n=int(input())\ns=0\nfor i in range(n):\n    s+=int(input())\nprint(s)', '3\n1\n2\n3', '6');
  expect('сумма', sum.data && sum.data.matched === true, JSON.stringify(sum.data));

  const avg = await post("print('14.00')", '', '14');
  expect('числовой допуск 14.00≈14', avg.data && avg.data.matched === true, JSON.stringify(avg.data));

  const strOs = await post('print("os")', '', 'os');
  expect('строка "os" не блокируется', strOs.data && strOs.data.matched === true, JSON.stringify(strOs.data));

  const forbidden = await post('import os', '', 'x');
  expect('import os заблокирован', forbidden.data && /запрещ/.test(forbidden.data.error || ''), JSON.stringify(forbidden.data));

  const timeout = await post('while True:\n    pass', '', '1');
  expect('timeout 5 с', timeout.data && timeout.data.timeout === true, JSON.stringify(timeout.data));

  const get = await fetch(base + '/run_python.php', { signal: AbortSignal.timeout(5000) });
  expect('GET → 405', get.status === 405, 'status ' + get.status);
} catch (e) {
  errors.push(e.message);
} finally {
  stopServer();
}

if (errors.length) {
  console.error('\nОшибок: ' + errors.length);
  process.exit(1);
}
console.log('\nOK: песочница отвечает корректно');
