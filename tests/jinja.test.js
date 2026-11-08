import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TemplateError, render, scan } from '../docs/js/jinja.js';

const values = {
  award: 'AWD-1',
  start: '',
  categories: [
    { name: 'Travel', amount: '10.00', codes: [{ code: 'C1', description: 'trips' }] },
    { name: 'Supplies', amount: '5.00', codes: [{ code: 'C2', description: '' }, { code: 'C3', description: 'paper' }] },
  ],
};

test('values, filters and concatenation', () => {
  assert.equal(render('{{ award }}', values), 'AWD-1');
  assert.equal(render('{{ award | lower }}', values), 'awd-1');
  assert.equal(render('{{ "x" ~ award ~ "y" }}', values), 'xAWD-1y');
  assert.equal(render('{{ start | default("none") }}', values), 'none');
  assert.equal(render('{{ categories | map("name") | join(" and ") }}', values), 'Travel and Supplies');
  assert.equal(render('{{ categories | length }}', values), '2');
  assert.equal(render('{{ award | replace("-", "/") }}', values), 'AWD/1');
});

test('loops with loop variables and nested loops', () => {
  assert.equal(
    render('{% for c in categories %}{{ loop.index }}. {{ c.name }}{% if not loop.last %}, {% endif %}{% endfor %}', values),
    '1. Travel, 2. Supplies'
  );
  assert.equal(
    render('{% for c in categories %}{% for code in c.codes %}{{ code.code }}{% endfor %};{% endfor %}', values),
    'C1;C2C3;'
  );
  assert.equal(render('{% for c in start %}x{% else %}none{% endfor %}', { start: [] }), 'none');
});

test('conditions', () => {
  assert.equal(render('{% if start %}dated{% else %}undated{% endif %}', values), 'undated');
  assert.equal(render('{% if award == "AWD-1" and not start %}yes{% endif %}', values), 'yes');
  assert.equal(render('{% if award == "X" %}a{% elif award != "Y" %}b{% else %}c{% endif %}', values), 'b');
  assert.equal(render('{% if "Travel" in categories | map("name") %}t{% endif %}', values), 't');
});

test('whitespace control and comments', () => {
  assert.equal(render('a  {%- if true -%}  b  {%- endif -%}  c{# note #}', {}), 'abc');
});

test('mistakes are reported with their position', () => {
  const fails = (source, pattern, data = values) => {
    assert.throws(
      () => render(source, data, { c: 'c only exists inside the loop.' }),
      (err) => err instanceof TemplateError && pattern.test(err.message)
    );
  };
  fails('{{ awrd }}', /Line 1, column 4: "awrd" is not a variable here/);
  fails('{{ c.name }}', /c only exists inside the loop/);
  fails('{% for c in categories %}{{ c.nam }}{% endfor %}', /c has no field "nam"\. Its fields are name, amount, codes/);
  fails('{% for c in categories %}x', /never closed\. Add \{% endfor %\}/);
  fails('{% endif %}', /has nothing to close/);
  fails('{{ award', /never closed/);
  fails('{{ award | shout }}', /"shout" is not a filter/);
  fails('{% for c in categories %}{{ c }}{% endfor %}', /group of fields, not text/);
  fails('{% loop %}', /"loop" is not a tag here/);
  fails('a\n{{ }}', /Line 2, column 4: Something should go here/);
});

test('templates cannot reach anything but their own values', () => {
  const fails = (source) => assert.throws(() => render(source, values), TemplateError);
  fails('{{ award.constructor }}');
  fails('{{ categories.constructor }}');
  fails('{{ categories | map("constructor") | first }}x'.replace('x', '') + '{{ __proto__ }}');
  assert.equal(render('{{ categories | map("constructor") | join("") }}', values), '');
  fails('{{ toString }}');
});

test('scan never throws and marks unclosed tags', () => {
  assert.deepEqual(
    scan('a {{ b }} {% c').map((p) => p.type),
    ['text', 'output', 'text', 'unclosed']
  );
});
