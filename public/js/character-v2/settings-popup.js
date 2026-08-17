// CHARACTER SETTINGS — the popup behind the gear in the nav.
//
// Nothing here loads with the page. main.js imports this module the first time the gear is
// pressed, and this module injects its own stylesheet at the same moment. A panel most
// visits never open should not cost every visit its markup, its CSS and two API calls.
//
// What it edits is the LADDER: for each thing this page can start, an ordered list of
// pairings to try, and what happens when one refuses. The order is the priority - step one
// runs, and the rest exist for the day it does not.
//
// The chains below are drawn from what the server actually does, not from a diagram kept
// beside it. Where two of them share a ladder they say so, because they really do share one
// object: change the analyzer under "From reference" and "Save character" changes with it.

const API = '/api/character-v2/ladders';
const HEALTH = '/api/keys/health';

let _root = null;          // the backdrop, built once
let _data = null;          // { ladders, options, pairs, max }
let _health = null;
let _sec = 'api';
let _op = 'create';
let _node = null;
let _prompt = 0;
let _zoom = null;

// ── what the page can start, and what each step of it does ──────────────────
// `ladder` names which stored ladder a stage edits. Two stages naming the same one is not
// a mistake: the analyzer and the framing agent are one setting, in two places.
const OPS = {
  create: {
    label: 'Create',
    shot: '/img/cv2-help/create.webp',
    shotT: 'The Create button',
    shotN: 'Top of the Create column. Builds a portrait from the parameters alone — no reference photo.',
    stages: [
      { name: 'Create', sub: 'button' },
      { name: 'House prompt', sub: 'from presets',
        note: 'Assembled in the page from presets.js — no model and no cost. Nothing to choose here yet; an optional pass that rewrites it through a model is not built.' },
      { name: 'Draw', sub: 'text to image', ladder: 'create', main: true },
      { name: 'Poll', sub: 'until it lands' },
      { name: 'Portrait', sub: 'result' },
    ],
  },
  reference: {
    label: 'From reference',
    shot: '/img/cv2-help/reference.webp',
    shotT: 'The reference source',
    shotN: 'Bottom of the Create column. TPDNE or your own upload — the photo the portrait is built from.',
    stages: [
      { name: 'Generate', sub: 'button' },
      { name: 'Analyze', sub: 'photo + your words', ladder: 'vision', shared: 'Save character',
        note: 'Reads the reference against whatever you typed and answers with prompt material. Can refuse — and a refusal costs no generation.' },
      { name: 'Assemble', sub: 'house template + who' },
      { name: 'Draw', sub: 'image to image', ladder: 'reference', shared: 'Edit', main: true },
      { name: 'Poll', sub: 'until it lands' },
      { name: 'Portrait', sub: 'result' },
    ],
  },
  edit: {
    label: 'Edit',
    shot: '/img/cv2-help/edit.webp',
    shotT: 'The Edit button',
    shotN: 'The Create column turns into this once a portrait exists: trait chips, a field for your own words, and Edit on the floor.',
    stages: [
      { name: 'Edit', sub: 'button' },
      { name: 'Analyze', sub: 'portrait + your words', ladder: 'vision', shared: 'From reference' },
      { name: 'Assemble', sub: 'refEditPrompt · keeps the frame' },
      { name: 'Draw', sub: 'image to image · match input', ladder: 'reference', shared: 'From reference', main: true },
      { name: 'Poll', sub: 'until it lands' },
      { name: 'Portrait', sub: 'result' },
    ],
  },
  sheet: {
    label: 'Save character',
    shot: '/img/cv2-help/sheet.webp',
    shotT: 'The Save character button',
    shotN: 'Bottom of the Portrait column. Produces the 4K sheet every later generation points at.',
    stages: [
      { name: 'Save char', sub: 'button' },
      { name: 'Read the framing', sub: 'is the body in shot?', ladder: 'vision', shared: 'From reference',
        note: 'Decides whether the sheet prompt says preserve the build or construct it. Non-fatal: if nothing answers, the sheet still generates with the old wording.' },
      { name: 'Sheet prompt', sub: 'CHAR_SHEET_PROMPT' },
      { name: 'Draw the sheet', sub: '16:9', ladder: 'sheet', main: true,
        note: 'Every scene is later built from this sheet, so a step that draws it with a different engine can hand back a character who no longer looks like themselves. The attempt log records which one did.' },
      { name: 'Poll', sub: 'until it lands' },
      { name: '4K sheet', sub: 'result' },
    ],
  },
};

const PROMPTS = [
  { id: 'CV2_APPEARANCE_PROMPT', name: 'Appearance analyzer', used: 'From reference / Edit → analyze' },
  { id: 'CV2_FRAMING_PROMPT', name: 'Framing agent', used: 'Save character → read the framing' },
  { id: 'CHAR_SHEET_PROMPT', name: 'Character sheet', used: 'Save character → draw the sheet' },
];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ARROW = '<span class="cvs-arr"><svg viewBox="0 0 24 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h18M15 1l5 5-5 5"/></svg></span>';

const $ = (sel) => _root.querySelector(sel);

// ── data ────────────────────────────────────────────────────────────────────
async function _load(force) {
  const [l, h] = await Promise.all([
    fetch(API).then(r => r.json()),
    fetch(HEALTH + (force ? '?force=1' : '')).then(r => r.json()).catch(() => null),
  ]);
  if (!l || !l.success) throw new Error((l && l.error) || 'the ladders could not be read');
  _data = l;
  _health = h;
}

async function _save(op, steps) {
  const r = await fetch(API, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, steps }),
  }).then(x => x.json());
  if (!r || !r.success) throw new Error((r && r.error) || 'that could not be saved');
  // What came back, not what was sent: a step the server could not repair is gone, and the
  // panel should redraw from the truth rather than from its own optimism.
  _data.ladders[op] = r.steps;
  render();
}

const healthOf = (id) => (_health && _health.providers || []).find(p => p.id === id) || null;
const isDown = (id) => { const p = healthOf(id); return !!(p && p.state === 'down'); };
const pendingOf = (op, agg) => {
  const o = _data.options[op];
  const p = o && o.providers.find(x => x.id === agg);
  return (p && p.pending) || '';
};

// ── pieces ──────────────────────────────────────────────────────────────────
// Which node a tab opens on. `main` rather than "the first one with a ladder", because
// three of the four chains have the shared vision ladder first - so switching tabs would
// land on the same two rows three times and read as a tab that did nothing. The main node
// is the one the button is named for; the analyzer is still one click away.
function stageOf(op) {
  const st = OPS[op].stages;
  if (_node != null && st[_node] && st[_node].ladder) return _node;
  const m = st.findIndex(s => s.ladder && s.main);
  return m >= 0 ? m : st.findIndex(s => s.ladder);
}

function chain(op) {
  const cur = stageOf(op);
  return '<div class="cvs-chain">' + OPS[op].stages.map((s, i) => {
    const on = !!s.ladder;
    const lad = on ? (_data.ladders[s.ladder] || []) : [];
    const sub = on
      ? (lad.length ? lad[0].provider + (lad.length > 1 ? ' + ' + (lad.length - 1) : '') : 'not set')
      : s.sub;
    return (i ? ARROW : '')
      + '<button class="cvs-node' + (on ? '' : ' plain') + (i === cur ? ' cur' : '') + '"'
      + (on ? ' data-node="' + i + '"' : '') + '><b>' + esc(s.name) + '</b><span>' + esc(sub) + '</span></button>';
  }).join('') + '</div>';
}

function stepRow(op, key, step, i, total) {
  const o = _data.options[key];
  const isLlm = o.kind === 'llm';
  const aggs = o.providers.map(p => p.id);
  const models = (o.providers.find(p => p.id === step.provider) || {});
  const list = isLlm ? (models.models || []) : (models.engines || []).map(e => e.id);
  const eng = !isLlm && (models.engines || []).find(e => e.id === step.engine);
  const tiers = eng ? eng.tiers : null;

  const down = isDown(step.provider);
  const pend = pendingOf(key, step.provider);

  const sel = (cls, opts, cur, labels) => '<select class="' + cls + '">'
    + opts.map((v, n) => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>'
        + esc(labels ? labels[n] : v) + '</option>').join('') + '</select>';

  // A dead or pending aggregator is labelled in the list rather than removed: the key can
  // come back, and the choice should still be where it was left.
  const aggLabels = aggs.map(a => a + (isDown(a) ? '  — key refused' : (pendingOf(key, a) ? '  — in development' : '')));

  return '<div class="cvs-step' + (i === 0 ? ' first' : '') + (down || pend ? ' bad' : '') + '" data-i="' + i + '">'
    + '<span class="grip">&#8942;&#8942;</span><span class="n">' + (i + 1) + '</span>'
    + sel('agg', aggs, step.provider, aggLabels)
    + sel('mod', list, isLlm ? step.model : step.engine)
    + (tiers ? sel('tier', tiers, step.quality) : '')
    + (down ? '<span class="cvs-skip" title="' + esc(healthOf(step.provider).detail) + '">skipped</span>' : '')
    + (!down && pend ? '<span class="cvs-skip pend" title="' + esc(pend) + '">pending</span>' : '')
    + '<button class="cvs-min" title="Remove this step"' + (total < 2 ? ' disabled' : '') + '>&minus;</button>'
    + '</div>';
}

function ladderBlock(op, stage) {
  const key = stage.ladder;
  const steps = _data.ladders[key] || [];
  const pairs = _data.pairs[key] || 0;
  const cap = Math.min(_data.max, pairs);
  const used = new Set(steps.map(s => s.provider + '|' + (s.engine || s.model)));
  const left = pairs - used.size;
  const full = steps.length >= cap || left < 1;

  let h = '<div class="cvs-lad-h"><b>' + esc(stage.name) + '</b>'
    + (stage.shared ? '<span class="cvs-pill share">shared with ' + esc(stage.shared) + '</span>' : '')
    + '<span class="sp"></span><span class="cvs-note">' + esc(stage.sub) + '</span></div>'
    + '<div class="cvs-steps">' + steps.map((s, i) => stepRow(op, key, s, i, steps.length)).join('') + '</div>'
    + '<button class="cvs-add"' + (full ? ' disabled' : '') + '><span>+ add a fallback step</span>'
    + '<span class="cnt">' + steps.length + ' of ' + cap + ' · '
    + (left < 1 ? 'every pairing is in the ladder'
       : steps.length >= cap ? 'five is the cap — more steps buy waiting, not reliability'
       : left + ' pairing' + (left === 1 ? '' : 's') + ' unused') + '</span></button>';
  return h;
}

function viewApi() {
  const op = OPS[_op];
  const i = stageOf(_op);
  const stage = op.stages[i];
  let h = '<div class="cvs-stack">';
  h += '<div class="cvs-ops">' + Object.keys(OPS).map(k =>
    '<button data-op="' + k + '"' + (k === _op ? ' class="cur"' : '') + '>' + esc(OPS[k].label) + '</button>').join('') + '</div>';
  h += chain(_op);
  h += '<div class="cvs-row">'
    + '<figure class="cvs-shot" data-shot="' + esc(op.shot) + '" data-t="' + esc(op.shotT) + '" data-n="' + esc(op.shotN) + '">'
    + '<img src="' + esc(op.shot) + '" alt="' + esc(op.shotT) + '"><figcaption>' + esc(op.shotT.replace(/^The /, '')) + '</figcaption></figure>'
    + '<div class="cvs-lad">' + (stage && stage.ladder ? ladderBlock(_op, stage) : '<p class="cvs-note">Nothing to choose here.</p>') + '</div>'
    + '</div>';
  h += '<p class="cvs-note">Each step is tried in order: aggregator, then the model it can serve, then that '
    + 'model’s own tier. A step whose key is refused is stepped over rather than waited on. If none answer, '
    + 'the attempt log says what each one said.</p>';
  return h + '</div>';
}

function viewPrompts() {
  const p = PROMPTS[_prompt];
  return '<div class="cvs-stack">'
    + PROMPTS.map((x, i) => '<div class="cvs-pr' + (i === _prompt ? ' cur' : '') + '" data-pr="' + i + '">'
        + '<span class="tx"><b>' + esc(x.name) + '</b><i>' + esc(x.used) + '</i></span>'
        + '<span class="cvs-pill dim">' + esc(x.id) + '</span></div>').join('')
    + '<textarea class="cvs-edit" id="cvs-prompt-text" spellcheck="false" placeholder="loading…"></textarea>'
    + '<p class="cvs-note">Edited here, used everywhere that step runs. Saved when you click away from the box.</p>'
    + '</div>';
}

function viewDefaults() {
  return '<div class="cvs-stack"><div class="cvs-card"><div class="cvs-sec">Regenerate a saved character</div>'
    + '<p class="cvs-note" style="margin-top:9px">Walks the sheet ladder as it stands now, not the pairing the '
    + 'character was originally made with — the reason to press Regenerate is usually that the old one '
    + 'disappointed.</p></div>'
    + '<div class="cvs-card"><div class="cvs-sec">Presets</div>'
    + '<p class="cvs-note" style="margin-top:9px">A preset taken unchanged already has its 4K sheet, so saving it '
    + 'asks no engine anything. Editing it makes a new character, and that one generates the usual way.</p></div>'
    + '</div>';
}

// ── the trace ───────────────────────────────────────────────────────────────
// Grouped by the button that was pressed, because that is how anyone remembers what they
// were doing - "the save that failed", not "the call at 14:02:13". Repeats arrive already
// collapsed from the server; the bar on each row is where its time went inside the run.
const _tr = {
  runs: [], open: new Set(), sel: null, call: null, pane: 'response',
  err: false, vendor: '', full: false, thumb: null, timer: 0,
};

const _ms = (n) => n >= 10000 ? (n / 1000).toFixed(1) + 's' : n >= 1000 ? (n / 1000).toFixed(2) + 's' : n + 'ms';
const _clock = (t) => { try { return new Date(t).toLocaleTimeString(); } catch (e) { return ''; } };

function _vendors() {
  const s = new Set();
  for (const r of _tr.runs) for (const n of r.nodes) for (const c of (n.children || [])) if (c.vendor) s.add(c.vendor);
  return [...s].sort();
}

function _keep(run) {
  if (_tr.err && run.ok) return false;
  if (_tr.vendor && !run.nodes.some(n => (n.children || []).some(c => c.vendor === _tr.vendor))) return false;
  return true;
}

// One row. `t0`/`span` place the bar inside the run, so a long gap before a call is as
// visible as the call itself - which is usually where the wait actually went.
function _row(c, t0, span, kid) {
  const skipped = c.kind === 'note';
  const bad = c.ok === false;
  const at = Math.max(0, Date.parse(c.t) - t0);
  const left = span > 0 ? Math.min(99, (at / span) * 100) : 0;
  const width = span > 0 ? Math.max(1.5, Math.min(100 - left, ((c.ms || 0) / span) * 100)) : 2;
  const label = skipped ? (c.state || 'skipped') : (c.status || '—');
  return '<div class="cvs-call' + (kid ? ' kid' : '') + (bad ? ' bad' : '') + (skipped ? ' skip' : '')
    + (_tr.sel === c.id ? ' cur' : '') + '" data-call="' + esc(c.id) + '">'
    + '<span class="vd">' + esc(skipped ? (c.vendor || 'step') : (c.vendor || c.method || '')) + '</span>'
    + '<span class="ur">' + esc(String(c.url || '').replace(/^https?:\/\//, '')) + '</span>'
    + (c.repeat > 1 ? '<span class="rp">&times;' + c.repeat + '</span>' : '')
    + '<span class="wf"><i style="left:' + left.toFixed(1) + '%;width:' + width.toFixed(1) + '%"></i></span>'
    + '<span class="st">' + esc(label) + '</span>'
    + '<span class="ms">' + _ms(c.ms || 0) + '</span>'
    + '</div>';
}

function viewLog() {
  const live = window.__cv2Live || null;
  const vendors = _vendors();
  let h = '<div class="cvs-log"><div class="cvs-log-bar">'
    + '<button class="cvs-f' + (_tr.err ? ' on err' : '') + '" data-flt="err">Errors only</button>'
    + '<select data-flt="vendor"><option value="">Every aggregator</option>'
    + vendors.map(v => '<option value="' + esc(v) + '"' + (v === _tr.vendor ? ' selected' : '') + '>' + esc(v) + '</option>').join('')
    + '</select>'
    + '<span class="cvs-live"' + (live ? '' : ' hidden') + '><span class="pulse"></span>'
    + esc(live ? live.action : '') + ' · <b id="cvs-elapsed">0.0s</b></span>'
    + '</div>';

  const runs = _tr.runs.filter(_keep);
  if (!runs.length) {
    h += '<p class="cvs-note">' + (_tr.runs.length
      ? 'Nothing matches those filters.'
      : 'Nothing yet. Every call this page makes lands here — what was sent, what came back, '
        + 'and which aggregator answered.') + '</p>';
    return h + '</div>';
  }

  h += '<div class="cvs-runs">';
  for (const r of runs) {
    const open = _tr.open.has(r.runId);
    const t0 = Date.parse(r.t);
    h += '<div class="cvs-run' + (live && live.id === r.runId ? ' live' : '') + '">'
      + '<div class="cvs-run-h" data-run="' + esc(r.runId) + '">'
      + '<span class="cx">' + (open ? '&#9662;' : '&#9656;') + '</span>'
      + '<b>' + esc(r.action) + '</b>'
      + (r.merged > 1 ? '<span class="cvs-pill dim">' + r.merged + ' page fetches</span>' : '')
      + (r.ok ? '' : '<span class="cvs-pill" style="color:var(--danger)">' + r.failed + ' failed</span>')
      + '<span class="sp"></span>'
      + '<span class="m">' + r.calls + ' calls · ' + _ms(r.ms) + ' · ' + esc(_clock(r.t)) + '</span>'
      + '</div>';
    if (open) {
      h += '<div class="cvs-run-b">';
      for (const n of r.nodes) {
        h += _row(n, t0, r.ms, false);
        for (const c of (n.children || [])) h += _row(c, t0, r.ms, true);
      }
      h += '</div>';
    }
    h += '</div>';
  }
  h += '</div>';
  h += _inspector();
  return h + '</div>';
}

// ── one call, whole ─────────────────────────────────────────────────────────
function _pretty(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); }
}

// Anything in a payload that names a picture. Two kinds, and they are not the same thing:
// a file on our disk will still be there tomorrow, an aggregator's link expires within the
// hour - so they are labelled differently rather than shown as one list.
const IMG_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i;
function _imageRefs(rec) {
  const out = [];
  const seen = new Set();
  const add = (raw) => {
    const s = String(raw);
    if (seen.has(s) || out.length > 12) return;
    let url = '', kind = '';
    if (/^https?:\/\//i.test(s)) { url = s; kind = 'link'; }
    else if (/^\/?(uploads|characters|lookbooks|environments|archive|presets)\//i.test(s)) {
      url = (s.startsWith('/') ? '' : '/') + s; kind = 'file';
    } else return;
    seen.add(s);
    out.push({ url, kind, name: decodeURIComponent(url.split('/').pop().split('?')[0]) });
  };
  const walk = (v, d) => {
    if (d > 6 || out.length > 12) return;
    if (typeof v === 'string') { if (IMG_EXT.test(v)) add(v); return; }
    if (Array.isArray(v)) { v.forEach(x => walk(x, d + 1)); return; }
    if (v && typeof v === 'object') { for (const x of Object.values(v)) walk(x, d + 1); }
  };
  walk(rec.req && rec.req.body, 0);
  walk(rec.res && rec.res.body, 0);
  walk(rec.url, 0);
  return out;
}

function _inspector() {
  if (!_tr.sel) return '';
  const c = _tr.call;
  if (!c) return '<div class="cvs-insp"><div class="cvs-pay">Reading the call…</div></div>';

  const panes = {
    request: _pretty(c.req && c.req.body),
    response: _pretty(c.res && c.res.body),
    headers: 'REQUEST\n' + _pretty(c.req && c.req.headers) + '\n\nRESPONSE\n' + _pretty(c.res && c.res.headers),
  };
  const text = panes[_tr.pane] || '';
  const long = text.length > 900;
  const imgs = _imageRefs(c);

  let h = '<div class="cvs-insp"><div class="cvs-insp-h">'
    + '<span class="ti">' + esc(c.method || '') + ' ' + esc(String(c.url || '').replace(/^https?:\/\//, '').slice(0, 64)) + '</span>'
    + '<span class="sp"></span>'
    + ['request', 'response', 'headers'].map(p =>
        '<button class="cvs-tab' + (p === _tr.pane ? ' on' : '') + '" data-pane="' + p + '">' + p + '</button>').join('')
    + '<button class="cvs-tab" data-copy="1">copy</button>'
    + '<button class="cvs-x" data-close-insp="1">&times;</button>'
    + '</div>';

  if (c.error) h += '<div class="cvs-pay" style="color:var(--danger)">' + esc(c.error) + '</div>';
  h += '<pre class="cvs-pay' + (long && !_tr.full ? ' clip' : '') + '" id="cvs-payload">' + esc(text || '(empty)') + '</pre>';
  if (long) {
    h += '<button class="cvs-more" data-more="1">'
      + (_tr.full ? 'show less' : 'show all ' + text.length.toLocaleString() + ' characters') + '</button>';
  }
  if (imgs.length) {
    h += '<div class="cvs-imgs">' + imgs.map((i, n) =>
      '<span class="cvs-img" data-img="' + n + '"><span class="tg">' + i.kind + '</span>'
      + '<span class="nm">' + esc(i.name) + '</span></span>').join('') + '</div>';
    const t = _tr.thumb != null && imgs[_tr.thumb];
    h += '<div class="cvs-thumb"' + (t ? '' : ' hidden') + '>'
      + (t ? '<img src="' + esc(t.url) + '" alt="" onerror="this.replaceWith(Object.assign(document.createElement(\'div\'),'
          + '{className:\'cap\',textContent:\'that image is gone - an aggregator link only lives about an hour\'}))">'
          + '<div class="cap">' + esc(t.url) + '</div>' : '')
      + '</div>';
  }
  return h + '</div>';
}

// ── loading ─────────────────────────────────────────────────────────────────
async function _pullTrace() {
  try {
    const d = await fetch('/api/character-v2/trace?limit=40').then(r => r.json());
    _tr.runs = (d && d.runs) || [];
  } catch (e) {
    _tr.runs = [];
  }
}

async function _pullCall(id) {
  _tr.call = null;
  try {
    const d = await fetch('/api/character-v2/trace/' + encodeURIComponent(id)).then(r => r.json());
    _tr.call = d && d.success ? d.call : { url: '', error: (d && d.error) || 'not found', req: {}, res: {} };
  } catch (e) {
    _tr.call = { url: '', error: e.message, req: {}, res: {} };
  }
}

// One second, and only while this tab is on screen. The tree is the only view that changes
// on its own; the ladders do not move unless somebody moves them.
function _startTicker() {
  _stopTicker();
  _tr.timer = setInterval(async () => {
    if (_sec !== 'log' || !_root || _root.hidden) return _stopTicker();
    const live = window.__cv2Live;
    const el = _root.querySelector('#cvs-elapsed');
    if (live && el) el.textContent = ((Date.now() - live.startedAt) / 1000).toFixed(1) + 's';
    // Redrawing the whole tree every second would fight the user's scroll and close the
    // inspector under their hands, so it only redraws when the call count actually moves.
    const before = _tr.runs.reduce((n, r) => n + r.calls, 0);
    await _pullTrace();
    const after = _tr.runs.reduce((n, r) => n + r.calls, 0);
    if (after !== before) render();
  }, 1000);
}

function _stopTicker() {
  if (_tr.timer) { clearInterval(_tr.timer); _tr.timer = 0; }
}

function healthBar() {
  if (!_health || !_health.providers) return '';
  const aggs = _health.providers.filter(p => p.kind === 'aggregator');
  const age = Math.round((_health.ageMs || 0) / 60000);
  return aggs.map(p => '<span class="cvs-k ' + (p.state === 'ok' ? 'up' : p.state) + '">'
      + '<span class="cvs-dot"></span>' + esc(p.label) + ' <span class="d">' + esc(p.detail) + '</span></span>').join('')
    + '<span class="cvs-when">checked ' + (age < 1 ? 'just now' : age + ' min ago') + '</span>'
    + '<button class="cvs-recheck">Check now</button>';
}

const HEADS = { api: 'Generation chain', prompts: 'System prompts', defaults: 'Page defaults', log: 'Attempt log' };

function notes() {
  if (_sec !== 'api') return '';
  const st = OPS[_op].stages[stageOf(_op)];
  if (!st) return '';
  const out = [];
  if (st.shared) {
    out.push('<div class="cvs-fn share"><b>One setting, two places</b>This ladder is shared with '
      + esc(st.shared) + ' — they are the same stored list, so changing it here changes it there.</div>');
  }
  if (st.note) out.push('<div class="cvs-fn"><b>' + esc(st.name) + '</b>' + esc(st.note) + '</div>');
  return out.join('');
}

function render() {
  $('#cvs-h3').textContent = HEADS[_sec];
  const hb = $('#cvs-health');
  hb.innerHTML = _sec === 'api' ? healthBar() : '';
  hb.hidden = _sec !== 'api';
  const fn = $('#cvs-notes');
  fn.innerHTML = notes();
  fn.hidden = !fn.innerHTML;
  $('#cvs-canvas').classList.toggle('is-log', _sec === 'log');
  $('#cvs-canvas').innerHTML = _sec === 'prompts' ? viewPrompts()
    : _sec === 'defaults' ? viewDefaults()
    : _sec === 'log' ? viewLog() : viewApi();
  if (_sec === 'prompts') _loadPrompt();
  if (_sec === 'log') _startTicker(); else _stopTicker();
}

// ── prompts, through the registry that already owns them ────────────────────
// The same store the prompt editor writes to, and the same save endpoint - which keeps a
// version history. Editing one here is editing it there; there is no second copy.
let _pcache = null;

async function _loadPrompt() {
  const box = $('#cvs-prompt-text');
  if (!box) return;
  const id = PROMPTS[_prompt].id;
  box.value = '';
  try {
    // The registry answers with all of them at once and has no per-key route, so the list
    // is fetched once per open and the three this page cares about are picked out of it.
    if (!_pcache) {
      const d = await fetch('/api/prompts').then(r => r.json());
      _pcache = (d && d.prompts) || [];
    }
    const p = _pcache.find(x => x.key === id);
    if (!p) throw new Error('not in the registry');
    box.value = p.current || '';
    box.dataset.orig = box.value;
  } catch (e) {
    box.placeholder = 'could not be read: ' + e.message;
  }
}

async function _savePrompt() {
  const box = $('#cvs-prompt-text');
  if (!box || !box.dataset.orig || box.value === box.dataset.orig) return;
  const id = PROMPTS[_prompt].id;
  try {
    const r = await fetch('/api/prompts/' + encodeURIComponent(id) + '/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: box.value }),
    }).then(x => x.json());
    if (!r || !r.success) throw new Error((r && r.error) || 'refused');
    box.dataset.orig = box.value;
    const p = _pcache && _pcache.find(x => x.key === id);
    if (p) p.current = box.value;
  } catch (e) {
    // Said rather than swallowed: a prompt that looks saved and is not is the worst of
    // the three states.
    box.style.borderColor = 'var(--danger)';
    setTimeout(() => { box.style.borderColor = ''; }, 2500);
  }
}

// ── the hover preview ───────────────────────────────────────────────────────
function closeZoom() { if (_zoom) { _zoom.remove(); _zoom = null; } }

// ── the stylesheet, fetched with the module and not before ──────────────────
// Awaited rather than fired and forgotten: appending a <link> does not block, so without
// this the panel gets one frame of unstyled markup - a full-width stack of raw controls
// over the page - before the CSS lands.
function css() {
  return new Promise((resolve) => {
    if (document.getElementById('cvs-css')) return resolve();
    const l = document.createElement('link');
    l.id = 'cvs-css';
    l.rel = 'stylesheet';
    l.href = '/css/cv2-settings.css';
    // Resolving on error too: a panel with no styling is still usable, and refusing to
    // open it would turn a missing file into a dead button.
    l.onload = l.onerror = () => resolve();
    document.head.appendChild(l);
  });
}

// ── build once ──────────────────────────────────────────────────────────────
function build() {
  const back = document.createElement('div');
  back.className = 'cvs-back';
  back.id = 'cvs-back';
  back.innerHTML = `
    <div class="cvs">
      <div class="cvs-head">
        <h2>Character settings</h2><span class="sub">How this page generates</span>
        <span class="sp"></span><span class="saves">Changes save as you make them</span>
        <button class="cvs-x" id="cvs-close" aria-label="Close">&times;</button>
      </div>
      <div class="cvs-body">
        <div class="cvs-rail">
          <div class="cvs-rail-t">Character</div>
          <button class="cvs-nav cur" data-sec="api"><span><b>API</b><i>Who is asked, what draws it, and what happens when that fails</i></span></button>
          <button class="cvs-nav" data-sec="prompts"><span><b>Prompts</b><i>Rewrite the system prompt behind any step</i></span></button>
          <div class="cvs-rail-t">Page</div>
          <button class="cvs-nav" data-sec="defaults"><span><b>Defaults</b><i>How presets and Regenerate behave</i></span></button>
          <button class="cvs-nav" data-sec="log"><span><b>Attempt log</b><i>What every step answered on the last runs</i></span></button>
          <div class="cvs-foot" id="cvs-notes" hidden></div>
        </div>
        <div class="cvs-main">
          <div class="cvs-title"><h3 id="cvs-h3">Generation chain</h3><span class="sp"></span>
            <div class="cvs-health" id="cvs-health"></div></div>
          <div class="cvs-scroll" id="cvs-canvas"></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(back);
  _root = back;
  _wire();
  return back;
}

function _wire() {
  _root.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.id === 'cvs-close' || t === _root) return close();

    const nav = t.closest('.cvs-nav');
    if (nav) {
      _sec = nav.dataset.sec;
      _root.querySelectorAll('.cvs-nav').forEach(b => b.classList.toggle('cur', b === nav));
      // Fetched on entry rather than kept fresh in the background: the tree moves constantly
      // and there is no reason to poll it while somebody is editing a ladder.
      if (_sec === 'log') { await _pullTrace(); }
      return render();
    }

    // ── the trace ──
    if (t.closest('[data-flt="err"]')) { _tr.err = !_tr.err; return render(); }
    const runh = t.closest('[data-run]');
    if (runh) {
      const id = runh.dataset.run;
      if (_tr.open.has(id)) _tr.open.delete(id); else _tr.open.add(id);
      return render();
    }
    const call = t.closest('[data-call]');
    if (call) {
      const id = call.dataset.call;
      if (_tr.sel === id) { _tr.sel = null; _tr.call = null; return render(); }
      _tr.sel = id; _tr.full = false; _tr.thumb = null; _tr.pane = 'response';
      render();                      // show the row as selected while the payload arrives
      await _pullCall(id);
      return render();
    }
    if (t.closest('[data-close-insp]')) { _tr.sel = null; _tr.call = null; return render(); }
    const pane = t.closest('[data-pane]');
    if (pane) { _tr.pane = pane.dataset.pane; _tr.full = false; return render(); }
    if (t.closest('[data-more]')) { _tr.full = !_tr.full; return render(); }
    if (t.closest('[data-copy]')) {
      const box = $('#cvs-payload');
      const b = t.closest('[data-copy]');
      try { await navigator.clipboard.writeText(box ? box.textContent : ''); b.textContent = 'copied'; }
      catch (e) { b.textContent = 'blocked'; }
      setTimeout(() => { b.textContent = 'copy'; }, 1400);
      return;
    }
    const img = t.closest('[data-img]');
    if (img) {
      const n = parseInt(img.dataset.img, 10);
      _tr.thumb = _tr.thumb === n ? null : n;
      return render();
    }

    const op = t.closest('[data-op]');
    if (op) { _op = op.dataset.op; _node = null; return render(); }

    const node = t.closest('[data-node]');
    if (node) { _node = parseInt(node.dataset.node, 10); return render(); }

    const pr = t.closest('[data-pr]');
    if (pr) { await _savePrompt(); _prompt = parseInt(pr.dataset.pr, 10); return render(); }

    if (t.closest('.cvs-recheck')) {
      const b = t.closest('.cvs-recheck');
      b.disabled = true; b.textContent = 'Checking…';
      await _load(true); return render();
    }

    const key = OPS[_op].stages[stageOf(_op)] && OPS[_op].stages[stageOf(_op)].ladder;
    if (!key) return;

    if (t.closest('.cvs-add')) {
      const o = _data.options[key];
      const steps = (_data.ladders[key] || []).slice();
      const used = new Set(steps.map(s => s.provider + '|' + (s.engine || s.model)));
      // A live aggregator first: a step that is skipped the moment it is added is a row,
      // not a fallback.
      const cand = [];
      for (const p of o.providers) {
        const list = o.kind === 'llm' ? p.models : p.engines.map(e => e.id);
        for (const m of list) cand.push({ agg: p.id, m, live: !isDown(p.id) && !p.pending });
      }
      const pick = cand.find(c => c.live && !used.has(c.agg + '|' + c.m))
        || cand.find(c => !used.has(c.agg + '|' + c.m));
      if (!pick) return;
      const eng = o.kind === 'llm' ? null : o.providers.find(p => p.id === pick.agg).engines.find(e => e.id === pick.m);
      steps.push(o.kind === 'llm'
        ? { provider: pick.agg, model: pick.m }
        : { provider: pick.agg, engine: pick.m, quality: eng.def || eng.tiers[eng.tiers.length - 1] });
      return _save(key, steps);
    }

    const min = t.closest('.cvs-min');
    if (min && !min.disabled) {
      const i = parseInt(min.closest('.cvs-step').dataset.i, 10);
      const steps = (_data.ladders[key] || []).slice();
      steps.splice(i, 1);
      return _save(key, steps);
    }
  });

  _root.addEventListener('change', (e) => {
    if (e.target.dataset && e.target.dataset.flt === 'vendor') { _tr.vendor = e.target.value; return render(); }
    const row = e.target.closest('.cvs-step');
    if (!row) return;
    const stage = OPS[_op].stages[stageOf(_op)];
    const key = stage && stage.ladder;
    if (!key) return;
    const o = _data.options[key];
    const i = parseInt(row.dataset.i, 10);
    const steps = (_data.ladders[key] || []).slice();
    const s = { ...steps[i] };
    if (e.target.classList.contains('agg')) {
      s.provider = e.target.value;
      // The aggregator decides what the model list may contain, so the model is re-picked
      // rather than carried across - the repair the server would do anyway, done here so
      // the panel does not flash a pairing that cannot exist.
      const p = o.providers.find(x => x.id === s.provider);
      if (o.kind === 'llm') s.model = (p.models || [])[0];
      else { const e0 = (p.engines || [])[0]; s.engine = e0 && e0.id; s.quality = e0 && (e0.def || e0.tiers[0]); }
    } else if (e.target.classList.contains('mod')) {
      if (o.kind === 'llm') s.model = e.target.value;
      else {
        s.engine = e.target.value;
        const p = o.providers.find(x => x.id === s.provider);
        const e0 = (p.engines || []).find(x => x.id === s.engine);
        if (e0 && !e0.tiers.includes(s.quality)) s.quality = e0.def || e0.tiers[0];
      }
    } else if (e.target.classList.contains('tier')) {
      s.quality = e.target.value;
    }
    steps[i] = s;
    _save(key, steps);
  });

  _root.addEventListener('focusout', (e) => { if (e.target.id === 'cvs-prompt-text') _savePrompt(); });

  // Hover preview, opening LEFT: the thumbnail sits at the left edge of the canvas, so
  // opening right would cover the ladder - the one thing being looked at.
  _root.addEventListener('mouseover', (e) => {
    const fig = e.target.closest && e.target.closest('.cvs-shot');
    if (!fig) { if (_zoom && !(e.target.closest && e.target.closest('.cvs-zoom'))) closeZoom(); return; }
    if (_zoom && _zoom.dataset.for === fig.dataset.shot) return;
    closeZoom();
    const z = document.createElement('div');
    z.className = 'cvs-zoom';
    z.dataset.for = fig.dataset.shot;
    z.innerHTML = '<img src="' + esc(fig.dataset.shot) + '" alt="">'
      + '<div class="cap"><b>' + esc(fig.dataset.t) + '</b><i>' + esc(fig.dataset.n) + '</i></div>';
    document.body.appendChild(z);
    const r = fig.getBoundingClientRect();
    let top = Math.max(10, Math.min(window.innerHeight - z.offsetHeight - 10, r.top + r.height / 2 - z.offsetHeight / 2));
    let left = r.left - z.offsetWidth - 10;
    if (left < 10) left = Math.min(window.innerWidth - z.offsetWidth - 10, r.right + 10);
    z.style.top = top + 'px'; z.style.left = left + 'px';
    _zoom = z;
  });
  _root.addEventListener('mouseout', (e) => {
    const to = e.relatedTarget;
    if (_zoom && (!to || !to.closest || (!to.closest('.cvs-shot') && !to.closest('.cvs-zoom')))) closeZoom();
  });
  _root.addEventListener('scroll', closeZoom, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _root && !_root.hidden) close(); });
}

export function close() {
  closeZoom();
  _stopTicker();               // a hidden panel polling every second is a leak, not a feature
  if (_root) _root.hidden = true;
  document.body.classList.remove('cvs-open');
}

export async function open() {
  if (!_root) { await css(); build(); }
  _root.hidden = false;
  document.body.classList.add('cvs-open');
  if (!_data) {
    $('#cvs-canvas').innerHTML = '<p class="cvs-note">Reading the settings…</p>';
    try { await _load(false); } catch (e) {
      $('#cvs-canvas').innerHTML = '<p class="cvs-note">' + esc(e.message) + '</p>';
      return;
    }
  }
  // Only if the trace is the tab being opened onto. It is the one view that costs anything
  // to fetch, and three of the four sections never look at it.
  if (_sec === 'log') await _pullTrace();
  render();
}
