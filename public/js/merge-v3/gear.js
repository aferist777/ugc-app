/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the panel behind the gear.

   Built on the Character settings panel's shape, because it answers the same kind of
   question and there is no reason for two windows that do the same job to be learned
   twice: a backdrop, a rail of sections down the left, and one scrolling canvas on the
   right with the aggregators' health above it.

   TWO SECTIONS, and only one of them edits anything. The almanac is what each model wants to
   be told, read-only and the reason to open this at all while deciding which to use. The
   analyst's ladder is the one setting left: which model reads your message and the pictures
   attached to it, and who is asked when the first refuses.

   There used to be a third - a per-model order of aggregators. The picture window names the
   aggregator outright now, so the only thing that order still decided was who catches a
   refusal, and "the other one" needs no setting.

   ── Nothing loads with the page ─────────────────────────────────────────────
   imagen.js imports this the first time the gear is pressed, and this module injects its
   own stylesheet at the same moment. A panel most visits never open should not cost every
   visit its markup and its CSS.

   ── What is stored and what is not ──────────────────────────────────────────
   The analyst's chain, and nothing about the picture models. Which aggregators carry which
   model is a fact about the outside world and belongs to the table - store it here and a model
   added tomorrow would be invisible until somebody edited a setting.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';

let _root = null;
let _layer = null;
let _table = null;      // the matrix: engines, their aggregators, prices
let _set = null;        // the analyst's chain, skipDown
let _health = null;
let _sec = 'almanac';
let _eng = '';          // which model the almanac is showing
let _saving = 0;
let _writers = [];      // who can do the reading, and what they answer to
let _maxW = 5;

const $ = (sel, root) => (root || _root).querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
  try {
    const d = await fetch('/api/mv3/img/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(r => r.json());
    if (d && d.success) _set = d.settings;
  } catch (e) { /* the next change tries again */ }
  _saving--;
}

// ── health, the two that matter here ────────────────────────────────────────
const AGG = ['kie.ai', 'replicate'];

function healthBar() {
  const list = ((_health && _health.providers) || []).filter(p => AGG.includes(p.id));
  if (!list.length) return '';
  return list.map(p => '<span class="mvg-k ' + esc(p.state === 'ok' ? 'up' : p.state) + '">'
    + '<i></i>' + esc(p.label) + ' <b>' + esc(p.detail || '') + '</b></span>').join('');
}

// ── the analyst's ladder ────────────────────────────────────────────────────
// A number, the aggregator, the model, and a way to move or remove the step. One choice was
// never enough - the first rung is what runs, and the rest are there for the day it refuses.
function viewWriter() {
  const w = _set.writer || {};
  const chain = w.chain || [];
  const full = chain.length >= _maxW;

  return `
    <p class="mvg-say">The analyst reads your message <b>and the pictures attached to it</b>, and
      writes the prompt the picture model is actually given — shaped to whichever model you chose,
      because six models want six different sentences and it holds the rule sets so you do not
      have to. It never changes what you asked for, and what it actually sent is under
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
  almanac: 'How each model wants to be asked',
  writer: 'Who reads your message',
};

function render() {
  if (!_root) return;
  $('#mvg-h3').textContent = HEADS[_sec];
  // The keys' health belongs to the one section that names aggregators.
  const hb = $('#mvg-health');
  hb.innerHTML = _sec === 'writer' ? healthBar() : '';
  hb.hidden = _sec !== 'writer';
  _root.querySelectorAll('.mvg-nav').forEach(b => b.classList.toggle('cur', b.dataset.sec === _sec));
  $('#mvg-canvas').innerHTML = _sec === 'writer' ? viewWriter() : viewAlmanac();
}

// ── the shell ───────────────────────────────────────────────────────────────
function build() {
  const back = document.createElement('div');
  back.className = 'mvg-back';
  back.innerHTML = `
    <div class="mvg">
      <div class="mvg-head">
        <h2>Pictures</h2>
        <span class="sp"></span>
        <button class="mvg-x" id="mvg-close" aria-label="Close">&times;</button>
      </div>
      <div class="mvg-body">
        <div class="mvg-rail">
          <div class="mvg-rail-t">Models</div>
          <button class="mvg-nav cur" data-sec="almanac"><span><b>Almanac</b><i>The prompting rules each model follows</i></span></button>
          <div class="mvg-rail-t">Writing</div>
          <button class="mvg-nav" data-sec="writer"><span><b>The analyst</b><i>Which model reads your message and its pictures</i></span></button>
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
  _layer = Layers.open(back, { name: 'settings', onEsc: close });
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

    // the analyst's ladder
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
  if (_layer) { Layers.close(_layer); _layer = null; }
}

export async function openGear() {
  close();
  await css();
  await load();
  if (!_table || !_set) { alert('Could not read the settings.'); return; }
  build();
  render();
}
