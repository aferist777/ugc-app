/* ════════════════════════════════════════════════════════════════════════
   APP LOG — unified request inspector for ALL LLM + media-generation calls.

   - Captures every loggable /api request app-wide via a global fetch wrapper.
   - Flat request list (top) + Request / Response detail (bottom), Postman-dark,
     inside the slide-out #log-panel.
   - A request shows as "pending" the moment it is sent; the detail updates live
     when the response arrives. Async media (taskId + status polling) is followed
     and its FINAL textual answer is attached (no media rendering — text only).
   - BATCH grouping: rapid calls to the same endpoint/source collapse into ONE
     list row; the detail has a dropdown to pick the sub-item (pose #, voice #,
     line #, …) so the top list is not flooded.

   Replaces the old GenLog panel rendering (GenLog API is a safe no-op now). The
   activity strip (#activity-log) is untouched.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const MAX = 120;            // entries kept in memory
  const PERSIST = 30;         // entries persisted across reloads
  const CAP = 6000;           // max chars stored per body/response
  const GROUP_WINDOW = 3500;  // ms — same endpoint/source within this window = batch
  const LS = 'applog_v2';

  let entries = [];           // newest first; each has items[]
  let selId = null;
  let tab = 'req';
  let _seq = 0, _reqSeq = 0;

  // ── Loggable POST endpoints → kind / aggregator (ordered; first match) ────
  const RULES = [
    [/\/scenarios-v2\/lab\/(run|hooks)\b/,                             'LLM', 'OpenRouter'],
    [/\/scenarios\/ai\/(generate|analyze-product)\b/,                  'LLM', 'OpenRouter'],
    [/\/scenarios\/analyze\b/,                                         'LLM', 'OpenRouter'],
    [/\/scenarios\/emotional-tags\b/,                                  'LLM', 'OpenRouter'],
    [/\/details\/extract-items-from-scenario\b/,                       'LLM', 'OpenRouter'],
    [/\/asset-interact\/(analyze|pre-analyze|apply-analyze)\b/,        'LLM', 'OpenRouter'],
    [/\/biroly\/(analyze-for-video|analyze-for-first-frame|analyze-video|generate-category-prompt|extract-mandatory|enhance-realism)\b/, 'LLM', 'OpenRouter'],
    [/\/custom-options\/analyze-image\b/,                              'LLM', 'OpenRouter'],
    [/\/character\/refine-analyze\b/,                                  'LLM', 'OpenRouter'],
    [/\/refs\/(analyze-only|beautify)\b/,                              'LLM', 'OpenRouter'],
    [/\/prompts\/beautify\b/,                                          'LLM', 'OpenRouter'],
    [/\/audio\/translate-pose\b/,                                      'LLM', 'OpenRouter'],
    [/\/audio\/voice-design\/analyze-character\b/,                     'LLM', 'OpenRouter'],
    [/\/audio\/voice-design\/(derive-voice|previews)\b/,               'Voice', 'ElevenLabs'],
    [/\/audio\/sfx\/generate\b/,                                       'Audio', 'ElevenLabs'],
    [/\/audio\/suno\/generate\b/,                                      'Audio', 'Suno'],
    [/\/character\/(apply-pose|apply-lookbook-mix|apply-emotion)\b/,   'Image', 'Replicate'],
    [/\/characters\/pose-variations\b/,                                'Image', 'Replicate'],
    [/\/edit-pose\/generate\b/,                                        'Image', 'Replicate'],
    [/\/(lookbook|environment|obrinj)\/generate\b/,                    'Image', 'Replicate'],
    [/\/apply-(lookbook|environment)\b/,                               'Image', 'Replicate'],
    [/\/char-store\/regen-ref\b/,                                      'Image', 'Replicate'],
    [/\/asset-interact\/(generate|generate-with-analysis)\b/,          'Image', 'Replicate'],
    [/\/details\/ai\/generate\b/,                                      'Image', 'Replicate'],
    [/\/biroly\/(hands-generate|apply-edit)\b/,                        'Image', 'Replicate'],
    [/\/api\/generate$/,                                               'Image', 'Replicate'],
  ];
  const STATUS_RE = /\/(?:status|pose-status)\/([^/?]+)/; // GET poll → correlate by taskId
  function classify(path) { for (const [re, kind, agg] of RULES) if (re.test(path)) return { kind, agg }; return null; }

  function _currentSource() {
    const c = document.querySelector('.app-topnav .combo-mode-btn.active, .app-topnav .combo-mode-btn[aria-selected="true"]');
    if (c) return c.textContent.trim();
    const t = document.querySelector('.app-topnav [role="tab"][aria-selected="true"]');
    return t ? t.textContent.trim() : 'App';
  }
  function _now() { return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  function _cap(s) { s = String(s == null ? '' : s); return s.length > CAP ? s.slice(0, CAP) + '\n… (truncated)' : s; }
  function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function _shortEp(p) { const s = p.split('/').filter(Boolean); return s.slice(-2).join('/'); }

  // ── Store ─────────────────────────────────────────────────────────────────
  function _entryStatus(e) {
    if (e.items.some(i => i.status === 'pending')) return 'pending';
    if (e.items.some(i => i.status === 'error')) return 'error';
    return 'done';
  }
  function _findItem(reqId) {
    for (const e of entries) { const it = e.items.find(i => i.reqId === reqId); if (it) return { e, it }; }
    return null;
  }
  function _findByTask(tid) {
    for (const e of entries) { const it = e.items.find(i => i.taskId === tid && i.status === 'pending'); if (it) return { e, it }; }
    return null;
  }

  function _route(m) {
    const item = { reqId: ++_reqSeq, ts: m.ts, model: m.model, method: m.method, status: 'pending',
      startMs: m.startMs, ms: null, params: m.params, body: m.body, response: null, error: null, taskId: null };
    const last = entries[0];
    if (last && last.endpoint === m.endpoint && last.kind === m.kind && last.source === m.source &&
        ((m.startMs - last.items[last.items.length - 1].startMs) <= GROUP_WINDOW || last.items.some(i => i.status === 'pending'))) {
      last.items.push(item);
      last.selItem = last.items.length - 1;
      last.model = m.model;
      _render(); _persist();
      return item.reqId;
    }
    const e = { id: ++_seq, ts: m.ts, source: m.source, kind: m.kind, agg: m.agg, model: m.model, endpoint: m.endpoint, items: [item], selItem: 0 };
    entries.unshift(e);
    if (entries.length > MAX) entries.length = MAX;
    if (selId == null) selId = e.id;
    _render(); _persist();
    return item.reqId;
  }
  function _patchItem(reqId, upd) { const f = _findItem(reqId); if (!f) return; Object.assign(f.it, upd); _render(); _persist(); }

  function _persist() {
    try { localStorage.setItem(LS, JSON.stringify(entries.filter(e => _entryStatus(e) !== 'pending').slice(0, PERSIST))); } catch {}
  }
  function _restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(LS) || '[]');
      if (Array.isArray(saved) && saved.length) {
        entries = saved.map(e => ({ ...e, items: e.items || [] }));
        _seq = saved.reduce((mx, e) => Math.max(mx, e.id || 0), 0);
        selId = saved[0].id;
      }
    } catch {}
  }

  // ── Response interpretation ───────────────────────────────────────────────
  function _hasResult(d) {
    return !!(d && (d.imagePath || d.videoPath || d.imageUrl || d.audioPath || d.output || d.text ||
      d.url || d.previews || d.breakdown || d.analysis || (Array.isArray(d.variants)) || (Array.isArray(d.hooks)) || (Array.isArray(d.lines))));
  }
  function _isFinalState(d) {
    const s = String((d && (d.state || d.status)) || '').toLowerCase();
    return d && (d.success === true || d.success === false || /success|complete|succeed|done|ready|fail|error/.test(s) || _hasResult(d));
  }

  // ── fetch interceptor ─────────────────────────────────────────────────────
  const _origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    init = init || {};
    const url = (typeof input === 'string') ? input : (input && input.url) || '';
    const method = (init.method || (typeof input === 'object' && input && input.method) || 'GET').toUpperCase();
    const path = url.split('?')[0];
    let reqId = null, statusTid = null;

    try {
      if (method === 'POST' && url.indexOf('/api/') !== -1) {
        const rule = classify(path);
        if (rule) {
          let body, params = {};
          try { body = init.body ? JSON.parse(init.body) : undefined; } catch { body = init.body; }
          if (body && typeof body === 'object' && !(body instanceof FormData)) {
            for (const [k, v] of Object.entries(body)) {
              if (v == null) continue; const t = typeof v;
              if (t === 'string' || t === 'number' || t === 'boolean') params[k] = (t === 'string' && v.length > 80) ? v.slice(0, 80) + '…' : v;
            }
          }
          reqId = _route({ ts: _now(), source: _currentSource(), kind: rule.kind, agg: rule.agg,
            model: (body && (body.model || body.openRouterModel)) || rule.agg, method, endpoint: path,
            params, body: _cap(body && typeof body === 'object' ? JSON.stringify(body, null, 2) : (body || '')), startMs: Date.now() });
        }
      } else if (method === 'GET') {
        const mt = path.match(STATUS_RE);
        if (mt && _findByTask(mt[1])) statusTid = mt[1];
      }
    } catch {}

    const p = _origFetch(input, init);
    if (reqId == null && statusTid == null) return p;

    return p.then(resp => {
      try {
        const ct = resp.headers.get('content-type') || '';
        if (ct.includes('json')) {
          resp.clone().json().then(data => {
            if (statusTid) { _resolveTask(statusTid, data); return; }
            const f = _findItem(reqId); if (!f) return;
            const ms = Date.now() - f.it.startMs;
            const isErr = resp.status >= 400 || (data && data.success === false);
            const tid = data && (data.taskId || data.task_id || data.id);
            const mdl = (data && data.meta && (data.meta.modelUsed || data.meta.model)) || null;
            if (isErr) {
              _patchItem(reqId, { ms, status: 'error', error: (data && (data.error || data.msg)) || ('HTTP ' + resp.status), model: mdl || f.it.model });
            } else if (tid && !_hasResult(data)) {
              // async media — wait for the status poll to bring the final text
              _patchItem(reqId, { taskId: String(tid), response: 'queued · taskId ' + tid, model: mdl || f.it.model });
            } else {
              _patchItem(reqId, { ms, status: 'done', response: _cap(JSON.stringify(data, null, 2)), model: mdl || f.it.model });
            }
          }).catch(() => { if (reqId != null) _patchItem(reqId, { status: 'done', response: '(non-JSON response)' }); });
        } else if (reqId != null) {
          _patchItem(reqId, { status: resp.status >= 400 ? 'error' : 'done', error: resp.status >= 400 ? 'HTTP ' + resp.status : null, response: 'HTTP ' + resp.status + ' (' + (ct || 'no content-type') + ')' });
        }
      } catch {}
      return resp;
    }).catch(err => { if (reqId != null) _patchItem(reqId, { status: 'error', error: 'Network: ' + (err && err.message || 'failed') }); throw err; });
  };

  function _resolveTask(tid, data) {
    const f = _findByTask(tid); if (!f) return;
    if (!_isFinalState(data)) return; // still processing — ignore
    const s = String((data.state || data.status) || '').toLowerCase();
    const failed = data.success === false || /fail|error/.test(s);
    const ms = Date.now() - f.it.startMs;
    // text-only final answer (media paths appear as text, not rendered)
    _patchItem(f.it.reqId, failed
      ? { ms, status: 'error', error: (data.error || data.msg || ('failed: ' + (s || 'unknown'))) }
      : { ms, status: 'done', response: _cap(JSON.stringify(data, null, 2)) });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function _root() { return document.getElementById('applog-root'); }
  function _itemLabel(it, i) {
    const keys = ['pose', 'line', 'index', 'idx', 'scene', 'role', 'name', 'voice', 'emotion', 'text', 'poseScene', 'prompt'];
    let hint = '';
    for (const k of keys) { if (it.params && it.params[k] != null) { hint = String(it.params[k]).slice(0, 26); break; } }
    const ico = it.status === 'error' ? '✕' : (it.status === 'pending' ? '…' : '✓');
    return `#${i + 1}${hint ? ' · ' + hint : ''}  ${ico}`;
  }
  function _render() {
    const root = _root(); if (!root) return;
    if (!root._built) _buildShell(root);
    const list = root.querySelector('.al-list');
    list.innerHTML = entries.map(e => _itemHTML(e)).join('') || '<div class="al-empty">No requests yet.</div>';
    list.querySelectorAll('.al-item').forEach(it => it.addEventListener('click', () => { selId = +it.dataset.id; _render(); }));
    const e = entries.find(x => x.id === selId);
    root.querySelector('.al-body').innerHTML = _detailHTML(e);
    const pick = root.querySelector('.al-pick');
    if (pick && e) pick.addEventListener('change', () => { e.selItem = +pick.value; _render(); });
    root.querySelectorAll('.al-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    const cnt = root.querySelector('.al-count'); if (cnt) cnt.textContent = entries.length ? '(' + entries.length + ')' : '';
  }
  function _buildShell(root) {
    root._built = true;
    root.innerHTML =
      '<div class="al-bar"><span class="al-title">⚡ LLM &amp; media</span><span class="al-count"></span>' +
      '<span class="al-clear" title="Clear log">clear</span></div>' +
      '<div class="al-list"></div>' +
      '<div class="al-detail"><div class="al-tabs">' +
      '<button data-t="req" class="on">Request</button><button data-t="res">Response</button>' +
      '</div><div class="al-body"></div></div>';
    root.querySelector('.al-clear').addEventListener('click', () => { entries = []; selId = null; _persist(); _render(); });
    root.querySelectorAll('.al-tabs button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.t; _render(); }));
  }
  function _itemHTML(e) {
    const st = _entryStatus(e);
    const n = e.items.length;
    const errN = e.items.filter(i => i.status === 'error').length;
    const name = _shortEp(e.endpoint) + (n > 1 ? ' ×' + n + (errN ? ' (' + errN + '✕)' : '') : '');
    return '<div class="al-item' + (e.id === selId ? ' sel' : '') + '" data-id="' + e.id + '">' +
      '<span class="al-st al-st-' + st + '"></span>' +
      '<span class="al-time">' + e.ts + '</span>' +
      '<span class="al-badge al-k-' + e.kind + '">' + e.kind + '</span>' +
      '<span class="al-name">' + _esc(name) + '</span>' +
      '<span class="al-badge al-agg">' + _esc(e.agg) + '</span>' +
      '<span class="al-src">' + _esc(e.source) + '</span></div>';
  }
  function _detailHTML(e) {
    if (!e) return '<div class="al-empty">Select a request.</div>';
    let head = '';
    if (e.items.length > 1) {
      head = '<div class="al-batch"><span class="al-batch-lbl">Batch ×' + e.items.length + '</span>' +
        '<select class="al-pick">' + e.items.map((it, i) => '<option value="' + i + '"' + (i === e.selItem ? ' selected' : '') + '>' + _esc(_itemLabel(it, i)) + '</option>').join('') + '</select></div>';
    }
    const it = e.items[e.selItem] || e.items[0];
    return head + _itemDetail(e, it);
  }
  function _itemDetail(e, it) {
    if (tab === 'req') {
      const kv = (k, v) => '<div class="al-kv"><b>' + k + '</b><span>' + _esc(v) + '</span></div>';
      let h = kv('Source', e.source) + kv('Kind', e.kind) + kv('Aggregator', e.agg) + kv('Model', it.model) +
        kv('Endpoint', it.method + ' ' + e.endpoint) + kv('Time', it.ts) +
        kv('Status', it.status + (it.ms != null ? '  ·  ' + it.ms + ' ms' : '') + (it.taskId ? '  ·  task ' + it.taskId : ''));
      if (e.items.length > 1) h += kv('Batch item', (e.selItem + 1) + ' / ' + e.items.length);
      const pk = Object.keys(it.params || {});
      if (pk.length) { h += '<div class="al-sec">Parameters</div>'; pk.forEach(k => h += kv(k, it.params[k])); }
      h += '<div class="al-sec">Request body</div><pre class="al-pre">' + _esc(it.body) + '</pre>';
      return h;
    }
    if (it.status === 'pending') return '<div class="al-wait">Waiting for response</div>' + (it.response ? '<pre class="al-pre" style="margin-top:8px;">' + _esc(it.response) + '</pre>' : '');
    if (it.status === 'error') return '<div class="al-sec">Error</div><div class="al-err">' + _esc(it.error) + '</div>';
    return '<div class="al-sec">Response  ·  ' + (it.ms != null ? it.ms + ' ms' : '') + '</div><pre class="al-pre">' + _esc(it.response || '(no body)') + '</pre>';
  }

  // ── CSS (Postman dark) ────────────────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('applog-css')) return;
    const css = `
      #log-body{padding:0 !important;overflow:hidden !important;display:flex !important;flex-direction:column !important;}
      #applog-root{display:flex;flex-direction:column;height:100%;min-height:0;background:#22262e;color:#d7dbe2;font-size:12px;}
      #applog-root .al-bar{display:flex;align-items:center;gap:7px;padding:7px 10px;background:#1a1d24;border-bottom:1px solid #0e1116;flex:0 0 auto;font-weight:700;}
      #applog-root .al-count{opacity:.5;font-weight:400;}
      #applog-root .al-clear{margin-left:auto;font-size:11px;font-weight:600;cursor:pointer;color:#9cc0ff;background:#27406b;padding:2px 9px;border-radius:5px;}
      #applog-root .al-list{flex:0 0 44%;overflow-y:auto;min-height:0;}
      #applog-root .al-item{display:flex;align-items:center;gap:6px;padding:6px 9px;cursor:pointer;border-bottom:1px solid #2b2f38;white-space:nowrap;}
      #applog-root .al-item:hover{background:#2a2f39;}
      #applog-root .al-item.sel{background:#30384a;}
      #applog-root .al-st{width:8px;height:8px;border-radius:50%;flex:0 0 auto;}
      #applog-root .al-st-done{background:#2ecc71;}
      #applog-root .al-st-error{background:#e74c3c;}
      #applog-root .al-st-pending{background:#f1c40f;animation:alpulse 1s infinite;}
      @keyframes alpulse{0%,100%{opacity:1}50%{opacity:.3}}
      #applog-root .al-time{font-variant-numeric:tabular-nums;opacity:.6;flex:0 0 auto;}
      #applog-root .al-badge{font-size:9px;font-weight:700;padding:1px 6px;border-radius:9px;flex:0 0 auto;}
      #applog-root .al-k-LLM{background:#27406b;color:#9cc0ff;}
      #applog-root .al-k-Image{background:#1f5138;color:#8ee5b3;}
      #applog-root .al-k-Video{background:#5a2730;color:#ff9aa6;}
      #applog-root .al-k-Voice,#applog-root .al-k-Audio{background:#4a3768;color:#d3b8ff;}
      #applog-root .al-agg{background:#3a3320;color:#e6cf8a;}
      #applog-root .al-name{overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;opacity:.9;}
      #applog-root .al-src{font-size:9px;opacity:.5;flex:0 0 auto;}
      #applog-root .al-detail{flex:1;min-height:0;display:flex;flex-direction:column;border-top:2px solid #0e1116;}
      #applog-root .al-tabs{display:flex;gap:2px;padding:5px 8px 0;flex:0 0 auto;}
      #applog-root .al-tabs button{font:inherit;font-size:11px;padding:4px 12px;border:none;cursor:pointer;border-radius:6px 6px 0 0;background:#2b303a;color:#aab1bf;}
      #applog-root .al-tabs button.on{background:#5b8cff;color:#0b1220;font-weight:700;}
      #applog-root .al-body{flex:1;min-height:0;overflow-y:auto;padding:8px 10px;}
      #applog-root .al-batch{display:flex;align-items:center;gap:8px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #2b2f38;}
      #applog-root .al-batch-lbl{font-size:10px;font-weight:700;color:#e6cf8a;text-transform:uppercase;flex:0 0 auto;}
      #applog-root .al-pick{flex:1;min-width:0;background:#1a1d24;color:#d7dbe2;border:1px solid #2b2f38;border-radius:5px;padding:4px 6px;font:inherit;font-size:11px;}
      #applog-root .al-kv{display:flex;gap:8px;padding:2px 0;font-size:11px;}
      #applog-root .al-kv b{flex:0 0 86px;color:#8b93a3;font-weight:600;}
      #applog-root .al-kv span{flex:1;min-width:0;word-break:break-word;}
      #applog-root .al-sec{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#7f8696;margin:9px 0 3px;}
      #applog-root .al-pre{white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Consolas,monospace;font-size:11px;margin:0;padding:7px;border-radius:5px;background:#1a1d24;border:1px solid #2b2f38;color:#cdd3dc;}
      #applog-root .al-wait{font-size:12px;color:#e6cf8a;}
      #applog-root .al-wait::after{content:'…';animation:aldots 1.2s steps(4) infinite;}
      @keyframes aldots{0%{content:''}25%{content:'.'}50%{content:'..'}75%{content:'...'}}
      #applog-root .al-err{color:#ff9aa6;font-weight:600;white-space:pre-wrap;}
      #applog-root .al-empty{padding:14px 10px;color:#7f8696;font-size:11px;}
    `;
    const st = document.createElement('style'); st.id = 'applog-css'; st.textContent = css; document.head.appendChild(st);
  }

  function init() {
    _injectCSS();
    const body = document.getElementById('log-body');
    if (body && !document.getElementById('applog-root')) body.innerHTML = '<div id="applog-root"></div>';
    _restore();
    _render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.AppLog = { entries: () => entries, clear: () => { entries = []; selId = null; _persist(); _render(); } };
})();
