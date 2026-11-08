// Small DOM helpers shared by the page's modules.

export const $ = (selector, root = document) => root.querySelector(selector);

/** Builds an element. Children that are strings are added as text, never as HTML. */
export const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key in node && !key.includes('-') && key !== 'list' && key !== 'form') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
};

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

let tabsMade = 0;

/**
 * An accessible tab strip. `items` are { key, label, badge? }. Calls
 * onSelect(key) when one is chosen. Arrow keys, Home and End move between tabs.
 */
export const tabStrip = (items, selected, onSelect, { label, className = '', scrolls = true } = {}) => {
  const id = `tabs-${++tabsMade}`;
  const list = el('div', { class: `tabs ${className}`, role: 'tablist', 'aria-label': label });
  const buttons = items.map((item) =>
    el(
      'button',
      {
        type: 'button',
        role: 'tab',
        id: `${id}-${item.key}`,
        'aria-selected': String(item.key === selected),
        tabIndex: item.key === selected ? 0 : -1,
        class: item.className ?? '',
        disabled: item.disabled ?? false,
        title: item.title ?? null,
        onclick: () => onSelect(item.key),
      },
      el('span', { class: 'tab-label' }, item.label),
      item.badge ? el('span', { class: `badge ${item.badgeClass ?? ''}` }, item.badge) : null
    )
  );
  list.append(...buttons);
  list.addEventListener('keydown', (event) => {
    const index = buttons.indexOf(document.activeElement);
    if (index === -1) return;
    let next = null;
    if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    if (next === null || buttons[next].disabled) return;
    event.preventDefault();
    buttons[next].focus();
    onSelect(items[next].key);
  });
  return scrolls ? scrollable(list) : list;
};

/**
 * Wraps a row of tabs so a long one is easy to move along: ‹ › buttons at the
 * edges when it overflows, the mouse wheel scrolls it sideways, and the
 * selected tab is brought into view.
 */
const scrollable = (list) => {
  const step = () => Math.max(120, list.clientWidth * 0.7);
  const back = el('button', { type: 'button', class: 'tab-scroll back', 'aria-label': 'Scroll tabs left', tabIndex: -1 }, '‹');
  const ahead = el('button', { type: 'button', class: 'tab-scroll ahead', 'aria-label': 'Scroll tabs right', tabIndex: -1 }, '›');
  const frame = el('div', { class: `tabs-frame ${list.className.replace(/\btabs\b/, '').trim()}` }, back, list, ahead);
  const update = () => {
    const overflowing = list.scrollWidth > list.clientWidth + 1;
    frame.classList.toggle('overflowing', overflowing);
    back.hidden = !overflowing || list.scrollLeft <= 1;
    ahead.hidden = !overflowing || list.scrollLeft + list.clientWidth >= list.scrollWidth - 1;
  };
  back.addEventListener('click', () => list.scrollBy({ left: -step(), behavior: 'smooth' }));
  ahead.addEventListener('click', () => list.scrollBy({ left: step(), behavior: 'smooth' }));
  list.addEventListener('scroll', update, { passive: true });
  list.addEventListener(
    'wheel',
    (event) => {
      if (list.scrollWidth <= list.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      list.scrollLeft += event.deltaY;
      event.preventDefault();
    },
    { passive: false }
  );
  // Once on the page: bring the selected tab into view and set the buttons.
  requestAnimationFrame(() => {
    const selected = list.querySelector('[aria-selected=true]');
    if (selected && (selected.offsetLeft < list.scrollLeft || selected.offsetLeft + selected.offsetWidth > list.scrollLeft + list.clientWidth)) {
      list.scrollLeft = selected.offsetLeft - (list.clientWidth - selected.offsetWidth) / 2;
    }
    update();
  });
  new ResizeObserver(update).observe(list);
  return frame;
};

const NOTICE_TIPS = {
  warn: 'Something to check. It doesn’t stop you, but it can change the totals or the wording. Each line says what is wrong; fix it here or in your files.',
  error: 'This has to be fixed before Quick Draw can use it. The message says what is wrong.',
};

/** A warning or error box. `items` may be strings or nodes; `tip` explains it on hover. */
export const notice = (kind, title, items = [], extra = null, tip = NOTICE_TIPS[kind]) =>
  el(
    'div',
    { class: `notice ${kind}`, role: kind === 'error' ? 'alert' : null, title: tip },
    title ? el('p', { class: 'notice-title' }, title) : null,
    items.length === 1 ? el('p', {}, items[0]) : items.length > 1 ? el('ul', {}, items.map((item) => el('li', {}, item))) : null,
    extra
  );

/** Inserts text at the caret of a textarea or input, keeping the browser's undo history. */
export const insertAtCaret = (field, text) => {
  field.focus();
  const ok = document.execCommand && document.execCommand('insertText', false, text);
  if (!ok) {
    field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
};

export const downloadBytes = (bytes, filename, type) => {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Replaces a node's children, skipping null, undefined and false like el() does. */
export const fill = (node, ...children) =>
  node.replaceChildren(
    ...children
      .flat(Infinity)
      .filter((c) => c !== null && c !== undefined && c !== false)
      .map((c) => (c instanceof Node ? c : document.createTextNode(String(c))))
  );

/**
 * Quick tooltips for anything with a title: they appear as soon as the pointer
 * (or keyboard focus) arrives, instead of after the browser's delay. A title is
 * moved to data-tip on first use so the browser's own tooltip doesn't also show.
 */
export const installTooltips = () => {
  const tip = el('div', { class: 'tooltip', role: 'tooltip', id: 'quick-tip', hidden: true });
  let current = null;

  const hide = () => {
    if (!current) return;
    current.removeAttribute('aria-describedby');
    current = null;
    tip.hidden = true;
  };

  const show = (target) => {
    if (target.hasAttribute('title')) {
      target.dataset.tip = target.getAttribute('title');
      target.removeAttribute('title');
    }
    const text = target.dataset.tip;
    if (!text) return hide();
    if (current === target) return;
    hide();
    current = target;
    // A modal dialog sits above the page, so the tooltip has to live inside it to be seen.
    (target.closest('dialog[open]') ?? document.body).append(tip);
    tip.textContent = text;
    tip.hidden = false;
    target.setAttribute('aria-describedby', tip.id);
    const box = target.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const left = Math.min(Math.max(8, box.left + box.width / 2 - width / 2), window.innerWidth - width - 8);
    const below = box.bottom + 8 + height < window.innerHeight;
    tip.style.left = `${left}px`;
    tip.style.top = `${below ? box.bottom + 8 : box.top - height - 8}px`;
  };

  const find = (node) => (node instanceof Element ? node.closest('[title], [data-tip]') : null);
  document.addEventListener('mouseover', (event) => {
    const target = find(event.target);
    if (target) show(target);
    else hide();
  });
  document.addEventListener('mouseout', (event) => {
    if (current && !current.contains(event.relatedTarget)) hide();
  });
  document.addEventListener('focusin', (event) => {
    const target = find(event.target);
    if (target) show(target);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('keydown', (event) => event.key === 'Escape' && hide());
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
};

/**
 * Asks before doing something hard to undo, in a small window. Resolves true
 * when confirmed, false when cancelled (Cancel, Escape or clicking outside).
 */
export const confirmWindow = ({ title, message, confirmLabel = 'Confirm', danger = false }) =>
  new Promise((resolve) => {
    const dialog = el('dialog', { class: 'confirm-window', 'aria-labelledby': 'confirm-title' });
    let result = false;
    const finish = (answer) => {
      result = answer;
      dialog.close();
    };
    const cancel = el('button', { type: 'button', class: 'button secondary', onclick: () => finish(false) }, 'Cancel');
    dialog.append(
      el('h2', { id: 'confirm-title' }, title),
      el('p', {}, message),
      el(
        'div',
        { class: 'confirm-actions' },
        cancel,
        el('button', { type: 'button', class: `button${danger ? ' danger-solid' : ''}`, onclick: () => finish(true) }, confirmLabel)
      )
    );
    dialog.addEventListener('click', (event) => event.target === dialog && finish(false));
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
