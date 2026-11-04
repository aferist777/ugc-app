/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the result window: a render, playable, named, kept.

   One window for every finished render, wherever it came from: straight after Render on
   either editor, or from the queue's "open" on a ready entry.

   LEFT: the video.
   RIGHT: the name taken apart. Six fields, one per part of the Meta naming pattern, each
   with its description beside it; they are filled from the project on open (the Scenarios
   project behind the render knows the vertical, the ingredient, the character, the gender,
   and the title often carries the trigger), and joined with `_` into the full name as they
   are edited. (Phase V54 block 8, the owner 2026-10-28: the hook id is out of the pattern -
   the hooks have no numbers any more.)
   FOOT: the full name, one editable field along the left, and the two buttons on the right.
   Editing the full name feeds the parts back while it still has six of them.

   TWO BUTTONS. Save & download names the file in finals/ (renaming it if the name changed),
   keeps it on the Library's renders shelf and downloads it. Cancel on a FRESH render deletes
   the file, as it always did; Cancel on a render opened from the queue just closes, because
   that file was kept on purpose.

   A RENDER'S SUBTITLES FILE (`<name>.en_US.srt`, phase V30, block 4) goes with it: Save renames it, Cancel deletes
   it. A box beside the buttons - shown only when the render has one - downloads it with the video; it is off until
   ticked (the owner's (с38)), and remembered.

   THE NAME IS THE PERSON'S. The pattern is a recommendation for creatives that go to Meta -
   the same string becomes the ad name there - so the line beside the field says whether the
   name follows it, and never stops a save that does not.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Layers from '../layers.js';

const TRIGGERS = ['AUTH', 'FEAR', 'FOMO', 'SECRET', 'PROOF', 'DESIRE'];

// The pattern, part by part.
const PARTS = [
  { id: 'vertical',   label: 'vertical',      desc: 'the niche: MaleEnh · WeightLoss · Prostate', ph: 'MaleEnh' },
  { id: 'ingredient', label: 'Ingredient',    desc: 'the trick/ingredient, e.g. RedHoney, Honey, Beetroot', ph: 'RedHoney' },
  { id: 'angle',      label: 'angleScenario', desc: 'the angle, e.g. ScientistSecret, GirlfriendsStoryTime, BreakingNews', ph: 'ScientistSecret' },
  { id: 'trigger',    label: 'trigger',       desc: 'one of: AUTH · FEAR · FOMO · SECRET · PROOF · DESIRE', select: TRIGGERS },
  { id: 'character',  label: 'character',     desc: 'narrator, e.g. DrFauci', ph: 'DrFauci' },
  { id: 'gender',     label: 'gender',        desc: 'M / F', select: ['M', 'F'] },
];
const INTRO = [
  'Use this exact pattern — the same string becomes the Meta Ad name. Underscore _ is the separator, so never use _ or a space inside a field (use camelCase or a hyphen).',
  'No offer in the name — a creative gets reused across offers, so the offer lives at the campaign level, not here.',
];
const PATTERN = 'vertical_Ingredient_angleScenario_trigger_character_gender';
const EXAMPLE = 'MaleEnh_RedHoney_ScientistSecret_AUTH_DrFauci_M';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// A render's subtitles file (lib/mv3b-job.js srtOf): `<its name>.en_US.srt` beside it.
const srtUrlOf = (url) => { const u = String(url || '').split('?')[0]; return /\.[a-z0-9]+$/i.test(u) ? u.replace(/\.[a-z0-9]+$/i, '') + '.en_US.srt' : null; };
// Downloaded with the video only when ticked; off until the person ticks it (the owner's (с38)), then remembered.
const LS_SRT = 'mv3_rr_srt_v1';
const _srtWanted = () => { try { return localStorage.getItem(LS_SRT) === '1'; } catch (e) { return false; } };

// "red honey" -> "RedHoney"; anything that is not a letter or digit goes, so a part can never
// carry the separator inside it.
function camel(s) {
  const words = String(s || '').replace(/[^A-Za-z0-9Ѐ-ӿ]+/g, ' ').trim().split(' ').filter(Boolean);
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

// What the name says against the pattern. Never a refusal - a reading.
function check(name) {
  const n = String(name || '').trim();
  if (!n) return { ok: false, text: 'a name is needed' };
  if (/\s/.test(n)) return { ok: false, text: 'recommendation: no spaces - join words as camelCase or with a hyphen' };
  const parts = n.split('_');
  if (parts.length !== PARTS.length) return { ok: false, text: `recommendation: ${PARTS.length} parts joined by _ (this has ${parts.length})` };
  if (parts.some(p => !p)) return { ok: false, text: 'recommendation: no empty part between the underscores' };
  if (!TRIGGERS.includes(parts[3])) return { ok: false, text: `recommendation: part 4 is the trigger - one of ${TRIGGERS.join(' · ')}` };
  if (!/^[MF]$/.test(parts[5])) return { ok: false, text: 'recommendation: part 6 is the gender - M or F' };
  return { ok: true, text: 'follows the pattern' };
}

// A title in the house style - "2026-08-22 - Stable - 7909 - Cartpanda - Secret Ingredient -
// AUTH - H01 - Nancy - F" - read for the angle, the trigger, the character and the gender (an "H01" in an older
// title is passed over: the hook id is out of the pattern, V54 block 8). The tails a title picks up on the way here come off first: "(copy)", "(copy 2)"
// from a copy, "(2)" from a second import, "· stills" from a stills cut, and the "local_…"
// prefix a blank project's key carries. Left on, "F (copy)" is not a gender and nothing after
// the trigger is found.
function readTitle(title) {
  const out = { angle: '', trigger: '', character: '', gender: '' };
  const clean = String(title || '')
    .replace(/^local_\d+_/, '')
    .replace(/\s*\(copy(?: \d+)?\)$/i, '')
    .replace(/\s*\(\d+\)$/, '')
    .replace(/\s*·\s*stills$/i, '')
    .trim();
  const tokens = clean.split(/\s+[-—–]\s+/).map(t => t.trim()).filter(Boolean);
  const ti = tokens.findIndex(t => TRIGGERS.includes(t.toUpperCase()));
  if (ti >= 0) {
    out.trigger = tokens[ti].toUpperCase();
    if (ti > 0 && !/^\d/.test(tokens[ti - 1])) out.angle = camel(tokens[ti - 1]);
  }
  const last = tokens[tokens.length - 1];
  if (/^[MF]$/i.test(last || '')) {
    out.gender = last.toUpperCase();
    if (tokens.length >= 2) out.character = camel(tokens[tokens.length - 2]);
  }
  return out;
}

// What the project already knows about the name. The server finds the Scenarios record
// behind ANY Merge key - an import by its key, a copy by the chain of copies or by its title
// (routes/mergev3.js, /mv3/timeline/:key/source) - and that record has the vertical, the
// product (the ingredient), the cast character and the gender. The Merge title is read first
// for the rest, because it is the one a person renames into the pattern; the record's own
// name fills in whatever the title did not say. Anything still unknown stays a placeholder.
async function partsFromProject(key, title) {
  const out = { vertical: '', ingredient: '', angle: '', trigger: '', character: '', gender: '' };
  let p = null;
  if (key) {
    try {
      const d = await fetch('/api/mv3/timeline/' + encodeURIComponent(key) + '/source').then(r => r.json());
      p = (d && d.project) || null;
    } catch (e) { p = null; }
  }
  p = p || {};
  out.vertical = camel(p.vertical);
  out.ingredient = camel(p.product);
  out.character = camel(p.characterName);
  out.gender = /^f/i.test(p.gender || '') ? 'F' : /^m/i.test(p.gender || '') ? 'M' : '';

  const a = readTitle(title), b = readTitle(p.name);
  for (const k of ['angle', 'trigger']) out[k] = a[k] || b[k];
  out.character = out.character || a.character || b.character;
  out.gender = out.gender || a.gender || b.gender;
  return out;
}

// ── the window ──────────────────────────────────────────────────────────────
let _ov = null;
let _layer = null;
function close() {
  if (_ov) { _ov.remove(); _ov = null; }
  if (_layer) { Layers.close(_layer); _layer = null; }
}

/**
 * @param {object} o  { url, title, key, queueId?, fresh }
 *   fresh   true straight after a render: Cancel deletes the file. From the queue: false.
 */
export async function showResult(o) {
  close();
  const state = { url: o.url, queueId: o.queueId || null, fresh: !!o.fresh, saved: !o.fresh };

  // A fresh render is filed into the queue first, so it can be found again after this
  // window closes. Not fatal if that fails - the file is still on disk.
  if (o.fresh && !state.queueId) {
    try {
      const d = await fetch('/api/mv3/render/finish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: o.url, key: o.key || Store.key(), title: o.title || Store.title(), kind: 'blank', dur: Store.duration() }),
      }).then(r => r.json());
      if (d && d.success) state.queueId = d.queueId;
    } catch (e) {}
  }

  const ov = el('div', 'mv3-x-ov');
  const box = el('div', 'mv3-x is-result is-wide');
  const head = el('div', 'mv3-x-head');
  head.appendChild(el('h3', null, o.fresh ? 'Render finished' : (o.title || 'Render')));
  const x = el('button', 'mv3-x-close u-btn is-s is-icon is-quiet u-x', ''); x.type = 'button'; x.title = 'Close (Esc)';
  head.appendChild(x);
  box.appendChild(head);

  const body = el('div', 'mv3-rr');

  // ── left: the video ──
  const left = el('div', 'mv3-rr-left');
  const vwrap = el('div', 'mv3-rr-video');
  const v = document.createElement('video');
  v.src = o.url; v.controls = true; v.autoplay = !!o.fresh; v.playsInline = true; v.preload = 'metadata';
  vwrap.appendChild(v);
  left.appendChild(vwrap);
  body.appendChild(left);

  // ── right: the name taken apart ──
  const side = el('div', 'mv3-rr-side');
  side.appendChild(el('div', 'mv3-rr-l', 'Naming — recommended for Meta'));
  for (const t of INTRO) side.appendChild(el('p', 'mv3-rr-intro', t));
  side.appendChild(el('code', 'mv3-rr-pat', PATTERN));
  side.appendChild(el('code', 'mv3-rr-pat is-ex', 'e.g. ' + EXAMPLE));
  const fields = {};
  PARTS.forEach((p, i) => {
    const row = el('div', 'mv3-rr-row');
    row.appendChild(el('label', 'mv3-rr-rl', (i + 1) + '. ' + p.label));
    let f;
    if (p.select) {
      f = document.createElement('select');
      f.className = 'mv3-rr-rf';
      const o0 = document.createElement('option'); o0.value = ''; o0.textContent = '—'; f.appendChild(o0);
      for (const v of p.select) { const oo = document.createElement('option'); oo.value = v; oo.textContent = v; f.appendChild(oo); }
    } else {
      f = document.createElement('input');
      f.type = 'text'; f.className = 'mv3-rr-rf'; f.placeholder = p.ph || ''; f.spellcheck = false; f.autocomplete = 'off'; f.maxLength = 60;
    }
    row.appendChild(f);
    row.appendChild(el('div', 'mv3-rr-rd', p.desc));
    side.appendChild(row);
    fields[p.id] = f;
  });
  body.appendChild(side);
  box.appendChild(body);

  // ── the foot: the full name along the left, the buttons on the right ──
  const foot = el('div', 'mv3-x-foot is-rr');
  const name = document.createElement('input');
  name.type = 'text'; name.className = 'mv3-rr-name'; name.maxLength = 160; name.spellcheck = false; name.autocomplete = 'off';
  name.placeholder = 'file name'; name.title = 'The file name - and the ad name on Meta';
  // One line for two things: what the name says against the pattern, and what saving did.
  const hint = el('span', 'mv3-rr-hint');
  const cancel = el('button', 'mv3-c-btn u-btn' + (o.fresh ? ' danger is-danger' : ''), o.fresh ? 'Cancel' : 'Close'); cancel.type = 'button';
  if (o.fresh) cancel.title = 'Delete this render';
  const save = el('button', 'mv3-c-btn mv3-x-go u-btn is-main', 'Save & download'); save.type = 'button';
  // THE SUBTITLES FILE beside the render (phase V30, block 4): shown when it has one; downloaded with the video only
  // when this is ticked - off unless the person ticked it last time (the owner's (с38)).
  const srtBox = el('span', 'mv3-x-check');
  const srtLbl = document.createElement('label');
  const srtOn = document.createElement('input');
  srtOn.type = 'checkbox'; srtOn.classList.add('u-check');
  srtOn.checked = _srtWanted();
  srtOn.addEventListener('change', () => { try { localStorage.setItem(LS_SRT, srtOn.checked ? '1' : '0'); } catch (e) { /* a private window */ } });
  srtLbl.append(srtOn, el('span', null, '.srt too'));
  srtBox.appendChild(srtLbl);
  srtBox.hidden = true;
  foot.appendChild(name); foot.appendChild(hint); foot.appendChild(srtBox); foot.appendChild(cancel); foot.appendChild(save);
  box.appendChild(foot);
  // Whether this render has its .srt, and where: asked of the file itself, so a render opened from the queue knows too.
  const showSrt = async (url) => {
    state.srt = null;
    srtBox.hidden = true;
    const u = srtUrlOf(url);
    if (!u) return;
    try {
      const r = await fetch(u, { method: 'HEAD', cache: 'no-store' });
      if (!r.ok || state.url !== url) return;
      state.srt = u;
      srtBox.hidden = false;
      srtLbl.title = 'Also download ' + decodeURIComponent(u.split('/').pop()) + ' - the Subtitles lane as classic subtitles, beside the video in the library either way';
    } catch (e) { /* no file: nothing to offer */ }
  };
  showSrt(state.url);

  // ── keeping the parts and the name in step ──
  const say = (text, cls) => { hint.textContent = text; hint.title = text; hint.className = 'mv3-rr-hint' + (cls ? ' ' + cls : ''); };
  const paintHint = () => { const c = check(name.value); say(c.text, c.ok ? 'ok' : ''); };
  // A part is a word with no separator in it: underscores go as they are typed; on leaving
  // the field the words are joined camelCase, the way the pattern asks.
  const compose = () => {
    name.value = PARTS.map(p => {
      const f = fields[p.id];
      const raw = String(f.value || '').replace(/_/g, '');
      return raw || (p.select ? (p.id === 'trigger' ? 'TRIGGER' : 'M') : p.label.charAt(0).toUpperCase() + p.label.slice(1));
    }).join('_');
    paintHint();
  };
  const decompose = () => {
    const parts = name.value.trim().split('_');
    if (parts.length !== PARTS.length) return;
    PARTS.forEach((p, i) => { const f = fields[p.id]; if (p.select) { f.value = p.select.includes(parts[i].toUpperCase()) ? parts[i].toUpperCase() : ''; } else f.value = parts[i]; });
  };
  for (const p of PARTS) {
    const f = fields[p.id];
    f.addEventListener('input', compose);
    f.addEventListener('change', compose);
    if (!p.select) f.addEventListener('blur', () => { const c = camel(f.value); if (c && c !== f.value) { f.value = c; compose(); } });
  }
  name.addEventListener('input', () => { decompose(); paintHint(); });

  const fill = async () => {
    const got = await partsFromProject(o.key || Store.key(), o.title || Store.title());
    for (const p of PARTS) fields[p.id].value = got[p.id] || '';
    compose();
  };

  const release = () => { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {} };
  const download = (url) => {
    const a = document.createElement('a');
    a.href = url; a.download = decodeURIComponent(String(url).split('/').pop());
    document.body.appendChild(a); a.click(); a.remove();
  };

  cancel.addEventListener('click', async () => {
    if (!state.fresh || state.saved) { close(); return; }
    cancel.disabled = true; save.disabled = true;
    release();     // Windows will not unlink a file a <video> still holds
    try {
      await fetch('/api/mv3/render/discard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: state.url, queueId: state.queueId }) });
    } catch (e) {}
    close();
  });

  save.addEventListener('click', async () => {
    const want = name.value.trim();
    if (!want) { say('a name is needed', 'is-bad'); name.focus(); return; }
    save.disabled = true; cancel.disabled = true;
    say('saving…');
    release();     // the file may be renamed underneath the player
    try {
      const d = await fetch('/api/mv3/render/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: state.url, name: want, queueId: state.queueId, key: o.key || Store.key() }),
      }).then(r => r.json());
      if (!d || !d.success) throw new Error((d && d.error) || 'could not save');
      state.url = d.url; state.saved = true; state.fresh = false;
      v.src = state.url;
      download(state.url);
      // Its subtitles file, renamed with it - downloaded too when ticked (с38).
      state.srt = d.srt || null;
      srtBox.hidden = !state.srt;
      if (state.srt && srtOn.checked) download(state.srt);
      say('saved as ' + decodeURIComponent(String(d.url).split('/').pop()) + (state.srt ? ' + its .srt' : '') + ' · on the Library renders shelf', 'is-good');
      cancel.textContent = 'Close'; cancel.classList.remove('danger', 'is-danger'); cancel.title = '';
    } catch (e) {
      say(e.message, 'is-bad');
    } finally {
      save.disabled = false; cancel.disabled = false;
    }
  });

  x.addEventListener('click', () => { if (state.fresh && !state.saved) cancel.click(); else close(); });
  ov.addEventListener('mousedown', (e) => { if (e.target === ov && !(state.fresh && !state.saved)) close(); });
  ov.appendChild(box);
  document.body.appendChild(ov);
  _ov = ov;
  _layer = Layers.open(ov, { name: 'render result', onEsc: close });

  // The name on open: a file already named keeps its name and shows it taken apart; a fresh
  // render gets the parts from the project and the name they compose.
  const current = decodeURIComponent(String(o.url || '').split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '');
  if (!o.fresh && current.split('_').length === PARTS.length) { name.value = current; decompose(); paintHint(); }
  else if (!o.fresh) { name.value = current; paintHint(); await fill().then(() => { name.value = current; paintHint(); }); }
  else await fill();
}
