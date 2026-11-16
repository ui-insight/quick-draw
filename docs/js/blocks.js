// The Builder view of a template: Jinja tags shown as labeled blocks inside
// editable text. Blocks are atomic (they move and delete as one piece) and
// carry their exact Jinja in data-raw, so the text round-trips unchanged.

import { FIELDS, LIST_FIELDS } from './core.js';
import { scan } from './jinja.js';
import { findLoops, readLoop } from './loopsyntax.js';
import { el } from './dom.js';

const SNIPPET_TYPE = 'application/x-quick-draw-snippet';
export { SNIPPET_TYPE };

/** The palette's "If … exists" block inserts this; the editor asks which value first. */
export const IF_SNIPPET = '{% if … %}…{% endif %}';

const VALUE_LABELS = {
  ...Object.fromEntries(Object.entries(FIELDS).map(([name, f]) => [name, f.label])),
  ...Object.fromEntries(Object.entries(LIST_FIELDS.categories.fields).map(([name, f]) => [`c.${name}`, f.label])),
  ...Object.fromEntries(Object.entries(LIST_FIELDS.codes.fields).map(([name, f]) => [`code.${name}`, f.label])),
  'loop.index': 'Item number',
  'c.codes | map("description") | join(", ")': "Category's descriptions",
};

const LOOP_LABELS = {
  'c in categories': 'For each category',
  'code in c.codes': 'For each code in the category',
  'code in codes': 'For each cost code',
};

const CONDITION_LABELS = {
  'not loop.last': 'If not the last item',
  'loop.last and not loop.first': 'If the last of several',
  'loop.first': 'If the first item',
  'loop.last': 'If the last item',
};

const squash = (text) => text.trim().replace(/\s+/g, ' ');

/** Plain names for common expressions that aren't a single field. */
const describeExpression = (expr) => {
  const descriptions = expr.match(/^(\w+)\.codes \| map\("description"\)/);
  if (descriptions) return descriptions[1] === 'c' ? "Category's descriptions" : 'Descriptions';
  const names = expr.match(/^categories \| map\("name"\)/);
  if (names) return 'Category names';
  return null;
};

const valueLabel = (expr) => VALUE_LABELS[expr] ?? describeExpression(expr) ?? expr;

/** The label and kind for one scanned tag. */
export const describeTag = (part) => {
  const inner = squash(part.inner ?? '');
  if (part.type === 'output') return { kind: 'value', label: valueLabel(inner) };
  if (part.type === 'comment') return { kind: 'note', label: `Note: ${inner}` };
  const [word] = inner.split(' ');
  const rest = inner.slice(word.length).trim();
  switch (word) {
    case 'for':
      return { kind: 'loop', label: LOOP_LABELS[rest] ?? `For each ${rest}` };
    case 'endfor':
      return { kind: 'loop', label: 'End of repeat' };
    case 'if':
      return { kind: 'logic', label: CONDITION_LABELS[rest] ?? `If ${valueLabel(rest)} exists` };
    case 'elif':
      return { kind: 'logic', label: `Or if ${rest}` };
    case 'else':
      return { kind: 'logic', label: 'Otherwise' };
    case 'endif':
      return { kind: 'logic', label: 'End if' };
    default:
      return { kind: 'note', label: inner };
  }
};

/** The value an "If … exists" tests, or undefined for other tags (including the loop helpers). */
const ifValue = (part) => {
  const match = part.type === 'tag' && squash(part.inner ?? '').match(/^if (.+)$/);
  return match && !(match[1] in CONDITION_LABELS) ? match[1] : undefined;
};

const chip = (raw, part, choices) => {
  const { kind, label } = describeTag(part);
  const cond = ifValue(part);
  if (cond === undefined || !choices?.length) return el('span', { class: `chip chip-${kind}`, contentEditable: 'false', draggable: true, dataset: { raw }, title: raw }, label);
  // "If [value] exists": the value is a dropdown of what this window offers.
  const options = choices.some((c) => c.expr === cond) ? choices : [{ expr: cond, label: valueLabel(cond) }, ...choices];
  return el(
    'span',
    { class: `chip chip-${kind}`, contentEditable: 'false', draggable: true, dataset: { raw } },
    'If ',
    el(
      'select',
      { class: 'if-value', 'aria-label': 'Value to check' },
      options.map((c) => el('option', { value: c.expr, selected: c.expr === cond }, c.label))
    ),
    ' exists'
  );
};

/** The values an "If … exists" can test: the value blocks of a palette, by their expressions. */
export const ifChoices = (blocks) =>
  blocks
    .filter((b) => (b.kind ?? 'value') === 'value')
    .map((b) => ({ label: b.label, expr: b.insert.match(/^\{\{ (.+) \}\}$/)?.[1] }))
    .filter((c) => c.expr && c.expr !== 'loop.index');


/** A short reading of a loop's item text: its words, with values named and inner loops in brackets. */
const itemSummary = (text) => {
  const words = [];
  const pieces = (slice) => {
    for (const part of scan(slice)) {
      if (part.type === 'text' || part.type === 'unclosed') words.push(slice.slice(part.start, part.end));
      else if (part.type === 'output') words.push(describeTag(part).label);
    }
  };
  let position = 0;
  for (const loop of findLoops(text)) {
    pieces(text.slice(position, loop.start));
    const inner = readLoop(text.slice(loop.start, loop.end));
    words.push(`[${(inner && LOOP_LABELS[`${inner.target} in ${inner.iter}`]) || 'loop'}]`);
    position = loop.end;
  }
  pieces(text.slice(position));
  return words.join('').replace(/\s+/g, ' ').trim();
};

/** The label of a loop block, such as "For each category: Category name Category amount, …". */
export const loopSummary = (raw) => {
  const loop = readLoop(raw);
  if (!loop) return 'Loop';
  const name = LOOP_LABELS[`${loop.target} in ${loop.iter}`] ?? `For each ${loop.target} in ${loop.iter}`;
  let item = itemSummary(loop.item);
  if (item.length > 48) item = `${item.slice(0, 47)}…`;
  const sep = loop.between ? `${loop.between.trimEnd()} …` : '';
  return item ? `${name}: ${item}${sep}` : name;
};

const loopChip = (raw) =>
  el(
    'span',
    {
      class: 'chip chip-loop loop-block',
      contentEditable: 'false',
      draggable: true,
      dataset: { raw, loop: '1' },
      role: 'button',
      tabIndex: 0,
      title: 'Click to change this loop',
    },
    el('span', { class: 'loop-icon', 'aria-hidden': 'true' }, '↻'),
    loopSummary(raw)
  );

/**
 * Builder content for a template: text nodes and blocks. Each whole loop is one
 * block. With `choices`, an "If … exists" block offers them in a dropdown.
 */
export const builderNodes = (text, choices) => {
  const nodes = [];
  const pieces = (from, to) => {
    const slice = text.slice(from, to);
    for (const part of scan(slice)) {
      const piece = slice.slice(part.start, part.end);
      nodes.push(part.type === 'text' || part.type === 'unclosed' ? document.createTextNode(piece) : chip(piece, part, choices));
    }
  };
  let position = 0;
  for (const loop of findLoops(text)) {
    if (loop.start > position) pieces(position, loop.start);
    nodes.push(loopChip(text.slice(loop.start, loop.end)));
    position = loop.end;
  }
  if (position < text.length) pieces(position, text.length);
  return nodes;
};

const builderHtml = (text, choices) => {
  const holder = el('div');
  holder.append(...builderNodes(text, choices));
  // innerHTML keeps only the `selected` attribute, so mark the chosen option.
  for (const select of holder.querySelectorAll('select')) select.selectedOptions[0]?.setAttribute('selected', '');
  return holder.innerHTML;
};

/** The Jinja text for the Builder's content. */
export const serialize = (root) => {
  let out = '';
  const walk = (node, isRoot) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent.replace(/ /g, ' ');
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.dataset.raw !== undefined) out += child.dataset.raw;
        else if (child.tagName === 'BR') {
          // Browsers keep a placeholder <br> at the very end; it is not a line.
          if (!(isRoot && child === node.lastChild)) out += '\n';
        } else if (child.tagName === 'DIV' || child.tagName === 'P') {
          if (out && !out.endsWith('\n')) out += '\n';
          walk(child, false);
        } else {
          walk(child, false);
        }
      }
    }
  };
  walk(root, true);
  return out;
};

/** Places the caret at a screen point, if the browser can tell where that is. */
const caretAt = (x, y) => {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (!pos) return null;
    const range = document.createRange();
    range.setStart(pos.offsetNode, pos.offset);
    return range;
  }
  return null;
};

/**
 * A Builder editor. Returns { node, insert(snippet), dispose() }; `onInput(text)`
 * gets the template's Jinja text after every change. `onLoop(raw)` is called
 * when a loop block is clicked and resolves with its new Jinja, '' to remove
 * it, or null to leave it. `ifChoices` are the values an "If … exists" can test.
 */
export const visualEditor = (text, onInput, { onLoop, ifChoices: choices = [] } = {}) => {
  const box = el('div', {
    class: 'visual-input',
    contentEditable: 'true',
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': 'Template',
    spellcheck: true,
  });
  box.append(...builderNodes(text, choices));

  let saved = null;
  const remember = () => {
    const selection = getSelection();
    if (selection.rangeCount && box.contains(selection.anchorNode)) saved = selection.getRangeAt(0).cloneRange();
  };
  document.addEventListener('selectionchange', remember);

  const restore = () => {
    box.focus();
    const selection = getSelection();
    if (saved && box.contains(saved.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(saved);
    } else if (!box.contains(selection.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(box);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  const insertHtml = (html) => {
    if (!document.execCommand('insertHTML', false, html)) {
      const range = getSelection().getRangeAt(0);
      range.deleteContents();
      const holder = el('div');
      holder.innerHTML = html;
      const nodes = [...holder.childNodes];
      for (const node of nodes.reverse()) range.insertNode(node);
      box.dispatchEvent(new Event('input'));
    }
  };

  const blockAt = (node) => {
    const block = (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest('.chip');
    return block && box.contains(block) ? block : null;
  };

  // Nothing goes inside a block: a caret in one moves to just after it.
  const outsideBlocks = () => {
    const selection = getSelection();
    const inside = blockAt(selection.rangeCount ? selection.anchorNode : null);
    if (!inside) return;
    const range = document.createRange();
    range.setStartAfter(inside);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  // An "If … exists" starts on the first value; its dropdown changes it.
  const insertSnippet = (snippet) => {
    outsideBlocks();
    if (snippet === IF_SNIPPET) {
      if (!choices.length) return;
      snippet = `{% if ${choices[0].expr} %}…{% endif %}`;
    }
    insertHtml(builderHtml(snippet, choices));
  };

  const insert = (snippet) => {
    restore();
    insertSnippet(snippet);
  };

  // Blocks are atomic. Some browsers (Safari) let the caret into a block's
  // label; a delete that reaches one removes the whole block, and typing there
  // lands just after it.
  box.addEventListener('beforeinput', (event) => {
    const hit = new Set(
      event
        .getTargetRanges()
        .flatMap((r) => [r.startContainer, r.endContainer])
        .map(blockAt)
        .filter(Boolean)
    );
    if (!hit.size) return;
    event.preventDefault();
    if (event.inputType.startsWith('delete')) {
      for (const block of hit) block.remove();
      onInput(serialize(box));
    } else {
      outsideBlocks();
      if (event.data) document.execCommand('insertText', false, event.data);
    }
  });
  box.addEventListener('input', (event) => {
    if (event.target.matches?.('.if-value')) event.target.closest('.chip').dataset.raw = `{% if ${event.target.value} %}`;
    onInput(serialize(box));
  });

  const editLoop = async (block) => {
    if (!onLoop) return;
    const result = await onLoop(block.dataset.raw);
    if (result === null || result === undefined) return;
    if (result === '') block.remove();
    else block.replaceWith(...builderNodes(result, choices));
    onInput(serialize(box));
  };
  box.addEventListener('click', (event) => {
    const block = event.target.closest('.chip');
    if (!block || !box.contains(block)) return;
    if (block.dataset.loop) return editLoop(block);
    if (event.target.closest('select')) return;
    // Select the whole block, so Delete or Backspace removes it as one piece.
    const range = document.createRange();
    range.selectNode(block);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  // Capture, so Enter on a focused loop block opens it instead of adding a line break.
  box.addEventListener(
    'keydown',
    (event) => {
      const block = event.target.closest?.('.loop-block');
      if (block && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        event.stopPropagation();
        editLoop(block);
      }
    },
    true
  );
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!document.execCommand('insertLineBreak')) insertHtml('<br>');
    }
  });
  box.addEventListener('paste', (event) => {
    event.preventDefault();
    insertHtml(builderHtml(event.clipboardData.getData('text/plain'), choices));
  });
  // A block dragged from the template moves to where it's dropped, or is
  // removed if it's dropped anywhere else.
  let dragged = null;
  box.addEventListener('dragstart', (event) => {
    const block = event.target.closest?.('.chip');
    if (!block || !box.contains(block)) return;
    dragged = block;
    event.dataTransfer.setData(SNIPPET_TYPE, block.dataset.raw);
    event.dataTransfer.effectAllowed = 'move';
  });
  box.addEventListener('dragend', () => {
    if (dragged && box.contains(dragged)) {
      dragged.remove();
      onInput(serialize(box));
    }
    dragged = null;
  });
  box.addEventListener('dragover', (event) => {
    if ([...event.dataTransfer.types].includes(SNIPPET_TYPE)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = dragged ? 'move' : 'copy';
    }
    box.classList.add('drop-target');
  });
  box.addEventListener('dragleave', () => box.classList.remove('drop-target'));
  box.addEventListener('drop', (event) => {
    box.classList.remove('drop-target');
    const snippet = event.dataTransfer.getData(SNIPPET_TYPE);
    if (!snippet) return; // Moving text or a block inside the editor: the browser handles it.
    event.preventDefault();
    box.focus();
    const range = caretAt(event.clientX, event.clientY);
    if (range && box.contains(range.startContainer)) {
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      restore();
    }
    insertSnippet(snippet);
  });

  return {
    node: box,
    insert,
    dispose: () => document.removeEventListener('selectionchange', remember),
  };
};
