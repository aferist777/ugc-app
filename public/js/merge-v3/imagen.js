/* ════════════════════════════════════════════════════════════════════════════
   MERGE — making pictures, as a conversation.

   The window itself is chatwin.js, shared with Animate. THIS FILE IS ONLY WHAT MAKES IT
   the picture one: the table of models, the left column that reads it, what a finished
   picture looks like in a bubble and what can be done with it.

   ── Why a thread and not a form ─────────────────────────────────────────────
   Making pictures is iterative. You say a thing, look at it, then say "the same but at
   night" - and the second sentence only means anything because the first one is still
   there. A prompt box starts from nothing every time; a thread does not. So the
   conversation is the working surface, and it belongs to the PROJECT: close the window,
   open it from another lane, come back tomorrow, the same thread.

   ── The attachment row is the whole of the rule ─────────────────────────────
   Whatever sits above the input goes as a reference, and that is the only rule there is.
   A picture that lands is put there AUTOMATICALLY, because the next thing anybody says
   after seeing one is about that one - but it is put there VISIBLY, with a number and a
   cross, because attaching it silently would switch the engine to its edit model, change
   which engines are possible at all, and drop the cheapest one off the list without a
   word. One click on the cross and it is a fresh picture again.
   ════════════════════════════════════════════════════════════════════════════ */

import { openChatWindow, closeChatWindow, attempts, el, money, thumbOf, arOf } from './chatwin.js';
import { placeClip, playheadAt } from './timeline.js';
import { openViewer } from '../library/viewer.js';
import { closeAsk, note } from './ask.js';
import * as Store from './store.js';

// Only the first guess. startInlineProgress keeps a running average per key, so each model
// learns its own pace after one generation - and they differ by a factor of ten: z-image-turbo
// lands in eight seconds, grok-imagine took seventy-five.
const ETA_MS = 40000;
const LS = 'mv3-imagen-last';

// The five shapes a prompt can take, in words a person reads rather than the keys the almanac
// files them under.
const FORM_WORD = {
  prose: 'describe the scene',
  brief: 'write a design brief',
  template: 'labelled lines',
  slots: 'ordered slots',
  plain: 'plain sentences',
};

let _table = null;      // the matrix, fetched once per page
let _ui = null;         // the left column's own controls, while a window is open

function _remember(o) { try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) {} }
function _recall() { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } }

async function _matrix() {
  if (_table) return _table;
  const d = await fetch('/api/mv3/img/matrix').then(r => r.json()).catch(() => null);
  if (!d || !d.success) throw new Error((d && d.error) || 'could not read the model table');
  _table = d;
  return _table;
}

// ── The table, read through the current choice ──────────────────────────────
const engineOf = () => (_table.engines.find(e => e.id === _ui.eng.value) || _table.engines[0]);

/**
 * Who can serve this model, at this quality, with this many references - in the order they will
 * be tried.
 *
 * All three narrow the field and all three are per-pairing: kie has no `pro` for qwen-image-2,
 * z-image-turbo cannot edit at all, and grok-imagine takes three references through kie but
 * exactly one through Replicate.
 */
function rungs(e, q, refs) {
  const n = refs || 0;
  return (e.rows || []).filter(r =>
    (n ? (r.i2i && r.maxRefs >= n) : r.t2i) && (r.tiers || e.tiers).includes(q));
}

// Which engines can do anything at all with this many references attached.
const _usable = (n) => _table.engines.filter(e => e.tiers.some(t => rungs(e, t, n).length));

function _paintEngines(api) {
  const n = api.atts.length;
  const want = _ui.eng.value;
  const list = _usable(n);
  _ui.eng.innerHTML = '';
  for (const e of list) {
    const o = document.createElement('option');
    o.value = e.id; o.textContent = e.label;
    o.selected = e.id === want;
    _ui.eng.appendChild(o);
  }
  // The engine that was chosen may not be able to take what is now attached. SAY SO rather than
  // swapping silently - a picture from a model other than the one asked for is the thing this
  // whole table exists to prevent.
  if (want && !list.some(e => e.id === want)) {
    const was = (_table.engines.find(e => e.id === want) || {}).label || want;
    _ui.eng.value = (list[0] || {}).id || '';
    api.say(was + ' cannot take ' + n + (n === 1 ? ' reference' : ' references')
      + ' — using ' + ((list[0] || {}).label || 'nothing'));
  }
  _paintQuality(api);
}

function _paintQuality(api) {
  const e = engineOf();
  const want = _ui.q.value;
  const n = api.atts.length;
  // Only the tiers this engine can actually be graded by with what is attached.
  const tiers = e.tiers.filter(t => rungs(e, t, n).length);
  _ui.q.innerHTML = '';
  for (const t of (tiers.length ? tiers : e.tiers)) {
    const o = document.createElement('option');
    o.value = t; o.textContent = t;
    o.selected = (t === want) || (!tiers.includes(want) && t === e.def);
    _ui.q.appendChild(o);
  }
  _paintPrice(api);
}

function _paintPrice(api) {
  const e = engineOf();
  const q = _ui.q.value;
  const rows = rungs(e, q, api.atts.length);
  // The price is the FIRST rung's, not the cheapest: the ladder tries them in order, so that is
  // the one that will actually be charged unless it refuses. Quoting the cheapest would name a
  // price nobody is going to pay.
  const chosen = rows[0];
  const val = chosen ? (chosen.price || {})[q] : null;
  const many = attempts();

  const box = _ui.cost;
  if (val == null) {
    box.className = 'mv3-ig-cost is-unknown';
    box.innerHTML = '<b>&mdash;</b><span>no published price for this one</span>';
  } else {
    box.className = 'mv3-ig-cost';
    box.innerHTML = '<b>' + (chosen.approx ? '≈' : '') + money(val) + '</b>'
      + '<span>per picture' + (many > 1 ? ' · ' + money(val * many) + ' for ' + many : '') + '</span>';
  }

  // WHAT THIS MODEL WANTS TO BE TOLD. The almanac travels with the table, so the moment a model
  // is chosen the panel can say how it likes to be asked - which is the half of the decision the
  // price does not cover.
  const r = e.rule;
  _ui.hint.innerHTML = r
    ? '<b>' + FORM_WORD[r.form] + '</b> · ' + r.sweetSpot
      + (r.negatives === 'none' ? ' · <i>never say what to avoid</i>' : '')
    : '';
  _ui.hint.title = r ? [r.formula, r.weakness].filter(Boolean).join('\n\n') : '';

  _ui.via.innerHTML = rows.length
    ? 'served by <b>' + rows[0].label + '</b>'
      + (rows.length > 1 ? ', then <i>' + rows.slice(1).map(x => x.label).join(', ') + '</i>' : '')
    : '<b>nothing can serve this</b>';

  const others = rows.slice(1).filter(x => (x.price || {})[q] != null);
  _ui.fall.innerHTML = (val != null && others.length)
    ? 'if it falls through: ' + others.map(x => '<b>' + x.label + '</b> ' + money(x.price[q])).join(', ')
    : '';

  _remember({ engine: e.id, quality: q, aspect: _ui.ar });
}

function _paintAspects(api) {
  _ui.arWrap.textContent = '';
  for (const a of _table.aspects) {
    const b = el('button', 'mv3-ig-ar-b' + (a === _ui.ar ? ' on' : ''));
    b.type = 'button';
    b.textContent = a;
    if (a === _ui.fmt) {
      b.appendChild(el('span', 'dot', ' •'));
      b.title = "the project's own shape";
    }
    b.addEventListener('click', () => { _ui.ar = a; _paintAspects(api); _paintPrice(api); });
    _ui.arWrap.appendChild(b);
  }
}

// ── Over the top of this window ─────────────────────────────────────────────
// The viewer's own stylesheet does not expect to be here - it sits at 9000 and this window at
// 9450 - so merge-v3.css lifts it above. ONE way in, used by the picture and by the button, so
// the two cannot come to differ.
function _view(g, api) {
  const done = api.finished();
  openViewer(
    done.map(x => ({ id: x.id, media: x.imagePath, thumb: x.imagePath, name: x.prompt || '', date: x.at })),
    done.findIndex(x => x.id === g.id));
}

// ── Onto the Birols lane, where the playhead is ──────────────────────────────
// The talking-head timeline is not a stack of lanes you choose between: Main is the read and
// the three above it are overlays. A picture made here is an overlay by definition - it is
// something to put OVER the person talking - so it goes on Birols, which is the top layer and
// the lane every b-roll already lives on.
//
// AT THE PLAYHEAD, unlike the blank editor, which lays a picture after whatever is already on
// its lane. There the lane is being filled from nothing; here the film exists and you are
// standing at the moment you want covered - that is what the playhead is for, and Birols may
// overlap anyway, so there is no queue to join.
//
// It is in the library either way: that happens when the picture is made, not when this is
// pressed (lib/mv3-gens.js files it on the images shelf under the project's own category).
async function _place(g, anchor, api) {
  try { await api.ensureProject(); }
  catch (e) { note(anchor, 'Could not start a project.', String(e.message || e).slice(0, 120)); return; }

  const tl = Store.timeline();
  // A blank project keeps its tracks in a LIST and has no Birols; this window is the
  // talking-head one's, and saying so is better than putting the picture somewhere odd.
  if (!tl || Array.isArray(tl.tracks) || !tl.tracks.biro) {
    note(anchor, 'No Birols lane on this project.', 'The picture is in the library - drag it in.');
    return;
  }

  const at = playheadAt();
  placeClip('biro', at, {
    src: g.imagePath, thumb: g.imagePath, libId: g.imageId || '',
    name: (g.prompt || '').slice(0, 60), group: 'images', dur: 0,
  });
  api.made();
  // Said, then gone. A confirmation that has to be dismissed is a confirmation that interrupts -
  // and this one is telling somebody that the thing they asked for happened.
  note(anchor, 'Added to Birols.', 'At the playhead, ' + at.toFixed(1) + 's.');
  setTimeout(() => closeAsk(), 2400);
}

// ── The spec ────────────────────────────────────────────────────────────────
const SPEC = {
  title: 'Pictures',
  cls: 'is-pics',
  kind: 'image',
  shelfGroup: 'images',
  counts: true,
  resultIsReference: true,
  writeDefault: true,
  placeholder: 'Describe a picture, or say what to change.',
  emptyText: 'Describe a picture. What comes back stays in this project — and in the library.',
  waitWord: 'still drawing this one…',

  left(host, api) {
    // Built once and then only repainted: rebuilding the selects on every attachment would
    // close a dropdown under the cursor.
    if (!_ui || _ui.host !== host) {
      host.textContent = '';
      const last = _recall();
      const tl = Store.timeline();
      const row = (label, ctl) => {
        const r = el('div', 'mv3-ig-row');
        const l = el('label', null, label);
        l.htmlFor = ctl.id;
        r.appendChild(l);
        r.appendChild(ctl);
        host.appendChild(r);
      };
      const eng = document.createElement('select');
      eng.id = 'mv3-ig-eng';
      row('model', eng);
      const q = document.createElement('select');
      q.id = 'mv3-ig-q';
      row('quality', q);

      const hint = el('div', 'mv3-ig-hint');
      host.appendChild(hint);
      const via = el('div', 'mv3-ig-via');
      host.appendChild(via);
      host.appendChild(el('div', 'mv3-ig-sep', 'shape'));
      const arWrap = el('div', 'mv3-ig-ar-row');
      host.appendChild(arWrap);
      const cost = el('div', 'mv3-ig-cost');
      host.appendChild(cost);
      const fall = el('div', 'mv3-ig-fall');
      host.appendChild(fall);

      const fmt = (tl && tl.format) || '9:16';
      _ui = { host, eng, q, hint, via, arWrap, cost, fall, fmt,
              ar: _table.aspects.includes(last.aspect) ? last.aspect : fmt };
      eng.addEventListener('change', () => _paintQuality(api));
      q.addEventListener('change', () => _paintPrice(api));
      if (last.engine) eng.value = last.engine;
      if (last.quality) q.value = last.quality;
      _paintAspects(api);
    }
    _paintEngines(api);
  },

  // One kind, and how many of it depends on the pairing that will actually serve the job.
  slots(api) {
    const e = _table.engines.find(x => x.id === (_ui && _ui.eng.value)) || _table.engines[0];
    const most = Math.max(1, ...(e.rows || []).filter(r => r.i2i).map(r => r.maxRefs || 1));
    return [{ kind: 'image', min: 0, max: most, accept: 'image/*', label: 'a picture to work from' }];
  },

  aspect: () => (_ui ? _ui.ar : '9:16'),

  progress(refs) {
    const e = engineOf();
    const first = (rungs(e, _ui.q.value, refs)[0] || {}).label || 'the model';
    return {
      label: refs ? 'reading ' + refs + (refs === 1 ? ' picture…' : ' pictures…')
                  : 'asking ' + first + '…',
      // Per model, because they differ by a factor of ten and one average over all of them would
      // be wrong for every one.
      key: 'mv3-imagen-' + e.id, estimateMs: ETA_MS,
    };
  },
  askWord: () => 'asking ' + ((rungs(engineOf(), _ui.q.value, 0)[0] || {}).label || 'the model') + '…',
  madeWord: (n) => (n > 1 ? 'drawing ' + n + ' pictures…' : 'drawing…'),

  async think(text, refs, api) {
    const d = await fetch('/api/mv3/img/think', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        engine: engineOf().id, text, refs: refs.length,
        // Only what was said last, and only so "the same but at night" has something to be the
        // same AS. The continuity here is the attachments, not the conversation.
        thread: api.thread.slice(-4).map(m => ({ role: m.role, text: m.text })),
      }),
    }).then(r => r.json()).catch(() => null);
    if (!d || !d.success) return null;
    if (d.ask) return { ask: d.ask };
    // Only what they actually asked for: the writer returns a shape or a size ONLY when the
    // message mentioned one, so a deliberate choice in the panel is never overwritten.
    return { prompt: d.prompt, aspect: d.aspect || null, quality: d.quality || null, fell: d.fell };
  },

  async submit(payload, api) {
    const body = {
      project: api.project, engine: engineOf().id,
      prompt: payload.prompt, said: payload.text,
      aspect: payload.aspect || _ui.ar, quality: payload.quality || _ui.q.value,
      refs: payload.refs,
    };
    // One request per picture, so one refusal costs one picture rather than the batch - and each
    // gets its own walk down the ladder.
    const answers = await Promise.all(Array.from({ length: attempts() }, () =>
      fetch('/api/mv3/img/gen', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json()).catch(() => null)));
    const ids = answers.filter(a => a && a.success && a.item).map(a => a.item.id);
    if (!ids.length) throw new Error((answers.find(a => a && a.error) || {}).error || 'the model refused the job');
    return ids;
  },

  done: (g) => g.state === 'done' && !!g.imagePath,
  pending: (g) => g.state === 'pending',
  pathOf: (g) => g.imagePath,

  result(g, api) {
    const img = document.createElement('img');
    img.className = 'mv3-ig-shot';
    // A THUMBNAIL in the thread, not the picture itself. A conversation of full-size pictures is
    // one you cannot scroll: two of them and the words between are off the screen. Hovering shows
    // it properly, and clicking opens it over everything.
    img.src = thumbOf(g.imagePath, 'card');
    img.alt = g.prompt || '';
    img.loading = 'lazy'; img.decoding = 'async';
    img.style.aspectRatio = String(g.aspect || '9:16').replace(':', '/');
    img.title = 'Click to open';
    img.addEventListener('mouseenter', () => api.peekShow(thumbOf(g.imagePath, 'main'), img));
    img.addEventListener('mouseleave', api.peekHide);
    img.addEventListener('click', () => { api.peekHide(); _view(g, api); });
    return img;
  },

  facts(g) {
    return [
      ['model', g.engine + ' · ' + (g.provider || '?') + ' · ' + g.quality],
      ['asked as', g.model || ''],
      ['shape', (g.aspect || '') + ((g.w && g.h) ? ' · ' + g.w + '×' + g.h : '')],
      ['took', g.secs ? g.secs + 's' : ''],
      ['references', (g.refs || []).length ? String(g.refs.length) : ''],
    ];
  },

  acts(g, api) {
    const use = el('button', 'mv3-c-btn', 'Use as reference');
    use.title = 'Put it in the row above the message box and carry on from it';
    use.addEventListener('click', () => { api.attach(g.imagePath, g.prompt || ''); api.repaint(); });

    const add = el('button', 'mv3-c-btn', 'To the timeline');
    add.title = 'Puts it on the Birols lane, at the playhead.';
    add.addEventListener('click', () => _place(g, add, api));

    // ANIMATE, the same window a still on the timeline opens - with this picture already in its
    // reference row, because that is the whole reason the button is here.
    const anim = el('button', 'mv3-c-btn', 'Animate');
    anim.title = 'Make a clip from this picture.';
    anim.addEventListener('click', async () => {
      try {
        const A = await import('./animate.js');
        await A.openAnimate({ src: g.imagePath, name: (g.prompt || '').slice(0, 60) });
      } catch (err) {
        note(anim, 'Could not open Animate.', String((err && err.message) || err).slice(0, 120));
      }
    });

    // No Open: the picture itself opens on a click, and a button that repeats what the thing
    // beside it already does is a button in the way. No Remove either - the library is where a
    // picture is deleted, and a row of three buttons under every picture in a long thread is
    // enough of them.
    return [use, add, anim];
  },

  async cats() {
    const d = await fetch('/api/library/shelf/media?filter=images').then(r => r.json()).catch(() => null);
    return (d && d.success) ? (d.cats || []).map(c => ({ id: c.id, label: c.label || c.name || c.id })) : [];
  },

  async shelf(cat, api) {
    if (!cat) {
      const d = await fetch('/api/mv3/img/feed?project=' + encodeURIComponent(api.project))
        .then(r => r.json()).catch(() => null);
      if (!d || !d.success) return [];
      return (d.items || []).map(g => ({
        path: g.imagePath, aspect: g.aspect, state: g.state, name: g.prompt || '', error: g.error,
      }));
    }
    const d = await fetch('/api/library/shelf/media?filter=images&cat=' + encodeURIComponent(cat))
      .then(r => r.json()).catch(() => null);
    if (!d || !d.success) return [];
    return (d.items || []).filter(i => i && i.media).map(i => ({
      path: i.media, aspect: arOf(i), state: 'done', name: i.name || '', libId: i.id || '',
    }));
  },

  // It goes onto the images shelf on the way past: everything attachable has to be somewhere the
  // app can find again, because the thread stores a path and not the bytes.
  async upload(files, api) {
    const list = files.filter(f => f && /^image\//.test(f.type));
    if (!list.length) return;
    api.say('adding ' + list.length + (list.length === 1 ? ' picture…' : ' pictures…'));
    for (const f of list.slice(0, 10)) {
      try {
        const fd = new FormData();
        fd.append('image', f);
        fd.append('name', f.name.replace(/\.[^.]+$/, ''));
        fd.append('project', api.project || '');
        // Merge's own door rather than the library's: this one files the picture under the
        // PROJECT's category, the same shelf its generations land on, so a reference brought in
        // from the disk is findable tomorrow beside the pictures it was used for.
        const d = await fetch('/api/mv3/img/upload', { method: 'POST', body: fd }).then(r => r.json());
        if (d && d.success && d.item) api.attach(d.item.imagePath, d.item.name);
      } catch (e) { /* the next one may still work */ }
    }
    api.say('');
    api.made();
  },

  remember() { if (_ui) _remember({ engine: _ui.eng.value, quality: _ui.q.value, aspect: _ui.ar }); },
};

export const closeImagen = closeChatWindow;

/**
 * @param track  the lane it was opened from, kept for the windows that have one to name. The
 *               talking-head timeline does not pass it: there the picture goes on Birols at
 *               the playhead, which is a rule and not a choice. Optional either way.
 */
export async function openImagen(track) {
  let table;
  try { table = await _matrix(); }
  catch (e) { alert(e.message); return; }
  if (!table.engines.length) { alert('No picture model is available - check the API keys in Brain.'); return; }
  _ui = null;                       // a fresh window builds its own column
  return openChatWindow(SPEC, { track });
}
