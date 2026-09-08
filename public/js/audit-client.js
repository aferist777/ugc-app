/* audit-client.js — what the person pressed, sent up in batches.

   One script on every page. It watches the whole document rather than any particular control,
   so a button added tomorrow is in the log the first time it is pressed - by its label, in the
   panel or window it sits in. Nothing here decides what a press MEANS; the server writes the
   row with the person from the session and the Activity tab shows it beside the actions the
   press caused.

   WHAT IS SENT: clicks on buttons and links (label, where), dropdown choices, toggles, a field
   when it is committed (before -> after; a password never), Enter / Esc in a field and the
   editing keys outside one, and one row per timeline edit from Merge's store. Not sent: mouse
   movement, scrolling, hovering, typing letter by letter.

   HOW: events queue up and go every two seconds, or at twenty-five, or when the tab is hidden
   or closed (sendBeacon, which survives the page going away). A label is the control's own
   text - data-audit overrides it, aria-label and title fill in for icons - and "where" is the
   nearest data-audit-scope, dialog title or panel title. */

(function () {
  if (window.__auditClient) return;
  window.__auditClient = true;

  const PAGES = [['/character', 'Character'], ['/scenarios', 'Scenarios'], ['/merge', 'Merge'], ['/birols', 'Birols'],
                 ['/library2', 'Library2'], ['/library', 'Library'], ['/admin', 'Admin']];
  const here = location.pathname.replace(/\/+$/, '') || '/';
  const PAGE = (PAGES.find(([pre]) => here === pre || here.startsWith(pre + '/') || here.startsWith(pre + '-')) || [null, here])[1];

  // ── the batch ─────────────────────────────────────────────────────────────
  const queue = [];
  let timer = 0;
  function push(e) {
    queue.push({ at: new Date().toISOString(), ...e });
    if (queue.length >= 25) flush();
    else if (!timer) timer = setTimeout(flush, 2000);
  }
  function flush(leaving) {
    clearTimeout(timer); timer = 0;
    if (!queue.length) return;
    const body = JSON.stringify({ page: PAGE, events: queue.splice(0, 200) });
    try {
      if (leaving && navigator.sendBeacon) {
        navigator.sendBeacon('/api/audit/events', new Blob([body], { type: 'application/json' }));
        return;
      }
      fetch('/api/audit/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    } catch (e) { /* the log is never a reason for the page to fail */ }
  }
  addEventListener('pagehide', () => flush(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });

  // ── words ─────────────────────────────────────────────────────────────────
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const short = (s, n) => { s = clean(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  // Which project is open: Merge keeps it in the address, Scenarios in its picker.
  function ids() {
    const out = {};
    try { const u = new URLSearchParams(location.search); if (u.get('p')) out.key = u.get('p'); } catch (e) {}
    const sp = document.getElementById('sv3-project');
    if (sp && sp.value) out.projectId = sp.value;
    return Object.keys(out).length ? out : null;
  }

  function labelOf(el) {
    return short(el.getAttribute('data-audit') || el.getAttribute('aria-label') || clean(el.textContent)
                 || el.getAttribute('title') || el.value || el.id || el.className || el.tagName.toLowerCase(), 40);
  }
  function fieldName(el) {
    if (el.getAttribute('data-audit')) return el.getAttribute('data-audit');
    if (el.id) {
      const l = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
      if (l && clean(l.textContent)) return short(l.textContent, 40);
    }
    const lab = el.closest('label');
    if (lab) {
      const own = lab.querySelector('span,b,strong');
      const t = clean(own ? own.textContent : lab.textContent);
      if (t) return short(t, 40);
    }
    return short(el.getAttribute('aria-label') || el.getAttribute('title') || el.placeholder || el.name || el.id || el.tagName.toLowerCase(), 40);
  }
  // The window or panel a control sits in, by the nearest thing that names one.
  function scopeOf(el) {
    const s = el.closest('[data-audit-scope]');
    if (s) return s.getAttribute('data-audit-scope');
    const d = el.closest('[role="dialog"],[aria-modal="true"]');
    if (d) {
      const lb = d.getAttribute('aria-labelledby');
      const h = (lb && document.getElementById(lb)) || d.querySelector('.dio-title,.adm-title,.mv3-x-head,h1,h2,h3');
      if (h) return short(h.textContent, 30);
    }
    const panel = el.closest('.mv3-panel,.sv3-col,.mv3-qpop,section[id],.adm-panel');
    if (panel) {
      const h = panel.querySelector('.mv3-panel-title,.sv3-col-title,.adm-title,h2,h3');
      if (h) return short(h.textContent, 30);
    }
    return null;
  }
  const where = (el) => { const s = scopeOf(el); return s ? ' in ' + s : ''; };
  const isField = (el) => !!(el && el.matches && (el.isContentEditable
    || el.matches('textarea,input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file])')));
  const valueOf = (el) => (el.isContentEditable ? el.textContent : el.value);

  // ── clicks ────────────────────────────────────────────────────────────────
  document.addEventListener('click', (ev) => {
    const el = ev.target && ev.target.closest && ev.target.closest('button,a[href],[role="button"],input[type="button"],input[type="submit"],summary,[data-audit]');
    if (!el) return;
    if (el.matches('a[href]') && !el.matches('[role="button"]')) {
      const href = el.getAttribute('href') || '';
      push({ marker: 'link', kind: 'click.link', label: `went to ${labelOf(el)}${href.startsWith('/') ? ' (' + href + ')' : ''}`, ids: ids() });
      return;
    }
    push({ marker: 'button', kind: 'click.button', label: `pressed "${labelOf(el)}"${where(el)}${el.disabled ? ' (disabled)' : ''}`, ids: ids() });
  }, true);

  // ── dropdowns, toggles, fields ────────────────────────────────────────────
  // A field is one row when it is committed - the value before it was focused against the
  // value after - never a row per keystroke.
  const before = new WeakMap();
  document.addEventListener('focusin', (ev) => {
    const el = ev.target;
    if (isField(el) || (el && el.matches && el.matches('select,input[type=range],input[type=number]'))) before.set(el, valueOf(el));
  }, true);
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (!el || !el.matches) return;
    if (el.matches('select')) {
      const o = el.options[el.selectedIndex];
      push({ marker: 'dropdown', kind: 'click.dropdown', label: `chose "${short(o ? o.textContent : el.value, 60)}" in ${fieldName(el)}${where(el)}`, ids: ids() });
      return;
    }
    if (el.matches('input[type=checkbox],input[type=radio]')) {
      push({ marker: 'toggle', kind: 'click.toggle', label: `switched ${fieldName(el)} ${el.checked ? 'on' : 'off'}${where(el)}`, ids: ids() });
      return;
    }
    if (el.matches('input[type=file]')) {
      const names = Array.from(el.files || []).map(f => f.name).slice(0, 5).join(', ');
      push({ marker: 'field', kind: 'click.field', label: `picked ${el.files && el.files.length > 1 ? el.files.length + ' files' : 'a file'}${names ? ' (' + short(names, 80) + ')' : ''}${where(el)}`, ids: ids() });
      return;
    }
    if (el.matches('input[type=range],input[type=number]')) {
      const was = before.get(el);
      push({ marker: 'field', kind: 'click.field', label: `set ${fieldName(el)} ${was != null && was !== el.value ? was + ' → ' : ''}${el.value}${where(el)}`, ids: ids() });
      before.set(el, el.value);
      return;
    }
    if (isField(el)) commitField(el);
  }, true);
  // contenteditable has no change event: its commit is losing focus.
  document.addEventListener('focusout', (ev) => { if (ev.target && ev.target.isContentEditable) commitField(ev.target); }, true);
  function commitField(el) {
    const was = before.get(el);
    const val = valueOf(el);
    if (was == null || was === val) return;
    before.set(el, val);
    const secret = el.type === 'password';
    push({
      marker: 'field', kind: 'click.field',
      label: `edited ${fieldName(el)}${where(el)}` + (secret ? '' : `: "${short(was, 40)}" → "${short(val, 40)}"`),
      text: secret ? null : (String(val).length > 40 ? String(val) : null),
      ids: ids(),
    });
  }

  // ── keys ──────────────────────────────────────────────────────────────────
  document.addEventListener('keydown', (ev) => {
    const el = ev.target;
    const inField = isField(el) || (el && el.matches && el.matches('select'));
    if (inField) {
      if (ev.key === 'Enter' || ev.key === 'Escape') push({ marker: 'key', kind: 'click.key', label: `pressed ${ev.key === 'Escape' ? 'Esc' : 'Enter'} in ${fieldName(el)}${where(el)}`, ids: ids() });
      return;
    }
    const mod = ev.ctrlKey || ev.metaKey;
    if (ev.key === 'Delete' || ev.key === 'Backspace' || ev.key === ' ' || ev.key === 'Escape' || (mod && /^[zys]$/i.test(ev.key))) {
      const name = ev.key === ' ' ? 'Space' : ev.key === 'Escape' ? 'Esc' : mod ? 'Ctrl+' + ev.key.toUpperCase() : ev.key;
      push({ marker: 'key', kind: 'click.key', label: `pressed ${name}`, ids: ids() });
    }
  }, true);

  // ── the timeline, in its own words ────────────────────────────────────────
  // Merge's store describes each edit as it commits it (public/js/merge-v3/store.js) and says
  // so on the document; this is the one place a page tells the log something itself.
  document.addEventListener('mv3-audit', (ev) => {
    const d = ev.detail || {};
    push({ marker: 'drag', kind: 'timeline.edit', label: String(d.label || 'edited the timeline').slice(0, 300), ids: Object.assign({}, ids(), d.ids || {}) });
  });
})();
