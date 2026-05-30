/* ═══════════════════════════════════════════════════════════════════════════
   AUDIT HARNESS (temporary, diagnostic) — public/js/audit.js

   Records what the user actually does (clicks / field changes) and every
   /api/* call the page makes, then ships it to the server (POST /api/_devlog)
   so it lands in logs/audit.jsonl where it can be inspected from a terminal.

   Purpose: drive the guided UI walkthrough / dead-code cleanup. NOT a feature.
   Remove this file + its <script> tag + the server-side harness when done.

   OFF by default. Enable by opening the app with ?audit=1 in the URL:
     http://localhost:3000/?audit=1
   The flag survives the app's own location.reload() (query string is kept).
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  if (!new URLSearchParams(location.search).has('audit')) return;

  const ENDPOINT = '/api/_devlog';
  const buffer = [];
  let seq = 0;

  function push(ev) {
    ev.seq = ++seq;
    ev.ts = Date.now();
    buffer.push(ev);
    if (buffer.length >= 50) flush();
  }

  function flush() {
    if (!buffer.length) return;
    const payload = JSON.stringify({ events: buffer.splice(0) });
    try {
      const blob = new Blob([payload], { type: 'application/json' });
      if (!navigator.sendBeacon(ENDPOINT, blob)) _origFetch.call(window, ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true,
      });
    } catch {}
  }

  // ── Describe a DOM element compactly ───────────────────────────────────────
  function describe(el) {
    if (!el || el.nodeType !== 1) return { tag: '?' };
    const d = { tag: el.tagName.toLowerCase() };
    if (el.id) d.id = el.id;
    if (el.name) d.name = el.name;
    if (el.type) d.type = el.type;
    const cls = (el.className && typeof el.className === 'string')
      ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    if (cls) d.cls = cls;
    const label = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '';
    if (label) d.label = label.slice(0, 60);
    const ph = el.getAttribute && el.getAttribute('placeholder');
    if (ph) d.placeholder = ph.slice(0, 60);
    // Short visible text for buttons / links / tabs
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (txt && txt.length <= 80) d.text = txt;
    else if (txt) d.text = txt.slice(0, 77) + '…';
    // data-* attributes (often the real identity of a control)
    if (el.dataset) {
      const data = {};
      for (const k of Object.keys(el.dataset)) data[k] = String(el.dataset[k]).slice(0, 40);
      if (Object.keys(data).length) d.data = data;
    }
    return d;
  }

  function safeValue(el) {
    if (!el) return undefined;
    const type = (el.type || '').toLowerCase();
    if (type === 'password') return '<hidden>';
    if (type === 'file') {
      return el.files ? [...el.files].map(f => `${f.name} (${f.size}b)`).join(', ') : '<file>';
    }
    if (type === 'checkbox' || type === 'radio') return el.checked;
    const v = el.value;
    if (v == null) return undefined;
    return String(v).length > 100 ? String(v).slice(0, 100) + '…' : v;
  }

  // ── Wrap fetch so every API call is recorded ───────────────────────────────
  const _origFetch = window.fetch;
  window.fetch = function (...args) {
    let url = '', method = 'GET';
    try {
      const a0 = args[0];
      url = (typeof a0 === 'string') ? a0 : (a0 && a0.url) || '';
      method = (args[1] && args[1].method) || (a0 && a0.method) || 'GET';
    } catch {}
    if (url && url.indexOf(ENDPOINT) !== -1) return _origFetch.apply(this, args); // don't log ourselves
    const t0 = performance.now();
    return _origFetch.apply(this, args).then(
      res => { push({ kind: 'fetch', method, url, status: res.status, ms: Math.round(performance.now() - t0) }); return res; },
      err => { push({ kind: 'fetch', method, url, error: String(err && err.message || err), ms: Math.round(performance.now() - t0) }); throw err; }
    );
  };

  // ── User interactions (capture phase so we see them even if stopPropagation) ─
  document.addEventListener('click', e => push({ kind: 'click', el: describe(e.target) }), true);
  document.addEventListener('change', e => push({ kind: 'change', el: describe(e.target), value: safeValue(e.target) }), true);
  document.addEventListener('submit', e => push({ kind: 'submit', el: describe(e.target) }), true);

  // ── JS errors + unhandled promise rejections (async handlers like CREATE) ───
  window.addEventListener('error', e => {
    push({ kind: 'jserror', message: String(e.message || ''), at: (e.filename || '').split('/').pop() + ':' + e.lineno + ':' + e.colno, stack: String(e.error && e.error.stack || '').slice(0, 600) });
    flush();
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    push({ kind: 'jserror', message: 'unhandledrejection: ' + String(r && r.message || r), stack: String(r && r.stack || '').slice(0, 600) });
    flush();
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  push({ kind: 'pageload', href: location.href });
  setInterval(flush, 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);

  // Manual stage marker, callable from DevTools or by the operator: window.auditMark('Эдит: открыл вкладку')
  window.auditMark = label => { push({ kind: 'mark', label: String(label) }); flush(); };

  console.log('%c[audit] harness active — logging clicks + /api calls to logs/audit.jsonl', 'color:#0a0');
})();
