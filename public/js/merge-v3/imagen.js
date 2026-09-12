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
 * Who can serve this model, at this quality, with this many references.
 *
 * All three narrow the field and all three are per-pairing: the gpt model is graded by
 * resolution on kie and by effort on Replicate, and grok takes three references through kie but
 * exactly one through Replicate.
 */
function rungs(e, q, refs) {
  const n = refs || 0;
  return (e.rows || []).filter(r =>
    (n ? (r.i2i && r.maxRefs >= n) : r.t2i) && (r.tiers || e.tiers).includes(q));
}

// Which aggregators can serve this model in the direction it is being asked in, whatever the
// quality - the quality list is built from whichever one is chosen, so it cannot narrow this.
function houses(e, refs) {
  const n = refs || 0;
  return (e.rows || []).filter(r => (n ? (r.i2i && r.maxRefs >= n) : r.t2i));
}

// Which engines can do anything at all with this many references attached.
const _usable = (n) => _table.engines.filter(e => e.tiers.some(t => rungs(e, t, n).length));

// THE PAIRING THAT WILL ACTUALLY RUN: the aggregator named in the dropdown, or the first that
// can do the job when the chosen one cannot (a model it does not carry, or more references than
// it takes). Everything the column says - the tiers, the price - reads this and not a ladder.
function rowOf(e, refs) {
  const can = houses(e, refs);
  return can.find(r => r.provider === (_ui && _ui.prov && _ui.prov.value)) || can[0] || null;
}

// t2i or i2i, said in the model list, because the direction decides which half of the pairing
// runs and what it costs. It is not a setting: it is whether anything is attached.
const _dir = (n) => (n ? 'i2i' : 't2i');

// ── The three dropdowns ─────────────────────────────────────────────────────
// Aggregator, then model, then quality, in that order down the column because that is the order
// they narrow each other: who is being asked decides which models are on offer at all, and the
// pairing of the two decides how it can be graded and what it costs.

function _paintProviders(api) {
  const e = engineOf();
  const n = api.atts.length;
  const can = houses(e, n);
  const want = _ui.prov.value;
  _ui.prov.innerHTML = '';
  for (const r of can) {
    const o = document.createElement('option');
    o.value = r.provider; o.textContent = r.label;
    o.selected = r.provider === want;
    _ui.prov.appendChild(o);
  }
  // The one that was chosen may not carry this model, or may not take this many pictures. The
  // list is what is possible; the choice moves to the first of them rather than staying on a
  // name that would quietly be substituted at submit time.
  if (want && !can.some(r => r.provider === want) && can.length) _ui.prov.value = can[0].provider;
  _ui.prov.disabled = can.length < 2;
}

function _paintEngines(api) {
  const n = api.atts.length;
  const want = _ui.eng.value;
  // ALPHABETICAL. The table's own order is the order they were added to it, which is a fact
  // about this file's history and not about the models; a list you cannot predict is a list you
  // have to read every time.
  const list = _usable(n).slice().sort((a, b) => a.label.localeCompare(b.label));
  _ui.eng.innerHTML = '';
  for (const e of list) {
    const o = document.createElement('option');
    o.value = e.id;
    // Which half of the pairing this will be. Not a choice - it is whether anything is attached -
    // but it decides which model id runs and what it is charged at, so it is said out loud.
    o.textContent = e.label + ' · ' + _dir(n);
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
  _paintProviders(api);
  _paintQuality(api);
}

function _paintQuality(api) {
  const e = engineOf();
  const want = _ui.q.value;
  const row = rowOf(e, api.atts.length);
  // THE CHOSEN AGGREGATOR'S OWN WORDS. The gpt model is graded 1K/2K/4K on kie and
  // low..max on Replicate; offering the union would offer six words that do nothing.
  const tiers = (row && row.tiers && row.tiers.length) ? row.tiers : e.tiers;
  _ui.q.innerHTML = '';
  for (const t of tiers) {
    const o = document.createElement('option');
    o.value = t; o.textContent = t;
    o.selected = (t === want) || (!tiers.includes(want) && t === (tiers.includes(e.def) ? e.def : tiers[0]));
    _ui.q.appendChild(o);
  }
  _paintPrice(api);
}

function _paintPrice(api) {
  const e = engineOf();
  const q = _ui.q.value;
  const n = api.atts.length;
  const chosen = rowOf(e, n);
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

  // WHO CATCHES A REFUSAL. The aggregator is chosen rather than walked to, but a model that is
  // down at one of them is not a reason to lose the picture - so the other one is tried behind
  // it, and what that would cost is worth knowing before it happens rather than after.
  const others = houses(e, n).filter(r => r !== chosen && (r.price || {})[q] != null);
  _ui.fall.innerHTML = others.length
    ? 'if it refuses: ' + others.map(x => '<b>' + x.label + '</b> ' + money(x.price[q])).join(', ')
    : '';

  _remember({ engine: e.id, provider: _ui.prov.value, quality: q, aspect: _ui.ar });
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
      const prov = document.createElement('select');
      prov.id = 'mv3-ig-prov';
      row('aggregator', prov);
      const eng = document.createElement('select');
      eng.id = 'mv3-ig-eng';
      row('model', eng);
      const q = document.createElement('select');
      q.id = 'mv3-ig-q';
      row('quality', q);

      host.appendChild(el('div', 'mv3-ig-sep', 'shape'));
      const arWrap = el('div', 'mv3-ig-ar-row');
      host.appendChild(arWrap);
      const cost = el('div', 'mv3-ig-cost');
      host.appendChild(cost);
      const fall = el('div', 'mv3-ig-fall');
      host.appendChild(fall);

      const fmt = (tl && tl.format) || '9:16';
      _ui = { host, prov, eng, q, arWrap, cost, fall, fmt,
              ar: _table.aspects.includes(last.aspect) ? last.aspect : fmt };
      // THE WHOLE WINDOW, not just this column. Choosing an aggregator or a model changes how
      // many references the job can take - kie takes five for grok and Replicate takes one - and
      // the row of empty places above the message box is where that number is shown. Repainting
      // only the column left it offering five places to a model that would accept one.
      prov.addEventListener('change', () => api.repaint());
      eng.addEventListener('change', () => api.repaint());
      q.addEventListener('change', () => _paintPrice(api));
      // Last time's choice, for all four. The window is opened to carry on from where the last
      // picture left off far more often than to start somewhere new.
      if (last.provider) prov.value = last.provider;
      if (last.engine) eng.value = last.engine;
      if (last.quality) q.value = last.quality;
      _paintAspects(api);
    }
    _paintEngines(api);
  },

  // One kind, and how many of it is the PAIRING's business rather than the engine's: kie takes
  // five pictures for grok and Replicate takes one, and the row that will run is the one whose
  // number has to be on screen. Five is the ceiling whatever it says (see MAX_ATTS); a row that
  // takes fewer shows fewer, because an empty place that cannot be filled is a lie.
  slots(api) {
    const e = _table.engines.find(x => x.id === (_ui && _ui.eng.value)) || _table.engines[0];
    const rows = (e.rows || []).filter(r => r.i2i);
    const mine = rows.find(r => r.provider === (_ui && _ui.prov && _ui.prov.value));
    const most = (mine ? mine.maxRefs : Math.max(1, ...rows.map(r => r.maxRefs || 1))) || 0;
    return [{ kind: 'image', min: 0, max: Math.min(5, most), accept: 'image/*', label: 'a picture to work from' }];
  },

  aspect: () => (_ui ? _ui.ar : '9:16'),

  progress(refs) {
    const e = engineOf();
    const first = (rowOf(e, refs) || {}).label || 'the model';
    return {
      label: refs ? 'reading ' + refs + (refs === 1 ? ' picture…' : ' pictures…')
                  : 'asking ' + first + '…',
      // Per model, because they differ by a factor of ten and one average over all of them would
      // be wrong for every one.
      key: 'mv3-imagen-' + e.id, estimateMs: ETA_MS,
    };
  },
  askWord: () => 'asking ' + ((rowOf(engineOf(), 0) || {}).label || 'the model') + '…',

  // For the step log: WHO is being asked, and HOW MANY pictures were asked of them. Both are
  // the window's own facts, but only this file knows where they are kept.
  who: (api) => (rowOf(engineOf(), api.atts.length) || {}).label || 'the model',
  count: () => attempts(),
  madeWord: (n) => (n > 1 ? 'drawing ' + n + ' pictures…' : 'drawing…'),

  async think(text, refs, api) {
    const d = await fetch('/api/mv3/img/think', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        engine: engineOf().id, text,
        // The pictures themselves, not how many: the analyst is shown them in the same call
        // that writes the prompt, so it can say what is in one rather than repeat its number.
        refs,
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
      // THE AGGREGATOR IS A CHOICE NOW, not the head of a stored order. The server still repairs
      // an impossible pairing rather than refusing it - a model the chosen one does not carry
      // goes to the one that does, and says so in the log.
      provider: _ui.prov.value,
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
