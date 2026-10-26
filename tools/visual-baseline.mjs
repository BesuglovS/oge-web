// Снимок вычисленных стилей всех элементов страниц (визуальный baseline).
// Запуск: node tools/visual-baseline.mjs <out.json>   (нужен Chrome)
// Используется при рискованных правках CSS: снимок до/после должен совпасть.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const CHROME_CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.error('Chrome/Chromium не найден (задайте CHROME=путь)');
  process.exit(1);
}

const args = process.argv.slice(2);
const shotsIdx = args.indexOf('--shots');
const shotsDir = shotsIdx >= 0 ? args[shotsIdx + 1] : '';
const positional = args.filter((a, i) => !a.startsWith('--') && (shotsIdx < 0 || i !== shotsIdx + 1));
const outFile = positional[0];
if (!outFile) {
  console.error('Укажите файл: node tools/visual-baseline.mjs baseline.json [--shots папка]');
  process.exit(1);
}
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const base = process.env.BASE || 'http://127.0.0.1:8080';
const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const pages = fs.readdirSync(rootDir).filter((f) => f.endsWith('.html')).sort();
const viewports = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844, mobile: true },
];

const port = 9400 + Math.floor(Math.random() * 300);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'oge-visual-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const kill = () => {
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
    else chrome.kill('SIGKILL');
  } catch (e) { /* ignore */ }
};
const cleanup = () => { kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ } };
process.on('exit', cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitChrome() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return;
    } catch (e) { /* not ready */ }
    await sleep(150);
  }
  throw new Error('Chrome не запустился');
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((res) => this.ws.addEventListener('open', () => res()));
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

// Собираем подпись стилей всех элементов: путь в DOM + значения свойств.
const COLLECT = `(() => {
  const props = ['display','position','width','height','margin-top','margin-right','margin-bottom','margin-left',
    'padding-top','padding-right','padding-bottom','padding-left','font-size','font-weight','line-height','color',
    'background-color','background-image','border-top-width','border-right-width','border-bottom-width','border-left-width',
    'border-top-color','border-radius','flex-direction','flex-wrap','justify-content','align-items','grid-template-columns',
    'gap','text-align','overflow-x','overflow-y','opacity','visibility','z-index','transform','box-shadow','white-space'];
  const out = {};
  const walk = (el, prefix) => {
    const idx = {};
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase();
      idx[tag] = (idx[tag] || 0) + 1;
      const key = prefix + '/' + tag + '[' + idx[tag] + ']';
      const cs = getComputedStyle(child);
      const parts = [];
      for (const p of props) parts.push(p + ':' + cs.getPropertyValue(p));
      out[key] = parts.join(';');
      walk(child, key);
    }
  };
  walk(document.body, 'body');
  return JSON.stringify(out);
})()`;

await waitChrome();
const data = {};

// Детерминизм: страницы генерируют случайные задания. Подменяем Math.random
// и Date.now до загрузки скриптов, чтобы два прогона давали одинаковый DOM.
const SEED_SCRIPT = `(() => {
  let s = 20261026;
  Math.random = function () {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const fixed = 1761440000000;
  Date.now = function () { return fixed; };
  if (window.performance && performance.now) performance.now = function () { return 0; };
})();`;

for (const vp of viewports) {
  for (const page of pages) {
    const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
    const cdp = new Cdp(t.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: SEED_SCRIPT });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: !!vp.mobile,
    });
    await cdp.send('Page.navigate', { url: `${base}/${page}` });
    await sleep(1200);
    const res = await cdp.send('Runtime.evaluate', { expression: COLLECT, returnByValue: true });
    data[`${page}@${vp.name}`] = JSON.parse(res.result.value);
    if (shotsDir) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(path.join(shotsDir, `${page.replace(/\.html$/, '')}-${vp.name}.png`), Buffer.from(shot.data, 'base64'));
    }
    cdp.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`);
    process.stdout.write('.');
  }
}
process.stdout.write('\n');

fs.writeFileSync(outFile, JSON.stringify(data), 'utf8');
console.log('сохранено:', outFile, 'снимков:', Object.keys(data).length);
kill();
