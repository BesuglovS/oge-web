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

  /* ── Пакетный режим ── */
  const batch = async (code, tests) => {
    const body = new URLSearchParams({ code, tests: JSON.stringify(tests) });
    const r = await fetch(base + '/run_python.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(60000),
    });
    const text = await r.text();
    try {
      return { status: r.status, data: JSON.parse(text) };
    } catch (e) {
      return { status: r.status, data: null, text };
    }
  };

  const b1 = await batch('print(int(input()) * 2)', [
    { input: '5', expected: '10' },
    { input: '7', expected: '14' },
    { input: '0', expected: '0' },
  ]);
  expect('пакет: 3 теста пройдены', b1.data && b1.data.passed === 3 && b1.data.total === 3, JSON.stringify(b1.data));

  const b2 = await batch("print('14.00')", [{ input: '', expected: '14' }]);
  expect('пакет: числовой допуск', b2.data && b2.data.results[0].matched === true, JSON.stringify(b2.data));

  const b3 = await batch('print(int(input()) + 1)', [
    { input: '1', expected: '2' },
    { input: '2', expected: '999' },
    { input: '3', expected: '4' },
  ]);
  expect('пакет: частичный провал', b3.data && b3.data.passed === 2 && b3.data.results[1].matched === false, JSON.stringify(b3.data));

  const b4 = await batch('while True:\n    pass', [
    { input: '', expected: '1' },
    { input: '', expected: '2' },
  ]);
  expect(
    'пакет: timeout останавливает прогон',
    b4.data && b4.data.results[0].timeout === true && b4.data.results[1].skipped === true,
    JSON.stringify(b4.data),
  );

  const b5 = await batch('raise ValueError("boom")', [
    { input: '', expected: '1' },
    { input: '', expected: '2' },
  ]);
  expect(
    'пакет: ошибка программы останавливает прогон',
    b5.data && /boom/.test(b5.data.results[0].error || '') && b5.data.results[1].skipped === true,
    JSON.stringify(b5.data),
  );

  const b6 = await batch('import os', [{ input: '', expected: '1' }]);
  expect('пакет: запрещённый импорт отклонён', b6.data && /запрещ/.test(b6.data.error || ''), JSON.stringify(b6.data));

  const many = Array.from({ length: 13 }, () => ({ input: '1', expected: '1' }));
  const b7 = await batch('print(1)', many);
  expect('пакет: больше 12 тестов → 400', b7.status === 400 && /много тестов/i.test(b7.data.error || ''), JSON.stringify(b7.data));

  const b8 = await batch('print(1)', []);
  expect('пакет: пустой список → 400', b8.status === 400, JSON.stringify(b8.data));

  const b9 = await batch('print(1)', [{ input: 'x' }]);
  expect('пакет: тест без expected → 400', b9.status === 400, JSON.stringify(b9.data));
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
