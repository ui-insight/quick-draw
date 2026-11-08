import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLoops, loopLists, readLoop, writeLoop } from '../docs/js/loopsyntax.js';
import { render } from '../docs/js/jinja.js';

const ITEMIZED =
  '{% for c in categories %}{% if loop.last and not loop.first %}and {% endif %}{{ c.name }} ${{ c.amount }}{% if not loop.last %}, {% endif %}{% endfor %}';

test('findLoops finds top-level loops only', () => {
  const text = `Paid ${ITEMIZED} on {% if start %}{% for code in codes %}x{% endfor %}{% endif %}.`;
  const loops = findLoops(text).map(({ start, end }) => text.slice(start, end));
  assert.deepEqual(loops, [ITEMIZED, '{% for code in codes %}x{% endfor %}']);
  const nested = '{% for c in categories %}({% for code in c.codes %}{{ code.code }}{% endfor %}){% endfor %}';
  assert.deepEqual(findLoops(nested), [{ start: 0, end: nested.length }]);
  assert.deepEqual(findLoops('{% for c in categories %}never closed'), []);
});

test('readLoop pulls out the separators the dialog shows', () => {
  assert.deepEqual(readLoop(ITEMIZED), {
    target: 'c',
    iter: 'categories',
    item: '{{ c.name }} ${{ c.amount }}',
    between: ', ',
    beforeLast: 'and ',
    empty: null,
  });
  const plain = readLoop('{% for code in c.codes %}{{ code.code }}{% else %}none{% endfor %}');
  assert.deepEqual(plain, { target: 'code', iter: 'c.codes', item: '{{ code.code }}', between: '', beforeLast: '', empty: 'none' });
});

test('an else inside a nested block belongs to that block', () => {
  const loop = '{% for c in categories %}{% if c.name %}a{% else %}b{% endif %}{% endfor %}';
  assert.equal(readLoop(loop).item, '{% if c.name %}a{% else %}b{% endif %}');
  assert.equal(readLoop(loop).empty, null);
});

test('writeLoop is the inverse of readLoop', () => {
  for (const loop of [
    writeLoop({ target: 'c', iter: 'categories', item: '{{ c.name }}', between: ', ', beforeLast: 'and ' }),
    '{% for code in codes %}{{ code.code }}{% endfor %}',
    '{% for c in categories %}{{ c.name }}{% if not loop.last %}; {% endif %}{% else %}nothing{% endfor %}',
  ]) {
    assert.equal(writeLoop(readLoop(loop)), loop);
  }
});

test('written loops render as described', () => {
  const values = { categories: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] };
  const loop = writeLoop({ target: 'c', iter: 'categories', item: '{{ c.name }}', between: ', ', beforeLast: 'and ' });
  assert.equal(render(loop, values), 'A, B, and C');
  assert.equal(render(loop, { categories: [{ name: 'A' }, { name: 'B' }] }), 'A and B');
  assert.equal(render(loop, { categories: [{ name: 'A' }] }), 'A');
  assert.equal(render(writeLoop({ target: 'c', iter: 'categories', item: '{{ c.name }}', between: '; ', beforeLast: 'and ' }), values), 'A; B; and C');
  assert.equal(render(writeLoop({ target: 'c', iter: 'categories', item: 'x', empty: 'none' }), { categories: [] }), 'none');
});

test('not a loop', () => {
  assert.equal(readLoop('{{ award }}'), null);
  assert.equal(readLoop('{% for c in categories %}a{% endfor %} extra'), null);
});

test('lists depend on the loops already open', () => {
  assert.deepEqual(loopLists().map((l) => l.iter), ['categories', 'codes']);
  assert.deepEqual(loopLists(['c']).map((l) => l.iter), ['c.codes', 'categories', 'codes']);
});

test('the older "before the last" form still opens with its settings', () => {
  assert.deepEqual(
    { between: readLoop(ITEMIZED).between, beforeLast: readLoop(ITEMIZED).beforeLast, item: readLoop(ITEMIZED).item },
    { between: ', ', beforeLast: 'and ', item: '{{ c.name }} ${{ c.amount }}' }
  );
});
