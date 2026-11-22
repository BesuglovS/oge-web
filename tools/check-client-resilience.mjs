#!/usr/bin/env node
// Регрессии клиентской надёжности, которые не покрывает браузерный smoke:
// outbox во время pending-запроса, видимость вкладки и атомарный precache SW.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function waitFor(predicate, label) {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return;
    await tick();
  }
  throw new Error('Таймаут: ' + label);
}

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
  };
}

async function testOutboxRace() {
  const key = 'audit-progress';
  const legacy = [{ course: 'oge', payload: { module: 'oge1', score: 1 }, queued_at: '2026-01-01T00:00:00Z' }];
  const localStorage = memoryStorage({ [key + ':outbox']: JSON.stringify(legacy) });
  let putRequest = null;
  let resolvePut = null;
  const putStarted = new Promise((resolve) => { putRequest = resolve; });
  const window = {
    localStorage,
    fetch(url, options = {}) {
      if (url.endsWith('/api/check.php')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ authenticated: true }) });
      }
      if (url.endsWith('/api/progress.php') && options.method === 'PUT') {
        const body = JSON.parse(options.body);
        putRequest(body);
        return new Promise((resolve) => { resolvePut = resolve; });
      }
      throw new Error('Неожиданный запрос: ' + url);
    },
  };
  const previous = global.window;
  global.window = window;
  const file = path.join(root, 'js/progress-client.js');
  delete require.cache[require.resolve(file)];
  const client = require(file);
  try {
    client.init({ apiBase: 'https://auth.example', storageKey: key });
    const flushed = client.flushOutbox();
    const sent = await Promise.race([
      putStarted,
      new Promise((_, reject) => setTimeout(() => reject(new Error('flush не отправил PUT; auth=' + JSON.stringify(client.getAuthState()) + '; outbox=' + localStorage.getItem(key + ':outbox'))), 2000)),
    ]);
    assert.equal('id' in sent.updates[0], false, 'служебный id не должен уходить в API');
    assert.equal('outbox_id' in sent.updates[0], false, 'служебный outbox_id не должен уходить в API');

    // Другая вкладка/запись добавляет более свежий результат того же модуля,
    // пока первый PUT ещё ожидает ответ.
    const during = JSON.parse(localStorage.getItem(key + ':outbox'));
    during.push({ course: 'oge', payload: { module: 'oge1', score: 2 }, queued_at: '2026-01-01T00:00:01Z' });
    localStorage.setItem(key + ':outbox', JSON.stringify(during));
    resolvePut({ ok: true, json: () => Promise.resolve({}) });
    await Promise.race([
      flushed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('flush не завершился')), 2000)),
    ]);

    const left = JSON.parse(localStorage.getItem(key + ':outbox') || '[]');
    assert.equal(left.length, 1, 'новая запись исчезла после подтверждения старой');
    assert.equal(left[0].payload.score, 2, 'сохраниться должна именно новая запись');
  } finally {
    delete require.cache[require.resolve(file)];
    if (previous === undefined) delete global.window; else global.window = previous;
  }
  console.log('ok   outbox сохраняет записи, добавленные во время flush');
}

async function testTrackingVisibility() {
  const source = fs.readFileSync(path.join(root, 'js/tracking-client.js'), 'utf8');
  let now = 1000000;
  let nextTimer = 1;
  const timers = new Map();
  const listeners = new Map();
  const posts = [];
  const beacons = [];
  const document = {
    readyState: 'loading', title: 'Тест', referrer: 'https://ref.example/path?secret=1#fragment',
    visibilityState: 'visible',
    addEventListener(type, fn) { listeners.set('doc:' + type, fn); },
    removeEventListener(type) { listeners.delete('doc:' + type); },
  };
  const location = {
    href: 'https://oge.example/oge1.html?mode=secret#answer', origin: 'https://oge.example',
    pathname: '/oge1.html', search: '?mode=secret', hash: '#answer',
  };
  const fetch = (url, options = {}) => {
    if (url.endsWith('/api/check.php')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ authenticated: true }) });
    }
    if (url.endsWith('/api/track.php')) {
      posts.push(JSON.parse(options.body));
      return Promise.resolve({ status: 200, ok: true });
    }
    throw new Error('Неожиданный URL: ' + url);
  };
  const navigator = {
    sendBeacon(url, blob) {
      beacons.push({ url, body: JSON.parse(blob.parts[0]) });
      return true;
    },
  };
  const window = {
    document, location, navigator, fetch,
    sessionStorage: memoryStorage(),
    history: { pushState() {}, replaceState() {} },
    addEventListener(type, fn) { listeners.set('win:' + type, fn); },
    removeEventListener(type) { listeners.delete('win:' + type); },
  };
  const context = vm.createContext({
    window, document, location, navigator, fetch, console,
    Date: { now: () => now }, Math, JSON, Promise, Object, Array, String, Number,
    Blob: class Blob { constructor(parts) { this.parts = parts; } },
    setInterval(fn) { const id = nextTimer++; timers.set(id, fn); return id; },
    clearInterval(id) { timers.delete(id); },
  });
  vm.runInContext(source, context, { filename: 'tracking-client.js' });
  window.NayanovaTrack.init({ apiBase: 'https://auth.example', interval: 30 });
  await waitFor(() => posts.length === 1 && timers.size === 1, 'первый heartbeat и таймер');
  assert.ok(!/[?#]/.test(posts[0].url), 'URL события содержит query/hash: ' + posts[0].url);
  assert.ok(!/secret|fragment/.test(posts[0].referrer), 'referrer не минимизирован');

  now += 60000;
  document.visibilityState = 'hidden';
  listeners.get('doc:visibilitychange')();
  assert.equal(timers.size, 0, 'таймер продолжает работать в скрытой вкладке');
  assert.equal(beacons.length, 1, 'при скрытии не отправлен финальный видимый интервал');

  now += 120000; // это время в фоне учитываться не должно
  document.visibilityState = 'visible';
  listeners.get('doc:visibilitychange')();
  assert.equal(timers.size, 1, 'при возвращении не запущен ровно один таймер');
  now += 30000;
  [...timers.values()][0]();
  await waitFor(() => posts.length === 2, 'heartbeat после возвращения');
  assert.equal(posts[1].duration, 30, 'в duration попало фоновое время');
  assert.equal(beacons.length, 1, 'обычный тик не должен дублироваться beacon');
  window.NayanovaTrack.stop();
  console.log('ok   трекинг учитывает только видимое время и не передаёт query/hash');
}

function swHarness(fetchImpl, cacheNames = []) {
  const source = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const listeners = {};
  const deleted = [];
  let skip = 0;
  const caches = {
    open() { return Promise.resolve({ put() { return Promise.resolve(); } }); },
    keys() { return Promise.resolve(cacheNames); },
    delete(name) { deleted.push(name); return Promise.resolve(true); },
  };
  const self = {
    location: { origin: 'https://oge.example' },
    clients: { claim() {} },
    addEventListener(type, fn) { listeners[type] = fn; },
    skipWaiting() { skip++; return Promise.resolve(); },
  };
  vm.runInNewContext(source, { self, caches, fetch: fetchImpl, URL, Promise }, { filename: 'sw.js' });
  return {
    listeners, deleted,
    skip: () => skip,
    fire(type) {
      let pending;
      listeners[type]({ waitUntil(p) { pending = p; } });
      return pending;
    },
  };
}

async function testServiceWorker() {
  const failed = swHarness((url) => Promise.resolve({ ok: !String(url).endsWith('/manifest.json'), status: 503 }));
  await assert.rejects(failed.fire('install'),
    'неполный precache не должен завершаться успешно');
  assert.equal(failed.skip(), 0, 'неполный SW не должен активироваться принудительно');

  const activated = swHarness(() => Promise.resolve({ ok: true }), ['oge-web-v36', 'other-application-cache']);
  await activated.fire('activate');
  assert.deepEqual(activated.deleted, ['oge-web-v36'], 'удалён чужой или не все свои кэши');
  console.log('ok   SW сохраняет прежний кэш при сбое и не удаляет чужие кэши');
}

await testOutboxRace();
await testTrackingVisibility();
await testServiceWorker();
console.log('OK: клиентские регрессии пройдены');
