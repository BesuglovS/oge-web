#!/usr/bin/env node
/**
 * Регрессии моста прогресса: js/progress-sync.js + js/progress-client.js.
 *
 * Покрывают дефекты, которые не ловил браузерный smoke:
 *  - buildUpdates не должен падать на необъявленной localDone (D1);
 *  - outbox должен удалять ВСЕ подтверждённые записи модуля (D2);
 *  - legacy-время SQLite 'YYYY-MM-DD HH:MM:SS' трактуется как UTC (D4);
 *  - серверный маркер __reset__ очищает локальные записи, зеркало и outbox;
 *  - unavailable не отправляет локальные данные как свежие.
 *
 * Запуск: node tools/check-progress-sync.mjs
 * В CI — с TZ=Europe/Samara, чтобы поймать локальную трактовку legacy-времени.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SYNC_CODE = fs.readFileSync(path.join(root, 'js/progress-sync.js'), 'utf8');
const CLIENT_CODE = fs.readFileSync(path.join(root, 'js/progress-client.js'), 'utf8');

// Тест на legacy-время имеет смысл только в ненулевой зоне.
process.env.TZ = process.env.TZ || 'Europe/Samara';

const TASKS = [
  'oge1', 'oge2', 'oge3', 'oge4', 'oge5', 'oge6', 'oge7', 'oge8', 'oge9',
  'oge10', 'oge11', 'oge12', 'oge131', 'oge132', 'oge14', 'oge15', 'oge16'
];

function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    key(index) { return [...data.keys()][index] ?? null; },
    get length() { return data.size; },
    _data: data
  };
}

async function settle() {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function makeSyncSandbox(opts = {}) {
  const store = storage({
    'oge-progress': JSON.stringify(opts.progress || {}),
    'nayanova-progress': JSON.stringify(opts.mirror || {}),
    'nayanova-progress:outbox': JSON.stringify(opts.outbox || []),
    ...(opts.extra || {})
  });
  const calls = { batch: [], render: 0 };
  const sandbox = {
    console,
    Date,
    JSON,
    Object,
    Array,
    Math,
    Number,
    String,
    isNaN,
    localStorage: store,
    setTimeout() { return 0; },
    clearTimeout() {},
    document: {
      readyState: 'complete',
      visibilityState: 'visible',
      addEventListener() {},
      dispatchEvent() {}
    },
    OGEProgress: {
      tasks: TASKS,
      renderProgressBar() { calls.render++; }
    },
    NayanovaProgress: {
      init() {},
      getCourse() {
        return Promise.resolve({
          unavailable: !!opts.unavailable,
          server: opts.server || {},
          progress: opts.server || {}
        });
      },
      setBatch(updates) {
        calls.batch.push(updates);
        return Promise.resolve();
      }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SYNC_CODE, sandbox);
  return { store, calls };
}

function makeClientSandbox(opts = {}) {
  const store = storage(opts.storage || {});
  const requests = [];
  const sandbox = {
    console,
    Date,
    JSON,
    Object,
    Array,
    Math,
    Number,
    String,
    isNaN,
    Promise,
    localStorage: store,
    setTimeout() { return 0; },
    clearTimeout() {},
    document: {
      readyState: 'complete',
      visibilityState: 'visible',
      addEventListener() {}
    },
    addEventListener() {},
    fetch(url, options) {
      requests.push({ url: String(url), options: options || {} });
      if (String(url).indexOf('/api/check.php') !== -1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(opts.auth || { authenticated: true })
        });
      }
      if (String(url).indexOf('/api/progress.php') !== -1 && options && options.method === 'PUT') {
        if (opts.onPut) opts.onPut(store);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true })
        });
      }
      if (String(url).indexOf('/api/progress.php') !== -1 && options && options.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true })
        });
      }
      if (String(url).indexOf('/api/progress.php') !== -1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(opts.getCourse || { progress: {}, stats: null })
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({})
      });
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CLIENT_CODE, sandbox);
  return { store, requests, api: sandbox.NayanovaProgress };
}

test('D1: локальный прогресс уходит одним setBatch и без ReferenceError', async () => {
  const { calls } = makeSyncSandbox({
    progress: {
      oge1: { score: 1, bestScore: 1, attempts: 1, total: 1, lastAttempt: '2026-11-22T11:00:00.000Z' }
    },
    server: {}
  });
  await settle();

  assert.equal(calls.batch.length, 1, 'setBatch должен быть вызван ровно один раз');
  const updates = calls.batch[0];
  const task = updates.find((u) => u.module === 'oge1');
  const summary = updates.find((u) => u.module === '__summary__');
  assert.ok(task, 'в updates есть oge1');
  assert.equal(task.completed, 1);
  assert.equal(task.updated_at, '2026-11-22T11:00:00.000Z');
  assert.ok(summary, 'в updates есть __summary__');
  assert.equal(summary.data.completed, 1);
  assert.equal(summary.data.total, 16);
});

test('D4: серверное legacy-время новее локального — update не отправляется', async () => {
  const { calls } = makeSyncSandbox({
    progress: {
      oge1: { score: 1, bestScore: 1, attempts: 1, total: 1, lastAttempt: '2026-11-22T11:00:00.000Z' }
    },
    server: {
      oge1: {
        completed: 1,
        score: 1,
        data: { score: 1, bestScore: 1 },
        updated_at: '2026-11-22 12:00:00'
      }
    }
  });
  await settle();

  assert.equal(calls.batch.length, 0, 'устаревшая локальная запись не должна отправляться');
});

test('13.1 и 13.2 считаются одним экзаменационным слотом', async () => {
  const { calls } = makeSyncSandbox({
    progress: {
      oge131: { score: 12, bestScore: 12, attempts: 1, total: 12, lastAttempt: '2026-11-22T11:00:00.000Z' },
      oge132: { score: 13, bestScore: 13, attempts: 1, total: 13, lastAttempt: '2026-11-22T11:01:00.000Z' }
    },
    server: {}
  });
  await settle();

  assert.equal(calls.batch.length, 1);
  const summary = calls.batch[0].find((u) => u.module === '__summary__');
  assert.equal(summary.data.completed, 1);
  assert.equal(summary.data.total, 16);
});

test('__reset__ очищает oge-progress, зеркало и старый outbox, но не новый', async () => {
  const resetAt = '2026-11-22T12:00:00Z';
  const { store, calls } = makeSyncSandbox({
    progress: {
      oge1: { score: 1, bestScore: 1, attempts: 1, total: 1, lastAttempt: '2026-11-22T11:00:00.000Z' }
    },
    mirror: {
      oge: {
        oge1: { completed: 1, score: 1, updated_at: '2026-11-22T11:00:00Z' },
        __summary__: { completed: 1, updated_at: '2026-11-22T11:00:00Z' }
      }
    },
    outbox: [
      { course: 'oge', payload: { module: 'oge1', updated_at: '2026-11-22T11:00:00Z' } },
      { course: 'oge', payload: { module: 'oge2', updated_at: '2026-11-22T13:00:00Z' } },
      { course: 'other', payload: { module: 'x' } }
    ],
    extra: { 'oge-checklist:oge131': JSON.stringify({ index: 3, done: [0, 1, 2] }) },
    server: { __reset__: { completed: 0, updated_at: resetAt } }
  });
  await settle();

  const progress = JSON.parse(store.getItem('oge-progress'));
  assert.deepEqual(progress, {}, 'локальный прогресс старше маркера удалён');
  const mirror = JSON.parse(store.getItem('nayanova-progress')).oge;
  assert.equal(mirror.oge1, undefined, 'зеркало не хранит старый модуль');
  assert.equal(mirror.__summary__, undefined, 'старая сводка удалена из зеркала');
  const outbox = JSON.parse(store.getItem('nayanova-progress:outbox'));
  assert.equal(outbox.length, 2, 'старый oge-outbox удалён, новый и чужой курс остались');
  assert.equal(outbox.some((i) => i.payload.module === 'oge2'), true);
  assert.equal(outbox.some((i) => i.course === 'other'), true);
  assert.equal(store.getItem('oge-checklist:oge131'), null, 'черновик чек-листа удалён');
  assert.equal(calls.batch.length, 0, 'после сброса отправлять нечего');
});

test('__reset__ удаляет запись с «убежавшими» часами', async () => {
  const resetAt = '2026-11-22T12:00:00Z';
  const { store } = makeSyncSandbox({
    progress: {
      oge1: { score: 1, bestScore: 1, lastAttempt: '2027-01-01T00:00:00.000Z' }
    },
    server: { __reset__: { updated_at: resetAt } }
  });
  await settle();
  assert.deepEqual(JSON.parse(store.getItem('oge-progress')), {});
});

test('unavailable: локальные данные не отправляются', async () => {
  const { calls } = makeSyncSandbox({
    progress: { oge1: { score: 1, bestScore: 1, lastAttempt: '2026-11-22T11:00:00.000Z' } },
    server: {},
    unavailable: true
  });
  await settle();
  assert.equal(calls.batch.length, 0);
});

test('D2: после flush очередь пуста при двух записях одного модуля', async () => {
  const { store, api, requests } = makeClientSandbox({
    storage: {
      'nayanova-progress:outbox': JSON.stringify([
        { outbox_id: 'a', course: 'oge', payload: { module: 'oge1', score: 1, updated_at: '2026-11-22T11:00:00Z' } },
        { outbox_id: 'b', course: 'oge', payload: { module: 'oge1', score: 2, updated_at: '2026-11-22T11:01:00Z' } }
      ])
    }
  });
  api.init({ course: 'oge' });
  const sent = await api.flushOutbox();
  await settle();

  assert.equal(sent, 1, 'отправлен один смерженный payload');
  assert.deepEqual(JSON.parse(store.getItem('nayanova-progress:outbox')), [], 'очередь осушилась');
  const puts = requests.filter((r) => r.options.method === 'PUT');
  assert.equal(puts.length, 1);
  const body = JSON.parse(puts[0].options.body);
  assert.equal(body.updates.length, 1);
  assert.equal(body.updates[0].score, 2, 'побеждает последний payload');
});

test('D2: запись, добавленная во время PUT, не теряется', async () => {
  const { store, api } = makeClientSandbox({
    storage: {
      'nayanova-progress:outbox': JSON.stringify([
        { outbox_id: 'a', course: 'oge', payload: { module: 'oge1', score: 1, updated_at: '2026-11-22T11:00:00Z' } }
      ])
    },
    onPut(store) {
      const list = JSON.parse(store.getItem('nayanova-progress:outbox'));
      list.push({
        outbox_id: 'late',
        course: 'oge',
        payload: { module: 'oge2', score: 1, updated_at: '2026-11-22T11:02:00Z' }
      });
      store.setItem('nayanova-progress:outbox', JSON.stringify(list));
    }
  });
  api.init({ course: 'oge' });
  await api.flushOutbox();
  await settle();

  const left = JSON.parse(store.getItem('nayanova-progress:outbox'));
  assert.equal(left.length, 1);
  assert.equal(left[0].outbox_id, 'late');
});

test('resetCourse шлёт POST ?action=reset с курсом', async () => {
  const { api, requests } = makeClientSandbox();
  api.init({ course: 'oge' });
  await api.resetCourse('oge');

  const reset = requests.find((r) => r.url.indexOf('action=reset') !== -1);
  assert.ok(reset, 'запрос сброса отправлен');
  assert.equal(reset.options.method, 'POST');
  assert.deepEqual(JSON.parse(reset.options.body), { course: 'oge' });
});

test('getCourse не воскрешает локальные модули старше __reset__', async () => {
  const { store, api } = makeClientSandbox({
    storage: {
      'nayanova-progress': JSON.stringify({
        oge: {
          oge1: { completed: 1, score: 1, updated_at: '2026-11-22T11:00:00Z' },
          __summary__: { completed: 1, updated_at: '2026-11-22T11:00:00Z' }
        }
      })
    },
    getCourse: {
      progress: { __reset__: { completed: 0, updated_at: '2026-11-22T12:00:00Z' } },
      stats: { total: 0, completed: 0, percentage: 0 }
    }
  });
  api.init({ course: 'oge' });
  const res = await api.getCourse('oge');

  assert.equal(res.progress.oge1, undefined, 'старый модуль не попал в merged progress');
  assert.equal(res.progress.__summary__, undefined, 'старая сводка не попала в merged progress');
  const mirror = JSON.parse(store.getItem('nayanova-progress')).oge;
  assert.equal(mirror.oge1, undefined, 'зеркало очищено');
});

console.log('check-progress-sync: запуск тестов завершён');
