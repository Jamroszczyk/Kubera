// Tiny DOM helpers — enough to build views without a framework.

/**
 * h('div.card', { onclick }, 'text', child, ...) — creates an element.
 * Tag may include classes: 'button.btn.btn-primary'.
 * Props: class/className, on<Event> handlers, style object, dataset object, other attributes.
 */
export function h(tag, props, ...children) {
  if (props != null && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') el.className = (el.className ? el.className + ' ' : '') + v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && k !== 'list' && k !== 'form') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replace(el, ...children) {
  clear(el);
  return append(el, children);
}

/** Set text and (optionally) a positive/negative class on an element. */
export function setText(el, text, cls) {
  if (el.textContent !== text) el.textContent = text;
  if (cls !== undefined) {
    el.classList.remove('pos', 'neg');
    if (cls) el.classList.add(cls);
  }
}

/** Segmented control. onChange(value). Returns { el, set(value) } */
export function segmented(options, value, onChange, { block = false, tone = false } = {}) {
  const el = h('div.seg' + (block ? '.block' : ''));
  const buttons = new Map();
  for (const opt of options) {
    const o = typeof opt === 'string' ? { value: opt, label: opt } : opt;
    const b = h('button', { type: 'button', onclick: () => { set(o.value); onChange(o.value); } }, o.label);
    if (o.tone) b.dataset.tone = o.tone;
    buttons.set(o.value, b);
    el.append(b);
  }
  function set(v) {
    value = v;
    for (const [k, b] of buttons) {
      b.classList.toggle('active', k === v);
      b.classList.remove('up', 'down');
      if (k === v && tone && b.dataset.tone) b.classList.add(b.dataset.tone);
    }
  }
  set(value);
  return { el, set, get value() { return value; } };
}

// ── Toasts ─────────────────────────────────────────────────────
export function toast(message, kind = 'info', ms = 2600) {
  const root = document.getElementById('toast-root');
  const t = h('div.toast' + (kind !== 'info' ? '.' + kind : ''), message);
  root.append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .2s'; }, ms - 200);
  setTimeout(() => t.remove(), ms);
}

// ── Modal ──────────────────────────────────────────────────────
export function openModal({ title, content, onClose }) {
  const root = document.getElementById('modal-root');
  const modal = h('div.modal', { role: 'dialog', 'aria-modal': 'true' }, title ? h('h2', title) : null, content);
  const backdrop = h('div.modal-backdrop', { onclick: (e) => { if (e.target === backdrop) close(); } }, modal);
  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  }
  document.addEventListener('keydown', onKey);
  root.append(backdrop);
  const first = modal.querySelector('input, button');
  first?.focus();
  return { close, el: modal };
}

export function confirmDialog(message, { confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title: 'Confirm',
      content: h('div',
        h('p.text-2', message),
        h('div.actions',
          h('button.btn', { onclick: () => { done = true; m.close(); resolve(false); } }, 'Cancel'),
          h('button.btn' + (danger ? '.btn-danger' : '.btn-primary'), { onclick: () => { done = true; m.close(); resolve(true); } }, confirmLabel),
        ),
      ),
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
