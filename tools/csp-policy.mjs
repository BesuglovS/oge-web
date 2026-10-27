#!/usr/bin/env node
// Генерирует Content-Security-Policy с хешами inline-скриптов.
//
//   node tools/csp-policy.mjs        # напечатать политику
//   node tools/csp-policy.mjs --json # {"policy": "...", "hashes": N}
//
// Inline-обработчиков (onclick=…) в проекте больше нет — только data-активы,
// поэтому 'unsafe-inline' для script-src не нужен: каждому inline <script>
// соответствует 'sha256-…' в политике. Политику подставляет deploy.ps1 в
// nginx-конфиг при каждом деплое (хеши считаются по тем же файлам, что уезжают).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function collectInlineHashes(rootDir) {
  const hashes = new Set();
  for (const f of fs.readdirSync(rootDir).filter((x) => x.endsWith('.html')).sort()) {
    const html = fs.readFileSync(path.join(rootDir, f), 'utf8');
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      const code = m[1];
      if (!code.trim()) continue;
      // HTML-парсер нормализует CRLF/CR в LF — хеш считается по этому тексту.
      const normalized = code.replace(/\r\n?/g, '\n');
      hashes.add(crypto.createHash('sha256').update(normalized, 'utf8').digest('base64'));
    }
  }
  return [...hashes].sort();
}

export function buildPolicy(rootDir) {
  const hashes = collectInlineHashes(rootDir);
  // Метрика может ходить и через .com (JSONP-колбэки, watch) — разрешаем оба домена.
  const YM = 'https://mc.yandex.ru https://mc.yandex.com';
  const scriptSrc = ["'self'", ...hashes.map((h) => `'sha256-${h}'`), YM].join(' ');
  const policy = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${YM}`,
    "font-src 'self'",
    `connect-src 'self' ${YM} https://auth.nayanovaacademy.ru`,
    `frame-src ${YM}`,
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
  return { policy, hashes };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { policy, hashes } = buildPolicy(rootDir);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ policy, hashes: hashes.length }));
  } else {
    console.log(policy);
  }
}
