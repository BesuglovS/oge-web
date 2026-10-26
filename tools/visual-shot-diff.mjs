#!/usr/bin/env node
// Попиксельное сравнение скриншотов, снятых visual-baseline.mjs --shots.
//
//   node tools/visual-baseline.mjs before.json --shots shots-before
//   ... правки CSS ...
//   node tools/visual-baseline.mjs after.json --shots shots-after
//   node tools/visual-shot-diff.mjs shots-before shots-after
//
// Рендеринг детерминирован (Math.random и Date.now подменяются, шрифты
// системные), поэтому одинаковый CSS даёт побайтово одинаковые PNG —
// сравнение по sha256 достаточно и не требует декодера изображений.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [dirA, dirB] = process.argv.slice(2);
if (!dirA || !dirB) {
  console.error('Использование: node tools/visual-shot-diff.mjs <before-dir> <after-dir>');
  process.exit(1);
}

const files = (dir) => new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.png')));
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const a = files(dirA);
const b = files(dirB);
const onlyA = [...a].filter((f) => !b.has(f));
const onlyB = [...b].filter((f) => !a.has(f));
const changed = [];
for (const f of [...a].filter((x) => b.has(x))) {
  if (hash(path.join(dirA, f)) !== hash(path.join(dirB, f))) changed.push(f);
}

if (onlyA.length) console.log('только в before:', onlyA.join(', '));
if (onlyB.length) console.log('только в after:', onlyB.join(', '));
if (changed.length) {
  console.log(`изменились (${changed.length}):`);
  for (const f of changed.sort()) console.log('  ' + f);
}
if (!onlyA.length && !onlyB.length && !changed.length) {
  console.log(`OK: ${a.size} скриншотов совпадают побайтово`);
}
process.exit(changed.length || onlyA.length || onlyB.length ? 1 : 0);
