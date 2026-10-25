// Общий парсер CSS для tools/check-css.mjs.
export function parseRules(css) {
  const rules = [];
  const stack = [];
  let i = 0;
  const n = css.length;

  const skipString = (j) => {
    const q = css[j];
    j++;
    while (j < n) {
      if (css[j] === '\\') { j += 2; continue; }
      if (css[j] === q) return j + 1;
      j++;
    }
    return j;
  };
  const skipComment = (j) => {
    const k = css.indexOf('*/', j + 2);
    return k < 0 ? n : k + 2;
  };
  const preludeStart = (i) => {
    let j = i - 1;
    while (j >= 0) {
      const ch = css[j];
      if (ch === '"' || ch === "'") {
        let k = j - 1;
        while (k >= 0) {
          if (css[k] === '\\') { k -= 2; continue; }
          if (css[k] === ch) break;
          k--;
        }
        j = k - 1;
        continue;
      }
      if (ch === '}' || ch === '{' || ch === ';') return j + 1;
      if (ch === '/' && css[j - 1] === '*') {
        const k = css.lastIndexOf('/*', j - 1);
        if (k >= 0) { j = k - 1; continue; }
      }
      j--;
    }
    return 0;
  };

  while (i < n) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') { i = skipComment(i); continue; }
    if (ch === '"' || ch === "'") { i = skipString(i); continue; }
    if (ch === '{') {
      const ps = preludeStart(i);
      const prelude = css.slice(ps, i).trim();
      const isAt = prelude.startsWith('@');
      const isKeyframes = isAt && /^@(-\w+-)?keyframes\b/.test(prelude);
      const inKeyframes = stack.some((s) => s.isKeyframes) || isKeyframes;
      if (!isAt && !inKeyframes) {
        rules.push({
          start: ps,
          end: null,
          selector: prelude,
          bodyStart: i + 1,
          context: stack.map((s) => s.prelude).join(' || '),
          depth: stack.length,
        });
      }
      stack.push({ prelude, isAt, isKeyframes });
      i++;
      continue;
    }
    if (ch === '}') {
      stack.pop();
      for (let k = rules.length - 1; k >= 0; k--) {
        if (rules[k].end === null && rules[k].depth === stack.length) {
          rules[k].end = i + 1;
          rules[k].body = css.slice(rules[k].bodyStart, i);
          break;
        }
      }
      i++;
      continue;
    }
    i++;
  }
  return rules.filter((r) => r.end !== null);
}

export function splitDeclarations(body) {
  const out = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < body.length && body[i] !== c) {
        if (body[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  if (body.slice(start).trim()) out.push(body.slice(start));
  return out.map((s) => s.trim()).filter(Boolean).map((d) => {
    const m = /^([-\w]+)\s*:\s*([\s\S]*)$/.exec(d);
    if (!m) return null;
    return {
      prop: m[1].toLowerCase(),
      value: m[2].trim(),
      important: /!\s*important\s*$/i.test(m[2]),
    };
  }).filter(Boolean);
}

export function normalizeText(text) {
  return String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
}

export function normalizeBody(body) {
  const decls = splitDeclarations(body);
  return decls.map((d) => d.prop + ':' + d.value).join(';');
}
