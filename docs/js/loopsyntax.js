// Reading and writing {% for %} loops as settings the loop dialog can show:
// what to repeat over, the text for each item, what goes between items,
// what goes before the last one, and what to write when the list is empty.
// Pure functions, so they are tested under Node.

import { scan } from './jinja.js';

const tagWord = (part) => (part.inner ?? '').trim().split(/\s+/)[0];

/**
 * The top-level loops in a template, as { start, end } offsets: each {% for %}
 * with its matching {% endfor %} that sits inside no other loop. Loops inside
 * an {% if %} still count. Unbalanced tags stop the search.
 */
export const findLoops = (text) => {
  const regions = [];
  const stack = [];
  for (const part of scan(text)) {
    if (part.type === 'unclosed') break;
    if (part.type !== 'tag') continue;
    const word = tagWord(part);
    if (word === 'for' || word === 'if') stack.push({ word, start: part.start });
    else if (word === 'endfor' || word === 'endif') {
      const open = stack.pop();
      if (!open || `end${open.word}` !== word) break;
      if (word === 'endfor' && !stack.some((s) => s.word === 'for')) regions.push({ start: open.start, end: part.end });
    }
  }
  return regions;
};

const IF_LAST_AND_NOT_FIRST = /^\{%-?\s*if\s+loop\.last\s+and\s+not\s+loop\.first\s*-?%\}([^{]*)\{%-?\s*endif\s*-?%\}/;
const IF_NOT_LAST = /\{%-?\s*if\s+not\s+loop\.last\s*-?%\}([^{]*)\{%-?\s*endif\s*-?%\}$/;

/**
 * Splits one loop (from {% for %} to its {% endfor %}) into settings:
 * { target, iter, item, between, beforeLast, empty }. `empty` is null when the
 * loop has no {% else %}. Returns null if the text is not a single loop.
 */
export const readLoop = (region) => {
  const parts = scan(region);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first || first.type !== 'tag' || tagWord(first) !== 'for' || last.type !== 'tag' || tagWord(last) !== 'endfor') return null;
  const header = first.inner.trim().match(/^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+)$/);
  if (!header) return null;

  // Find this loop's own {% else %}, skipping any inside nested blocks.
  let depth = 0;
  let otherwise = null;
  for (const part of parts.slice(1, -1)) {
    if (part.type !== 'tag') continue;
    const word = tagWord(part);
    if (word === 'for' || word === 'if') depth++;
    else if (word === 'endfor' || word === 'endif') depth--;
    else if (word === 'else' && depth === 0) otherwise = part;
    if (depth < 0) return null;
  }
  if (depth !== 0) return null;

  let body = region.slice(first.end, otherwise ? otherwise.start : last.start);
  let beforeLast = '';
  let between = '';
  const lead = body.match(IF_LAST_AND_NOT_FIRST);
  if (lead) {
    beforeLast = lead[1];
    body = body.slice(lead[0].length);
  }
  const tail = body.match(IF_NOT_LAST);
  if (tail) {
    between = tail[1];
    body = body.slice(0, tail.index);
  }
  return {
    target: header[1],
    iter: header[2].trim(),
    item: body,
    between,
    beforeLast,
    empty: otherwise ? region.slice(otherwise.end, last.start) : null,
  };
};

/** Writes loop settings back as Jinja. The inverse of readLoop. */
export const writeLoop = ({ target, iter, item, between = '', beforeLast = '', empty = null }) =>
  `{% for ${target} in ${iter} %}` +
  (beforeLast ? `{% if loop.last and not loop.first %}${beforeLast}{% endif %}` : '') +
  item +
  (between ? `{% if not loop.last %}${between}{% endif %}` : '') +
  (empty ? `{% else %}${empty}` : '') +
  '{% endfor %}';

/** The lists a loop can repeat over, given the loop variables already in scope. */
export const loopLists = (inScope = []) => {
  const lists = [
    { iter: 'categories', target: 'c', label: 'Each budget category', noun: 'category' },
    { iter: 'codes', target: 'code', label: 'Each cost code on the award', noun: 'cost code' },
  ];
  if (inScope.includes('c')) lists.unshift({ iter: 'c.codes', target: 'code', label: 'Each cost code in this category', noun: 'cost code' });
  return lists;
};
