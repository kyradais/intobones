/* js/view/dom.js — Tiny DOM helpers: $, $$, h() element builder, toasts, downloads, sleep.
 * State: none
 * Gotchas: h() sets "value" and "checked" after children are appended so <select value> works. Attributes with
 *          null/undefined/false are skipped; "on<event>" functions become listeners.
 *
 * @auto-deps-begin
 * Defines: $, $$, downloadHref, downloadText, h, setHidden, sleep, toast
 * Uses: (none)
 * @auto-deps-end
 */
function $(selector, root) {
  return (root || document).querySelector(selector);
}

function $$(selector, root) {
  return Array.from((root || document).querySelectorAll(selector));
}

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  let value;
  let checked;
  Object.entries(attrs || {}).forEach(([key, val]) => {
    if (val === null || val === undefined || val === false) return;
    if (key === 'class') el.className = val;
    else if (key === 'value') value = val;
    else if (key === 'checked') checked = !!val;
    else if (key.startsWith('on') && typeof val === 'function') el.addEventListener(key.slice(2), val);
    else el.setAttribute(key, val === true ? '' : val);
  });
  kids.flat(Infinity).forEach((kid) => {
    if (kid === null || kid === undefined || kid === false) return;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  });
  if (value !== undefined) el.value = value;
  if (checked !== undefined) el.checked = checked;
  return el;
}

function setHidden(el, hidden) {
  if (el) el.hidden = !!hidden;
}

function toast(message, kind) {
  const box = $('#toasts');
  if (!box) return;
  const el = h('div', { class: 'toast ' + (kind || 'info'), role: kind === 'error' ? 'alert' : 'status' }, message);
  box.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 8000 : 4000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function downloadHref(filename, href) {
  const a = h('a', { href, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
}

function downloadText(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  downloadHref(filename, url);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
