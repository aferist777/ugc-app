/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the panel behind the gear.

   Built on the Character settings panel's shape, because it answers the same kind of
   question and there is no reason for two windows that do the same job to be learned
   twice: a backdrop, a rail of sections down the left, and one scrolling canvas on the
   right with the aggregators' health above it.

   What it edits is not the same, though. Character's ladder is per OPERATION - create,
   reference, sheet. Merge has one operation and eleven models, so the ladder here is per
   MODEL: for each one, the order its aggregators are tried in.

   ── Nothing loads with the page ─────────────────────────────────────────────
   imagen.js imports this the first time the gear is pressed, and this module injects its
   own stylesheet at the same moment. A panel most visits never open should not cost every
   visit its markup and its CSS.

   ── What is stored and what is not ──────────────────────────────────────────
   Only the ORDER of aggregators, never the list. Which ones can serve a model is a fact
   about the outside world and belongs to the table - store the list here and a model added
   tomorrow would be invisible until somebody edited a setting.
   ════════════════════════════════════════════════════════════════════════════ */

let _root = null;
let _table = null;      // the matrix: engines, their aggregators, prices
let _set = null;        // ladders, writer, skipDown
let _health = null;
let _sec = 'ladders';
let _eng = '';          // which model the ladder view is showing
let _saving = 0;
let _writers = [];      // who can do the writing, and what they answer to
let _maxW = 5;

const $ = (sel, root) => (root || _root).querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (v) => (v == null ? '—' : '$' + (+(+v).toFixed(4)));

// ── the data ────────────────────────────────────────────────────────────────
async function load() {
  const [m, s, h] = await Promise.all([
    fetch('/api/mv3/img/matrix').then(r => r.json()).catch(() => null),
    fetch('/api/mv3/img/settings').then(r => r.json()).catch(() => null),
    fetch('/api/keys/health').then(r => r.json()).catch(() => null),
  ]);
  if (m && m.success) _table = m;
  if (s && s.success) { _set = s.settings; _writers = s.writers || []; _maxW = s.maxWriterSteps || 5; }
  _health = h || null;
  if (!_eng && _table && _table.engines.length) _eng = _table.engines[0].id;
}

// Saved as it is changed, like the panel it is modelled on - there is no Save button and
// nothing to forget to press. The counter is what makes "saving…" honest when two changes
// land close together.
async function save(patch) {
  _saving++;
  paintSaved();
  try {
    const d = await fetch('/api/mv3/img/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(r => r.json());
    if (d && d.success) _set = d.settings;
  } catch (e) { /* the next change tries again */ }
  _saving--;
  paintSaved();
}

function paintSaved() {
  const el = $('#mvg-saved');
  if (el) el.textContent = _saving ? 'saving…' : 'Changes save as you make them';
}

// ── health, the three that matter here ──────────────────────────────────────
const AGG = ['kie.ai', 'openrouter', 'replicate'];

function healthBar() {
  const list = ((_health && _health.providers) || []).filter(p => AGG.includes(p.id));
  if (!list.length) return '';
  return list.map(p => '<span class="mvg-k ' + esc(p.state === 'ok' ? 'up' : p.state) + '">'
    + '<i></i>' + esc(p.label) + ' <b>' + esc(p.detail || '') + '</b></span>').join('');
}

// ── the ladders ─────────────────────────────────────────────────────────────
// One model at a time. A grid of all eleven at once would be eleven ladders nobody is
// looking at, and the thing being decided is always about one model.
function viewLadders() {
  const e = _table.engines.find(x => x.id === _eng) || _table.engines[0];
  const order = orderOf(e);
  const rows = order.map((pid, i) => rung(e, pid, i, order.length)).join('');
  const stored = !!(_set.ladders && _set.ladders[e.id]);

  return `
    <div class="mvg-pick">
      ${_table.engines.map(x => '<button class="mvg-chip' + (x.id === e.id ? ' on' : '')
        + '" data-eng="' + esc(x.id) + '">' + esc(x.label) + '</button>').join('')}
    </div>
    <p class="mvg-say">The order <b>${esc(e.label)}</b> is asked in. The first rung does the work;
      the rest are there for the day it refuses. Only the order is kept — which aggregators carry
      a model is the table's business, so one added tomorrow appears here on its own.</p>
    <div class="mvg-ladder">${rows}</div>
    ${stored ? '<button class="mvg-reset" data-reset="' + esc(e.id) + '">Back to the default order</button>' : ''}
    <label class="mvg-sw">
      <input type="checkbox" id="mvg-skip"${_set.skipDown ? ' checked' : ''}>
      <span><b>Step over an aggregator whose key is down</b>
        A rung that cannot possibly work only costs the wait.</span>
    </label>`;
}

function orderOf(e) {
  const all = e.all || e.providers;
  const want = (_set.ladders || {})[e.id];
  if (!Array.isArray(want) || !want.length) return all.slice();
  const first = want.filter(p => all.includes(p));
  return first.concat(all.filter(p => !first.includes(p)));
}

function rung(e, pid, i, n) {
  const row = (e.rows || []).find(r => r.provider === pid) || {};
  const price = row.price ? row.price[e.def] : null;
  const down = ((_health && _health.providers) || []).find(p => p.id === (pid === 'kie' ? 'kie.ai' : pid));
  const bad = down && down.state !== 'ok';
  const can = [row.t2i ? 'makes' : '', row.i2i ? 'edits' : ''].filter(Boolean).join(' &amp; ') || '—';
  return `
    <div class="mvg-rung${bad ? ' is-down' : ''}">
      <span class="mvg-no">${i + 1}</span>
      <span class="mvg-who"><b>${esc(row.label || pid)}</b>
        <i>${can} · ${esc(row.model || '')}${row.i2i && row.maxRefs ? ' · up to ' + row.maxRefs + ' refs' : ''}</i></span>
      <span class="mvg-price">${money(price)}<i>at ${esc(e.def)}</i></span>
      <span class="mvg-move">
        <button data-up="${esc(pid)}"${i === 0 ? ' disabled' : ''} title="Ask this one earlier">&#9650;</button>
        <button data-down="${esc(pid)}"${i === n - 1 ? ' disabled' : ''} title="Ask this one later">&#9660;</button>
      </span>
    </div>`;
}

// ── the writer ──────────────────────────────────────────────────────────────
// A ladder, laid out the way the picture ladders are and the way Character's is: a number, the
// aggregator, the model, and a way to move or remove the step. One choice was never enough -
// the first rung is what runs, and the rest are there for the day it refuses.
function viewWriter() {
  const w = _set.writer || {};
  const chain = w.chain || [];
  const full = chain.length >= _maxW;

  return `
    <p class="mvg-say">The writer turns what you type into a prompt shaped for the picture model
      you chose — eleven models want eleven different sentences, and it holds the rule sets so you
      do not have to. It never changes what you asked for, and what it actually sent is under
      <b>read more</b> on every picture.</p>

    <div class="mvg-ladder">${chain.map((r, i) => wRung(r, i, chain.length)).join('')}</div>
    <button class="mvg-add" data-wadd="1"${full ? ' disabled' : ''}>
      <span>+ add a fallback step</span>
      <span class="cnt">${chain.length} of ${_maxW}${full ? ' · five is the cap — more steps buy waiting, not reliability' : ''}</span>
    </button>

    <label class="mvg-sw">
      <input type="checkbox" id="mvg-writer-on"${w.on !== false ? ' checked' : ''}>
      <span><b>On by default</b>
        The ✎ beside Send starts lit. Turn it off there any time to send your words exactly as typed.</span>
    </label>`;
}

function wRung(r, i, n) {
  const prov = _writers.find(p => p.id === r.provider) || { id: r.provider, label: r.provider, models: [] };
  const down = ((_health && _health.providers) || []).find(p => p.id === (r.provider === 'kie' ? 'kie.ai' : r.provider));
  const bad = down && down.state !== 'ok';
  return `
    <div class="mvg-rung${bad ? ' is-down' : ''}" data-w="${i}">
      <span class="mvg-no">${i + 1}</span>
      <select class="mvg-sel wprov">${_writers.map(p =>
        '<option value="' + esc(p.id) + '"' + (p.id === r.provider ? ' selected' : '') + '>' + esc(p.label) + '</option>').join('')}</select>
      <select class="mvg-sel wmodel" title="The models this app has established it can reach here">${
        (prov.models || []).map(m => '<option value="' + esc(m) + '"'
          + (m === r.model ? ' selected' : '') + '>' + esc(m) + '</option>').join('')}</select>
      ${bad ? '<span class="mvg-skip" title="' + esc((down && down.detail) || '') + '">skipped</span>' : ''}
      <span class="mvg-move">
        <button data-wup="${i}"${i === 0 ? ' disabled' : ''} title="Ask this one earlier">&#9650;</button>
        <button data-wdown="${i}"${i === n - 1 ? ' disabled' : ''} title="Ask this one later">&#9660;</button>
      </span>
      <button class="mvg-min" data-wdel="${i}"${n < 2 ? ' disabled' : ''} title="Remove this step">&minus;</button>
    </div>`;
}

// Written whole rather than as a patch of one rung: the stored thing is an ORDER, and sending
// half of one would leave the rest to be inferred.
function saveChain(chain) {
  _set.writer = Object.assign({}, _set.writer, { chain });
  render();
  return save({ writer: { chain } });
}

// ── the almanac, as it stands ───────────────────────────────────────────────
// Read-only for now. It is here because the rule a model follows is the thing you most want to
// see while deciding which model to use, and reading it should not mean opening a file.
function viewAlmanac() {
  const e = _table.engines.find(x => x.id === _eng) || _table.engines[0];
  const r = e.rule;
  if (!r) return '<p class="mvg-say">No rule set for this one yet.</p>';
  const li = (a) => (a || []).map(x => '<li>' + esc(x) + '</li>').join('');
  return `
    <div class="mvg-pick">
      ${_table.engines.map(x => '<button class="mvg-chip' + (x.id === e.id ? ' on' : '')
        + '" data-eng="' + esc(x.id) + '">' + esc(x.label) + '</button>').join('')}
    </div>
    <div class="mvg-rule">
      <div class="mvg-rule-row"><span class="k">Shape</span><span class="v">${esc(r.form)} · ${esc(r.sweetSpot || '')}</span></div>
      <div class="mvg-rule-row"><span class="k">Exclusions</span><span class="v">${
        r.negatives === 'none' ? 'never read — every constraint must name something present'
        : r.negatives === 'field' ? 'a real negative field exists upstream'
        : 'no field; "no X" inside the prompt is obeyed'}</span></div>
      <div class="mvg-rule-row"><span class="k">Formula</span><span class="v mono">${esc(r.formula || '—')}</span></div>
      ${r.editFormula ? '<div class="mvg-rule-row"><span class="k">Editing</span><span class="v mono">' + esc(r.editFormula) + '</span></div>' : ''}
      ${r.refFormula ? '<div class="mvg-rule-row"><span class="k">References</span><span class="v mono">' + esc(r.refFormula) + '</span></div>' : ''}
      <div class="mvg-rule-row"><span class="k">Text</span><span class="v">${esc(r.text || '—')}</span></div>
      ${r.weakness ? '<div class="mvg-rule-row"><span class="k">Watch</span><span class="v warn">' + esc(r.weakness) + '</span></div>' : ''}
      ${(r.checklist || []).length ? '<div class="mvg-rule-row"><span class="k">Rules</span><span class="v"><ul>' + li(r.checklist) + '</ul></span></div>' : ''}
      ${(r.source || []).length ? '<div class="mvg-rule-row"><span class="k">Source</span><span class="v">'
        + r.source.map(u => '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(String(u).replace(/^https?:\/\//, '').split('/')[0]) + '</a>').join(' ')
        + '</span></div>' : ''}
    </div>`;
}

const HEADS = {
  ladders: 'Who is asked, and in what order',
  writer: 'The writer',
  almanac: 'How each model wants to be asked',
};

function render() {
  if (!_root) return;
  $('#mvg-h3').textContent = HEADS[_sec];
  const hb = $('#mvg-health');
  hb.innerHTML = _sec === 'ladders' ? healthBar() : '';
  hb.hidden = _sec !== 'ladders';
  _root.querySelectorAll('.mvg-nav').forEach(b => b.classList.toggle('cur', b.dataset.sec === _sec));
  $('#mvg-canvas').innerHTML = _sec === 'writer' ? viewWriter()
    : _sec === 'almanac' ? viewAlmanac() : viewLadders();
}

// ── the shell ───────────────────────────────────────────────────────────────
function build() {
  const back = document.createElement('div');
  back.className = 'mvg-back';
  back.innerHTML = `
    <div class="mvg">
      <div class="mvg-head">
        <h2>Pictures</h2><span class="sub">Settings for this window only — nothing here touches the timeline or the render</span>
        <span class="sp"></span><span class="saves" id="mvg-saved">Changes save as you make them</span>
        <button class="mvg-x" id="mvg-close" aria-label="Close">&times;</button>
      </div>
      <div class="mvg-body">
        <div class="mvg-rail">
          <div class="mvg-rail-t">Models</div>
          <button class="mvg-nav cur" data-sec="ladders"><span><b>Ladders</b><i>Who is asked for each model, and who catches it when they refuse</i></span></button>
          <button class="mvg-nav" data-sec="almanac"><span><b>Almanac</b><i>The prompting rules each model follows</i></span></button>
          <div class="mvg-rail-t">Writing</div>
          <button class="mvg-nav" data-sec="writer"><span><b>The writer</b><i>Which model turns what you type into a prompt</i></span></button>
        </div>
        <div class="mvg-main">
          <div class="mvg-title"><h3 id="mvg-h3"></h3><span class="sp"></span>
            <div class="mvg-health" id="mvg-health"></div></div>
          <div class="mvg-scroll" id="mvg-canvas"></div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(back);
  _root = back;
  wire();
  return back;
}

function wire() {
  _root.addEventListener('click', async (ev) => {
    const t = ev.target;
    if (t === _root || t.id === 'mvg-close') return close();

    const nav = t.closest('.mvg-nav');
    if (nav) { _sec = nav.dataset.sec; return render(); }

    const chip = t.closest('[data-eng]');
    if (chip) { _eng = chip.dataset.eng; return render(); }

    // Moving a rung writes the WHOLE order, not a swap: the stored thing is an order, and
    // sending half of one would leave the rest to be inferred.
    const up = t.closest('[data-up]'), dn = t.closest('[data-down]');
    if (up || dn) {
      const e = _table.engines.find(x => x.id === _eng);
      const order = orderOf(e);
      const pid = (up || dn).dataset.up || (up || dn).dataset.down;
      const i = order.indexOf(pid);
      const j = up ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= order.length) return;
      order.splice(j, 0, order.splice(i, 1)[0]);
      _set.ladders = Object.assign({}, _set.ladders, { [e.id]: order });
      render();
      return save({ ladders: { [e.id]: order } });
    }

    // the writer's ladder
    const wUp = t.closest('[data-wup]'), wDn = t.closest('[data-wdown]'), wDel = t.closest('[data-wdel]');
    if (wUp || wDn || wDel) {
      const chain = (_set.writer.chain || []).slice();
      if (wDel) chain.splice(+wDel.dataset.wdel, 1);
      else {
        const i = +(wUp ? wUp.dataset.wup : wDn.dataset.wdown);
        const j = wUp ? i - 1 : i + 1;
        if (j < 0 || j >= chain.length) return;
        chain.splice(j, 0, chain.splice(i, 1)[0]);
      }
      return saveChain(chain);
    }
    if (t.closest('[data-wadd]')) {
      const chain = (_set.writer.chain || []).slice();
      if (chain.length >= _maxW) return;
      // A step nobody has chosen yet is the first aggregator's first model - a row that opens
      // empty is a row that saves nothing and looks broken.
      const p = _writers[0] || { id: 'openrouter', models: [] };
      chain.push({ provider: p.id, model: (p.models || [])[0] || '' });
      return saveChain(chain);
    }

    const rs = t.closest('[data-reset]');
    if (rs) {
      const id = rs.dataset.reset;
      const next = Object.assign({}, _set.ladders);
      delete next[id];
      _set.ladders = next;
      render();
      return save({ ladders: { [id]: null } });
    }
  });

  _root.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'mvg-skip') return save({ skipDown: t.checked });
    if (t.id === 'mvg-writer-on') {
      _set.writer = Object.assign({}, _set.writer, { on: t.checked });
      return save({ writer: { on: t.checked } });
    }
    // a rung's aggregator: the model has to follow, or the row names a model that aggregator
    // has never heard of
    if (t.classList.contains('wprov')) {
      const i = +t.closest('[data-w]').dataset.w;
      const chain = (_set.writer.chain || []).slice();
      const p = _writers.find(x => x.id === t.value) || { models: [] };
      chain[i] = { provider: t.value, model: (p.models || [])[0] || '' };
      return saveChain(chain);
    }
    if (t.classList.contains('wmodel')) {
      const i = +t.closest('[data-w]').dataset.w;
      const chain = (_set.writer.chain || []).slice();
      const model = t.value;
      if (!model || model === chain[i].model) return;
      chain[i] = Object.assign({}, chain[i], { model });
      return saveChain(chain);
    }
    if (t.name === 'mvg-writer') {
      const other = $('#mvg-writer-other');
      const model = t.value === '__other' ? (other.value || '').trim() : t.value;
      _set.writer = Object.assign({}, _set.writer, { model });
      render();
      if (t.value === '__other') { const b = $('#mvg-writer-other'); if (b) b.focus(); }
      return save({ writer: { model } });
    }
  });

  _root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }

  });
}

// The stylesheet, fetched with the module and not before - and AWAITED, because appending a
// <link> does not block: without this the panel gets one frame of unstyled markup, a full-width
// stack of raw controls over the page, before the CSS lands.
function css() {
  return new Promise((resolve) => {
    if (document.getElementById('mvg-css')) return resolve();
    const l = document.createElement('link');
    l.id = 'mvg-css';
    l.rel = 'stylesheet';
    l.href = '/css/mv3-gear.css';
    l.onload = l.onerror = () => resolve();
    document.head.appendChild(l);
  });
}

export function close() {
  if (!_root) return;
  try { _root.remove(); } catch (e) {}
  _root = null;
}

export async function openGear() {
  close();
  await css();
  await load();
  if (!_table || !_set) { alert('Could not read the settings.'); return; }
  build();
  render();
}
