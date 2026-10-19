/*
 * Пересобирает js/oge15-ref.js из files/oge15/oge-15-2026-NN.kum.
 *
 * js/oge15-ref.js — автогенерируемый файл: в него встраиваются эталонные
 * решения задания 15, которые генератор случайных обстановок (js/oge15-gen.js)
 * использует как «оракул» для вычисления эталона закраски.
 *
 * Запуск из корня репозитория:  node tools/gen-oge15-ref.mjs
 */
import fs from 'fs';

const DIR = 'files/oge15';
const OUT = 'js/oge15-ref.js';
const COUNT = 20;

const lines = [
  '',
  '/*',
  ' * АВТОГЕНЕРИРУЕМЫЙ ФАЙЛ. Не редактировать вручную.',
  ' * Источник: files/oge15/oge-15-2026-NN.kum (эталонные решения задания 15).',
  ' * Пересобрать: node tools/gen-oge15-ref.mjs',
  ' * Используется генератором случайных обстановок (js/oge15-gen.js) как',
  ' * «оракул»: эталон прогоняется на сгенерированной обстановке, и полученные',
  ' * закрашенные клетки становятся эталоном для проверки решения ученика.',
  ' */',
  'window.OGE15_REF = {'
];

for (let n = 1; n <= COUNT; n++) {
  const id = String(n).padStart(2, '0');
  const src = fs.readFileSync(`${DIR}/oge-15-2026-${id}.kum`, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\s+$/, '');
  lines.push(`  ${JSON.stringify(id)}: ${JSON.stringify(src)}${n < COUNT ? ',' : ''}`);
}

lines.push('};', '');
fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(`OK: ${OUT} пересобран из ${COUNT} .kum-файлов`);
