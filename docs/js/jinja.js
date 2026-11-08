// A small, safe Jinja interpreter for justification templates.
//
// Supports {{ expressions }}, {% for %} / {% else %} / {% endfor %},
// {% if %} / {% elif %} / {% else %} / {% endif %}, {# comments #}, the "-"
// whitespace-control marker, and a handful of filters. It never evaluates code:
// templates can only read the values they are given, and only their own
// fields, so a shared template file cannot reach anything else in the page.
//
// Missing variables and fields are errors, not blanks, so a typo shows up in
// the builder instead of silently dropping text.

export class TemplateError extends Error {
  constructor(message, source, position) {
    const { line, column } = lineColumn(source, position ?? 0);
    super(`Line ${line}, column ${column}: ${message}`);
    this.detail = message;
    this.line = line;
    this.column = column;
    this.position = position ?? 0;
  }
}

const lineColumn = (source, position) => {
  const before = source.slice(0, position);
  const line = before.split('\n').length;
  return { line, column: position - before.lastIndexOf('\n') };
};

// ------------------------------------------------------------- scanning

const CLOSERS = { '{': '}}', '%': '%}', '#': '#}' };
const KINDS = { '{': 'output', '%': 'tag', '#': 'comment' };

/**
 * Splits a template into text and tag pieces. Never throws: an unclosed tag
 * comes back as { type: 'unclosed' } so the editor can still highlight it.
 * Each piece has start/end offsets; tags also have `inner` (the text between
 * the delimiters, without "-" markers) and `innerStart`.
 */
export const scan = (source) => {
  const parts = [];
  const opener = /\{([{%#])/g;
  let position = 0;
  while (position < source.length) {
    opener.lastIndex = position;
    const match = opener.exec(source);
    if (!match) {
      parts.push({ type: 'text', start: position, end: source.length });
      break;
    }
    if (match.index > position) parts.push({ type: 'text', start: position, end: match.index });
    const kind = match[1];
    const close = source.indexOf(CLOSERS[kind], match.index + 2);
    if (close === -1) {
      parts.push({ type: 'unclosed', kind: KINDS[kind], start: match.index, end: source.length });
      break;
    }
    let innerStart = match.index + 2;
    let innerEnd = close;
    let trimBefore = false;
    let trimAfter = false;
    if (kind !== '#' && source[innerStart] === '-') {
      trimBefore = true;
      innerStart++;
    }
    if (kind !== '#' && innerEnd > innerStart && source[innerEnd - 1] === '-') {
      trimAfter = true;
      innerEnd--;
    }
    parts.push({
      type: KINDS[kind],
      start: match.index,
      end: close + 2,
      inner: source.slice(innerStart, innerEnd),
      innerStart,
      trimBefore,
      trimAfter,
    });
    position = close + 2;
  }
  return parts;
};

// ---------------------------------------------------------- expressions

const TOKEN = /\s*(?:("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|<=|>=|[<>~|.(),]))/y;

const tokenize = (text, offset, source) => {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    if (/^\s*$/.test(text.slice(i))) break;
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(text);
    if (!m) {
      const at = i + text.slice(i).search(/\S/);
      throw new TemplateError(`"${text[at]}" is not understood here.`, source, offset + at);
    }
    const start = offset + m.index + m[0].search(/\S/);
    if (m[1] !== undefined) {
      const body = m[1].slice(1, -1).replace(/\\(.)/g, (_, ch) => (ch === 'n' ? '\n' : ch));
      tokens.push({ type: 'string', value: body, start });
    } else if (m[2] !== undefined) {
      tokens.push({ type: 'number', value: Number(m[2]), start });
    } else if (m[3] !== undefined) {
      tokens.push({ type: 'name', value: m[3], start });
    } else {
      tokens.push({ type: 'op', value: m[4], start });
    }
    i = TOKEN.lastIndex;
  }
  tokens.push({ type: 'end', value: '', start: offset + text.length });
  return tokens;
};

const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'true', 'false', 'none', 'True', 'False', 'None']);

class ExpressionParser {
  constructor(text, offset, source) {
    this.source = source;
    this.tokens = tokenize(text, offset, source);
    this.i = 0;
  }

  peek() {
    return this.tokens[this.i];
  }

  next() {
    return this.tokens[this.i++];
  }

  is(type, value) {
    const t = this.peek();
    return t.type === type && (value === undefined || t.value === value);
  }

  expect(type, value, what) {
    if (!this.is(type, value)) this.fail(`Expected ${what}.`);
    return this.next();
  }

  fail(message, token = this.peek()) {
    throw new TemplateError(message, this.source, token.start);
  }

  parseAll() {
    if (this.is('end')) this.fail('Something should go here, such as a variable name.');
    const expr = this.parseOr();
    if (!this.is('end')) this.fail(`"${this.peek().value}" is not expected here.`);
    return expr;
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.is('name', 'or')) {
      const at = this.next().start;
      left = { type: 'or', left, right: this.parseAnd(), at };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (this.is('name', 'and')) {
      const at = this.next().start;
      left = { type: 'and', left, right: this.parseNot(), at };
    }
    return left;
  }

  parseNot() {
    if (this.is('name', 'not')) {
      const at = this.next().start;
      return { type: 'not', value: this.parseNot(), at };
    }
    return this.parseCompare();
  }

  parseCompare() {
    const left = this.parseConcat();
    const t = this.peek();
    if (t.type === 'op' && ['==', '!=', '<', '>', '<=', '>='].includes(t.value)) {
      this.next();
      return { type: 'compare', op: t.value, left, right: this.parseConcat(), at: t.start };
    }
    if (this.is('name', 'in')) {
      this.next();
      return { type: 'in', left, right: this.parseConcat(), at: t.start };
    }
    if (this.is('name', 'not') && this.tokens[this.i + 1]?.type === 'name' && this.tokens[this.i + 1].value === 'in') {
      this.next();
      this.next();
      return { type: 'not', value: { type: 'in', left, right: this.parseConcat(), at: t.start }, at: t.start };
    }
    return left;
  }

  parseConcat() {
    let left = this.parsePostfix();
    while (this.is('op', '~')) {
      const at = this.next().start;
      left = { type: 'concat', left, right: this.parsePostfix(), at };
    }
    return left;
  }

  parsePostfix() {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.is('op', '.')) {
        this.next();
        const name = this.expect('name', undefined, 'a field name after "."');
        expr = { type: 'field', object: expr, name: name.value, at: name.start };
      } else if (this.is('op', '|')) {
        this.next();
        const name = this.expect('name', undefined, 'a filter name after "|"');
        const args = [];
        if (this.is('op', '(')) {
          this.next();
          while (!this.is('op', ')')) {
            args.push(this.parseOr());
            if (!this.is('op', ',')) break;
            this.next();
          }
          this.expect('op', ')', '")" to close the filter');
        }
        expr = { type: 'filter', name: name.value, value: expr, args, at: name.start };
      } else {
        return expr;
      }
    }
  }

  parsePrimary() {
    const t = this.peek();
    if (t.type === 'string' || t.type === 'number') {
      this.next();
      return { type: 'literal', value: t.value, at: t.start };
    }
    if (t.type === 'name') {
      this.next();
      if (t.value === 'true' || t.value === 'True') return { type: 'literal', value: true, at: t.start };
      if (t.value === 'false' || t.value === 'False') return { type: 'literal', value: false, at: t.start };
      if (t.value === 'none' || t.value === 'None') return { type: 'literal', value: null, at: t.start };
      if (KEYWORDS.has(t.value)) this.fail(`"${t.value}" needs something before it.`, t);
      return { type: 'name', name: t.value, at: t.start };
    }
    if (this.is('op', '(')) {
      this.next();
      const expr = this.parseOr();
      this.expect('op', ')', '")"');
      return expr;
    }
    if (t.type === 'end') this.fail('This expression is unfinished.');
    return this.fail(`"${t.value}" is not expected here.`);
  }
}

const parseExpression = (text, offset, source) => new ExpressionParser(text, offset, source).parseAll();

// ------------------------------------------------------------- parsing

const TAG_HELP = 'Tags are for, endfor, if, elif, else and endif.';

/** Parses a template into a tree. Throws TemplateError on any syntax problem. */
export const parse = (source) => {
  const parts = scan(source);
  const root = { type: 'root', body: [] };
  const stack = [{ node: root, body: root.body }];
  const top = () => stack[stack.length - 1];

  // Apply "-" whitespace control to neighboring text.
  const texts = parts.map((part) => (part.type === 'text' ? source.slice(part.start, part.end) : null));
  parts.forEach((part, i) => {
    if (part.type === 'text') return;
    if (part.trimBefore && i > 0 && texts[i - 1] !== null) texts[i - 1] = texts[i - 1].replace(/\s+$/, '');
    if (part.trimAfter && i + 1 < parts.length && texts[i + 1] !== null) texts[i + 1] = texts[i + 1].replace(/^\s+/, '');
  });

  parts.forEach((part, i) => {
    if (part.type === 'text') {
      if (texts[i]) top().body.push({ type: 'text', value: texts[i] });
      return;
    }
    if (part.type === 'comment') return;
    if (part.type === 'unclosed') {
      const close = { output: '}}', tag: '%}', comment: '#}' }[part.kind];
      throw new TemplateError(`This tag is never closed. Add "${close}".`, source, part.start);
    }
    if (part.type === 'output') {
      top().body.push({ type: 'output', expr: parseExpression(part.inner, part.innerStart, source), at: part.start });
      return;
    }

    // A {% tag %}.
    const inner = part.inner;
    const lead = inner.match(/^\s*/)[0].length;
    const word = (inner.slice(lead).match(/^[A-Za-z_]+/) ?? [''])[0];
    const restStart = part.innerStart + lead + word.length;
    const rest = inner.slice(lead + word.length);
    const at = part.start;

    if (word === 'for') {
      const m = rest.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s/);
      if (!m) {
        throw new TemplateError('A loop is written {% for c in categories %}.', source, at);
      }
      if (m[1] === 'loop') throw new TemplateError('"loop" is reserved. Use another name, like c.', source, at);
      const iterStart = restStart + m[0].length;
      const node = {
        type: 'for',
        target: m[1],
        iter: parseExpression(rest.slice(m[0].length), iterStart, source),
        body: [],
        otherwise: null,
        at,
      };
      top().body.push(node);
      stack.push({ node, body: node.body });
    } else if (word === 'if') {
      const node = { type: 'if', branches: [{ cond: parseExpression(rest, restStart, source), body: [] }], otherwise: null, at };
      top().body.push(node);
      stack.push({ node, body: node.branches[0].body });
    } else if (word === 'elif') {
      const frame = top();
      if (frame.node.type !== 'if' || frame.node.otherwise) {
        throw new TemplateError('{% elif %} must be inside an {% if %}, before any {% else %}.', source, at);
      }
      const branch = { cond: parseExpression(rest, restStart, source), body: [] };
      frame.node.branches.push(branch);
      frame.body = branch.body;
    } else if (word === 'else') {
      const frame = top();
      if ((frame.node.type !== 'if' && frame.node.type !== 'for') || frame.node.otherwise) {
        throw new TemplateError('{% else %} must be inside an {% if %} or {% for %}, once.', source, at);
      }
      if (rest.trim()) throw new TemplateError('{% else %} takes nothing after it. Did you mean {% elif %}?', source, at);
      frame.node.otherwise = [];
      frame.body = frame.node.otherwise;
    } else if (word === 'endfor' || word === 'endif') {
      const want = word === 'endfor' ? 'for' : 'if';
      const frame = top();
      if (frame.node.type !== want) {
        const open = frame.node.type === 'root' ? 'nothing is open' : `the open tag is {% ${frame.node.type} %}, closed by {% end${frame.node.type} %}`;
        throw new TemplateError(`{% ${word} %} has nothing to close: ${open}.`, source, at);
      }
      if (rest.trim()) throw new TemplateError(`{% ${word} %} takes nothing after it.`, source, at);
      stack.pop();
    } else {
      throw new TemplateError(word ? `"${word}" is not a tag here. ${TAG_HELP}` : `This tag is empty. ${TAG_HELP}`, source, at);
    }
  });

  if (stack.length > 1) {
    const open = top().node;
    throw new TemplateError(`This {% ${open.type} %} is never closed. Add {% end${open.type} %}.`, source, open.at);
  }
  return root;
};

// ------------------------------------------------------------ rendering

const truthy = (value) =>
  !(value === null || value === undefined || value === false || value === 0 || value === '' || (Array.isArray(value) && value.length === 0));

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const describeExpr = (expr) => {
  if (expr.type === 'name') return expr.name;
  if (expr.type === 'field') return `${describeExpr(expr.object)}.${expr.name}`;
  return 'this value';
};

const text = (value) => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(text).join(', ');
  return String(value);
};

const FILTERS = {
  upper: (v) => text(v).toUpperCase(),
  lower: (v) => text(v).toLowerCase(),
  capitalize: (v) => {
    const s = text(v);
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  },
  title: (v) => text(v).replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()),
  trim: (v) => text(v).trim(),
  length: (v) => (Array.isArray(v) ? v.length : text(v).length),
  count: (v) => (Array.isArray(v) ? v.length : text(v).length),
  first: (v) => (Array.isArray(v) ? v[0] ?? null : text(v).charAt(0)),
  last: (v) => (Array.isArray(v) ? v[v.length - 1] ?? null : text(v).slice(-1)),
  join: (v, sep = '') => (Array.isArray(v) ? v.map(text).join(text(sep)) : text(v)),
  default: (v, fallback = '') => (v === null || v === undefined || v === '' ? fallback : v),
  replace: (v, from, to = '') => text(v).split(text(from)).join(text(to)),
  map: (v, attribute) => {
    if (!Array.isArray(v)) return v;
    return v.map((item) => (isRecord(item) && Object.hasOwn(item, attribute) ? item[attribute] : null));
  },
};
FILTERS.d = FILTERS.default;

export const FILTER_NAMES = Object.keys(FILTERS);

class Renderer {
  constructor(source, hints) {
    this.source = source;
    this.hints = hints;
  }

  fail(message, at) {
    throw new TemplateError(message, this.source, at);
  }

  lookup(scopes, name, at) {
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (Object.hasOwn(scopes[i], name)) return scopes[i][name];
    }
    const hint = this.hints?.[name];
    this.fail(`"${name}" is not a variable here.${hint ? ` ${hint}` : ''}`, at);
  }

  eval(expr, scopes) {
    switch (expr.type) {
      case 'literal':
        return expr.value;
      case 'name':
        return this.lookup(scopes, expr.name, expr.at);
      case 'field': {
        const object = this.eval(expr.object, scopes);
        if (isRecord(object) && Object.hasOwn(object, expr.name)) return object[expr.name];
        const what = describeExpr(expr.object);
        if (isRecord(object)) {
          return this.fail(`${what} has no field "${expr.name}". Its fields are ${Object.keys(object).join(', ')}.`, expr.at);
        }
        if (Array.isArray(object)) {
          return this.fail(`${what} is a list, so it has no field "${expr.name}". Loop over it with {% for item in ${what} %}.`, expr.at);
        }
        return this.fail(`${what} is text, so it has no field "${expr.name}".`, expr.at);
      }
      case 'filter': {
        const fn = FILTERS[expr.name];
        if (!fn) this.fail(`"${expr.name}" is not a filter. Filters are ${FILTER_NAMES.join(', ')}.`, expr.at);
        return fn(this.eval(expr.value, scopes), ...expr.args.map((a) => this.eval(a, scopes)));
      }
      case 'not':
        return !truthy(this.eval(expr.value, scopes));
      case 'and': {
        const left = this.eval(expr.left, scopes);
        return truthy(left) ? this.eval(expr.right, scopes) : left;
      }
      case 'or': {
        const left = this.eval(expr.left, scopes);
        return truthy(left) ? left : this.eval(expr.right, scopes);
      }
      case 'concat':
        return text(this.eval(expr.left, scopes)) + text(this.eval(expr.right, scopes));
      case 'in': {
        const needle = this.eval(expr.left, scopes);
        const hay = this.eval(expr.right, scopes);
        return Array.isArray(hay) ? hay.includes(needle) : text(hay).includes(text(needle));
      }
      case 'compare': {
        const a = this.eval(expr.left, scopes);
        const b = this.eval(expr.right, scopes);
        switch (expr.op) {
          case '==':
            return a === b;
          case '!=':
            return a !== b;
          case '<':
            return a < b;
          case '>':
            return a > b;
          case '<=':
            return a <= b;
          default:
            return a >= b;
        }
      }
      default:
        return this.fail('This expression is not understood.', expr.at ?? 0);
    }
  }

  render(nodes, scopes, out) {
    for (const node of nodes) {
      if (node.type === 'text') {
        out.push(node.value);
      } else if (node.type === 'output') {
        const value = this.eval(node.expr, scopes);
        if (isRecord(value)) {
          const name = describeExpr(node.expr);
          this.fail(`${name} is a group of fields, not text. Use one of them, like ${name}.${Object.keys(value)[0]}.`, node.at);
        }
        out.push(text(value));
      } else if (node.type === 'if') {
        const branch = node.branches.find((b) => truthy(this.eval(b.cond, scopes)));
        if (branch) this.render(branch.body, scopes, out);
        else if (node.otherwise) this.render(node.otherwise, scopes, out);
      } else if (node.type === 'for') {
        const items = this.eval(node.iter, scopes);
        if (!Array.isArray(items)) {
          this.fail(`${describeExpr(node.iter)} is not a list, so it can't be looped over.`, node.at);
        }
        if (items.length === 0 && node.otherwise) this.render(node.otherwise, scopes, out);
        items.forEach((item, index) => {
          const loop = {
            index: index + 1,
            index0: index,
            first: index === 0,
            last: index === items.length - 1,
            length: items.length,
            revindex: items.length - index,
          };
          this.render(node.body, [...scopes, { [node.target]: item, loop }], out);
        });
      }
    }
  }
}

/**
 * Compiles a template once. `render(values)` returns the text, or throws a
 * TemplateError. `hints` maps a variable name to extra advice shown when it is
 * used where it doesn't exist.
 */
export const compile = (source, hints = {}) => {
  const tree = parse(source);
  return {
    render(values) {
      const out = [];
      new Renderer(source, hints).render(tree.body, [values], out);
      return out.join('');
    },
  };
};

export const render = (source, values, hints) => compile(source, hints).render(values);
