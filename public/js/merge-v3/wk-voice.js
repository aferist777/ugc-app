/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the voice of the character who speaks (docs/local-app/PLAN.md, "Setting & voice",
   phase V2).

   Two faces, and they are the same question one level apart:

     the hub's right half   which voice this character speaks in, chosen from the ones they
                            already have - a demo to listen to and a dropdown to change it
     voice                  the sub-level: the saved voices in full, and under them the
                            ElevenLabs shared library with its filters, to take a new one

   A VOICE BELONGS TO THE CHARACTER, not to this project (decided with the owner): changing the
   voice here is ADDING one to that character. `voices` is everything they have, `voice` is the
   one every read uses, and both are written through the Character page's own door
   (PATCH /api/char-store/:id) - so a voice taken here is on the Character page the moment it
   is taken, and the two cannot disagree.

   TAKING IS THE ONLY PAID THING HERE, and it is small: the account gains a voice slot and the
   server records our own 30-second demo with it (routes/scen3.js, /scen3/voices/take). A voice
   the library already holds keeps the demo it has and costs nothing. Searching and listening to
   the owners' samples is free, which is why the search is free to be pressed as often as it takes.
   Nothing on this level goes into Alerts: a voice answers in seconds, and a row that is finished
   before it can be read is noise (decided with the owner).
   ════════════════════════════════════════════════════════════════════════════ */

import { el } from './wk-maker.js';

const PAGE = 12;                       // results per page; the panel shows them as a list

let _filters = null;                   // the vocabularies, read once per page load
let _res = null;                       // the last search: { voices, total, hasMore }
let _page = 1;
let _busy = '';                        // 'search' | 'take:<voice id>' | 'star' - one at a time
let _said = '';                        // what the panel says under the bar
let _bad = false;                      // ...and whether that is a failure
let _asked = false;                    // a search has been run, so the pager means something
let _q = { search: '', gender: '', age: '', accent: '', descriptives: '', use_cases: '', language: '' };

// The reads. One line at a time, even for "read all": the call takes a line and answers when it
// has been spoken, so asking for them one by one is the same money and a panel that says how far
// it has got instead of freezing for a minute.
let _reading = -1;                      // the line being spoken now, -1 for none
let _batch = null;                      // { done, total } while every stale line is being read
let _armed = false;                     // "read all" has been pressed once and is asking
let _edit = -1;                         // the line whose words are open for editing
let _draft = '';
let _rsaid = '';                        // what the reads block has to say, and whether it is bad
let _rbad = false;

// One player for the whole panel: two voices at once is not a comparison, it is noise. The row
// that owns the sound is remembered so a repaint can put the pause sign back where it was.
let _audio = null;
let _playing = '';

// WHERE THE PANEL WAS SCROLLED TO. A finished read repaints the whole step, and a rebuilt column
// starts at the top - so a batch of twelve lines threw the list back to line one every few seconds
// (owner, 2026-09-18). The offset is remembered here and put back after the paint.
let _scrollAt = { hub: 0, voice: 0 };
let _face = 'hub';                      // which of the two is on screen, so the offset goes in its own slot
const _col = () => document.querySelector('.mv3-wk-half.is-guide');

// EVERY REPAINT GOES THROUGH HERE. A repaint rebuilds the column, and a rebuilt column starts at
// the top - so reading twelve lines threw the list back to line one every few seconds (owner,
// 2026-09-18). Where it stood is read off the live column at the moment it is thrown away, not
// from a scroll event: the event arrives after the frame, which is too late when the rebuild is
// in the same tick.
function _repaint(api) {
  const col = _col();
  if (col) _scrollAt[_face] = col.scrollTop;
  api.repaint();
}

function _putScroll(host, where) {
  _face = where;
  const at = _scrollAt[where] || 0;
  if (!at) return;
  // Straight away, not on the next frame: a second repaint can land in the same tick - a read
  // starts one and finishes another - and it would read this column back at zero and remember
  // THAT. The column is already in the panel by now (js/merge-v3/wk-setting.js).
  host.scrollTop = at;
}

function _play(src) {
  if (!src) return;
  if (!_audio) {
    _audio = new Audio();
    _audio.addEventListener('ended', () => { _playing = ''; _mark(); });
    _audio.addEventListener('pause', () => { _mark(); });
    _audio.addEventListener('play', () => { _mark(); });
  }
  if (_playing === src && !_audio.paused) { _audio.pause(); return; }
  _playing = src;
  _audio.src = src;
  _audio.play().catch(() => { _playing = ''; _mark(); });
}

// The buttons follow the SOUND, not the click: a sample that will not play must not leave a
// pause sign standing over silence.
function _mark() {
  const on = !!(_audio && !_audio.paused) ? _playing : '';
  document.querySelectorAll('.mv3-wk-vplay').forEach((b) => {
    const is = b.dataset.src && b.dataset.src === on;
    b.textContent = is ? '❚❚' : '▶';
    b.classList.toggle('is-playing', !!is);
  });
}

function _playBtn(src, what) {
  const b = el('button', 'mv3-wk-vplay', '▶');
  b.type = 'button';
  b.disabled = !src;
  b.dataset.src = src || '';
  b.title = src ? 'Play ' + what : 'It has no sample';
  b.addEventListener('click', (e) => { e.stopPropagation(); _play(src); });
  return b;
}

// What a voice is, in one line: the tags that are actually set, in the order they read.
const _sub = (v) => [v.descriptive, v.gender, v.age && String(v.age).replace(/_/g, ' '), v.accent, v.language]
  .map(x => String(x || '').trim()).filter(Boolean).join(' · ');

const _saved = (rec) => (rec && Array.isArray(rec.voices) ? rec.voices : []);
const _active = (rec) => {
  const id = String((rec && rec.voice) || '');
  return _saved(rec).find(v => String(v.voiceId) === id) || null;
};

// ── The hub's right half ────────────────────────────────────────────────────
// The character has a voice or they have not, and both answers lead to the same place: the
// sub-level where voices are chosen. The dropdown is only for the ones already theirs - picking
// a NEW one is a search, not a choice from a list.
export function paintHub(host, api) {
  const rec = api.char();
  host.appendChild(el('div', 'mv3-wk-guide-h', 'The voice'));
  if (!rec) { host.appendChild(api.note('reading the character…')); return; }

  const mine = _saved(rec);
  const now = _active(rec);
  if (!mine.length) {
    host.appendChild(el('p', 'mv3-wk-guide-p',
      (rec.name || 'This character') + ' has no voice yet. Every line is read in it, so it is chosen once and stays with the character.'));
    const foot = el('div', 'mv3-wk-vfoot');
    foot.appendChild(_pick(api, 'choose a voice'));
    host.appendChild(foot);
    return;
  }

  const row = el('div', 'mv3-wk-vrow is-now');
  row.appendChild(_playBtn((now && now.sample) || '', 'our own demo'));
  const sel = el('select', 'mv3-wk-vsel');
  sel.title = 'The voice every line is read in';
  for (const v of mine) {
    const o = el('option', '', v.name || v.voiceId);
    o.value = v.voiceId;
    if (now && v.voiceId === now.voiceId) o.selected = true;
    sel.appendChild(o);
  }
  sel.disabled = !!_busy;
  sel.addEventListener('change', () => _star(api, sel.value));
  row.appendChild(sel);
  // The way to another voice sits in the same row, right of the choice it changes (owner).
  row.appendChild(_pick(api, 'change'));
  host.appendChild(row);

  if (now) host.appendChild(el('div', 'mv3-wk-vsub', _sub(now) || 'no tags'));
  if (!now) host.appendChild(api.note('None of them is set as the voice - pick one above.', true));
  // What the sub-level had to say - a voice taken, or one that could not be - is said ONCE
  // here, on the way back, and then let go: it is news about what just happened, not a label.
  if (_said) { host.appendChild(api.note(_said, _bad)); _said = ''; _bad = false; }
  paintReads(host, api);
  _putScroll(host, 'hub');
}

function _pick(api, label) {
  const b = el('button', 'mv3-wk-vmore', label);
  b.type = 'button';
  b.title = 'The saved voices, and the ElevenLabs library';
  b.addEventListener('click', () => api.go('voice'));
  return b;
}

// ── The sub-level ───────────────────────────────────────────────────────────
function _bar(host, api) {
  const acts = el('div', 'mv3-wk-bar is-own');
  const tab = el('button', 'mv3-sc-tab is-on', 'voice');
  tab.type = 'button';
  tab.disabled = true;
  tab.title = 'The voices of this character, and the library';
  acts.appendChild(tab);
  const x = el('button', 'mv3-iconbtn', '✕');
  x.type = 'button';
  x.title = 'Back to setting & voice';
  x.addEventListener('click', () => api.go('hub'));
  acts.appendChild(x);
  host.appendChild(acts);
}

export function paintPicker(host, api) {
  _bar(host, api);
  const rec = api.char();
  if (!rec) { host.appendChild(api.note('reading the character…')); return; }
  if (_filters === null) { _loadFilters(api); host.appendChild(api.note('reading the filters…')); return; }

  const mine = _saved(rec);
  const now = String(rec.voice || '');

  host.appendChild(el('div', 'mv3-wk-vhead', mine.length
    ? (rec.name || 'This character') + '’s voices'
    : (rec.name || 'This character') + ' has no voice yet'));
  for (const v of mine) {
    const row = el('div', 'mv3-wk-vrow' + (String(v.voiceId) === now ? ' is-on' : ''));
    row.appendChild(_playBtn(v.sample || '', 'our own demo'));
    const txt = el('div', 'mv3-wk-vtxt');
    txt.appendChild(el('div', 'mv3-wk-vname', v.name || v.voiceId));
    txt.appendChild(el('div', 'mv3-wk-vsub', _sub(v) || 'no tags'));
    row.appendChild(txt);
    if (String(v.voiceId) === now) {
      row.appendChild(el('span', 'mv3-wk-vtag', 'the voice'));
    } else {
      const use = el('button', 'mv3-wk-vuse', 'use');
      use.type = 'button';
      use.title = 'Read every line in this one';
      use.disabled = !!_busy;
      use.addEventListener('click', () => _star(api, v.voiceId));
      row.appendChild(use);
    }
    host.appendChild(row);
  }

  if (_said) host.appendChild(api.note(_said, _bad));

  // ── the library ──
  host.appendChild(el('div', 'mv3-wk-vhead is-lib', 'The ElevenLabs library'));
  const f = el('div', 'mv3-wk-vfilters');
  const search = el('input', 'mv3-wk-vsearch');
  search.type = 'search';
  search.placeholder = 'a name, or a word from the description';
  search.value = _q.search;
  search.addEventListener('input', () => { _q.search = search.value; });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); _search(api, 1); } });
  f.appendChild(search);

  const pick = (key, label, list) => {
    const s = el('select', 'mv3-wk-vfilter');
    s.title = label;
    const any = el('option', '', label);
    any.value = '';
    s.appendChild(any);
    for (const it of list) {
      const id = typeof it === 'string' ? it : it.id;
      const o = el('option', '', typeof it === 'string' ? it : it.label);
      o.value = id;
      if (_q[key] === id) o.selected = true;
      s.appendChild(o);
    }
    s.addEventListener('change', () => { _q[key] = s.value; _search(api, 1); });
    f.appendChild(s);
  };
  pick('gender', 'any gender', _filters.genders || []);
  pick('age', 'any age', _filters.ages || []);
  pick('descriptives', 'any manner', _filters.descriptives || []);
  pick('use_cases', 'any use', _filters.useCases || []);
  pick('accent', 'any accent', _filters.accents || []);
  pick('language', 'any language', _filters.languages || []);
  host.appendChild(f);

  const go = el('button', 'mv3-wk-vsearchbtn', _busy === 'search' ? 'searching…' : 'search');
  go.type = 'button';
  go.disabled = !!_busy;
  go.addEventListener('click', () => _search(api, 1));
  const foot = el('div', 'mv3-wk-vfoot');
  foot.appendChild(go);
  host.appendChild(foot);

  if (!_asked) {
    host.appendChild(api.note('The library is thousands of voices. Narrow it with the filters, then search - listening costs nothing.'));
    return _putScroll(host, 'voice');
  }
  const found = (_res && _res.voices) || [];
  if (!found.length) {
    host.appendChild(api.note(_busy === 'search' ? 'searching…' : 'Nothing matches all of those. Drop a filter.'));
    return _putScroll(host, 'voice');
  }
  const have = new Set(mine.map(v => String(v.voiceId)));
  for (const v of found) {
    const row = el('div', 'mv3-wk-vrow');
    row.appendChild(_playBtn(v.preview_url || '', 'the owner’s sample'));
    const txt = el('div', 'mv3-wk-vtxt');
    txt.appendChild(el('div', 'mv3-wk-vname', v.name || v.voice_id));
    txt.appendChild(el('div', 'mv3-wk-vsub', _sub(v) || 'no tags'));
    row.appendChild(txt);
    const take = el('button', 'mv3-wk-vuse', _busy === 'take:' + v.voice_id ? '…' : 'take');
    take.type = 'button';
    take.title = have.has(String(v.voice_id))
      ? 'This character already has it - taking it again only makes it their voice'
      : 'Add it to the account and to this character';
    take.disabled = !!_busy;
    take.addEventListener('click', () => _take(api, v));
    row.appendChild(take);
    host.appendChild(row);
  }

  const total = (_res && _res.total) || found.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const pager = el('div', 'mv3-wk-vpager');
  const step = (label, to, can) => {
    const b = el('button', 'mv3-wk-vpage', label);
    b.type = 'button';
    b.disabled = !can || !!_busy;
    b.addEventListener('click', () => _search(api, to));
    pager.appendChild(b);
  };
  step('‹', _page - 1, _page > 1);
  pager.appendChild(el('span', 'mv3-wk-vcount', total + ' voices · page ' + _page + ' of ' + pages));
  step('›', _page + 1, _page < pages || (_res && _res.hasMore));
  host.appendChild(pager);
  _putScroll(host, 'voice');
}

// ── What it does ────────────────────────────────────────────────────────────
function _loadFilters(api) {
  if (_filters !== null) return;
  _filters = {};                                  // once, even if it fails: no retry storm
  fetch('/api/scen3/voices/filters').then(r => r.json()).then((d) => {
    _filters = (d && d.success) ? d : {};
    if (!d || !d.success) { _said = 'Could not read the filters: ' + ((d && d.error) || 'refused'); _bad = true; }
  }).catch((e) => { _said = 'Could not read the filters: ' + e.message; _bad = true; })
    .finally(() => api.repaint());
}

async function _search(api, page) {
  if (_busy) return;
  _busy = 'search';
  _asked = true;
  _page = Math.max(1, page || 1);
  _said = ''; _bad = false;
  _repaint(api);
  try {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(_q)) if (String(v || '').trim()) p.set(k, String(v).trim());
    p.set('page', String(_page - 1));             // the API counts from zero
    p.set('page_size', String(PAGE));
    const d = await (await fetch('/api/scen3/voices/library?' + p)).json();
    if (!d || !d.success) throw new Error((d && d.error) || 'the library did not answer');
    _res = { voices: d.voices || [], total: d.total || 0, hasMore: !!d.hasMore };
  } catch (e) {
    _res = { voices: [], total: 0, hasMore: false };
    _said = 'The search failed: ' + e.message;
    _bad = true;
  }
  _busy = '';
  _repaint(api);
}

// The voice of the character, from one they already have. `voices` is untouched - this says
// only which of them is THE one.
async function _star(api, voiceId) {
  if (_busy || !voiceId) return;
  _busy = 'star';
  _said = ''; _bad = false;
  _repaint(api);
  try {
    await api.patchChar({ voice: String(voiceId) });
  } catch (e) {
    _said = 'Could not set the voice: ' + e.message;
    _bad = true;
  }
  _busy = '';
  _repaint(api);
}

// Taking ADDS the voice to the account - ElevenLabs answers voice_not_found for a library id
// that is not in it - and the account-side id it hands back is the one that goes on the
// character. It becomes the voice straight away: the one just chosen on purpose is the one
// meant to be used.
async function _take(api, card) {
  if (_busy) return;
  _busy = 'take:' + card.voice_id;
  _said = ''; _bad = false;
  _repaint(api);
  try {
    const t = await (await fetch('/api/scen3/voices/take', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId: card.public_owner_id, voiceId: card.voice_id, name: card.name }),
    })).json();
    if (!t || !t.success) throw new Error((t && t.error) || 'the voice could not be taken');

    const rec = api.char() || {};
    const all = _saved(rec);
    const had = all.some(v => String(v.voiceId) === String(t.voiceId));
    const entry = {
      voiceId: t.voiceId, name: t.name || card.name, gender: card.gender || '',
      age: card.age || '', accent: card.accent || '', descriptive: card.descriptive || '',
      sample: t.sample || '', dur: t.dur || 0,
    };
    await api.patchChar({
      voice: t.voiceId,
      voices: all.filter(v => String(v.voiceId) !== String(t.voiceId)).concat([entry]),
    });
    // Three different things can have happened, and a sentence that blurs them sends somebody
    // looking for a second copy that does not exist.
    _said = had ? 'Already this character’s - it is their voice now.'
      : t.reused ? 'Already in the library, so its demo was kept. It is this character’s voice now.'
        : t.sampleError ? 'Taken. Its demo failed to record, which is cosmetic.'
          : 'Taken - it is this character’s voice now.';
    _bad = false;
  } catch (e) {
    _said = 'Could not take it: ' + e.message;
    _bad = true;
  }
  _busy = '';
  _repaint(api);
}

// ── The script, line by line ────────────────────────────────────────────────
// A take is STALE when the words are no longer the ones that were spoken - the server keeps what
// it said in each take (routes/scen3.js, /scen3/voice/speak) - so nothing has to be marked by
// hand, and editing a line makes its read stale by itself.
//
// The read is the standard one: eleven_multilingual_v2, no tags, no parameters (decided with the
// owner; moods and tags are a conversation of their own). That is what a project with no voice
// settings gets, and none are set here.
const _take0 = (l) => ((l && l.audio) || {}).plain || null;
const _stale = (l) => { const t = _take0(l); return !!(t && t.path && t.said !== String(l.text || '')); };
const _unread = (l) => { const t = _take0(l); return !(t && t.path); };
const _needs = (l) => _unread(l) || _stale(l);

export function paintReads(host, api) {
  const p = api.project() || {};
  const lines = Array.isArray(p.lines) ? p.lines : [];
  if (!lines.length) return;

  // Without a voice there is nothing to read WITH, and the block above already says so.
  const rec = api.char();
  if (!_active(rec)) return;

  const left = lines.filter(_needs).length;
  const head = el('div', 'mv3-wk-vhead is-lib is-row', 'The script');
  const acts = el('div', 'mv3-wk-vheadacts');
  // How many of them are read, in the heading itself (owner): the first thing looked for is
  // whether the script is done, and "9/14" answers that without counting rows.
  acts.appendChild(el('span', 'mv3-wk-vcount', (lines.length - left) + '/' + lines.length));
  head.appendChild(acts);
  host.appendChild(head);

  lines.forEach((l, i) => host.appendChild(_line(api, l, i)));

  if (_rsaid) host.appendChild(api.note(_rsaid, _rbad));

  {
    // The second press is the confirmation (decided with the owner): a batch is the one thing
    // here that spends real money, and it says how much before it does.
    const all = el('button', 'mv3-wk-vmore is-small' + (_armed ? ' is-armed' : ''),
      _batch ? 'reading ' + _batch.done + ' of ' + _batch.total + '…'
        : _armed ? 'read ' + left + (left === 1 ? ' line?' : ' lines?') : 'read all');
    all.type = 'button';
    all.title = _armed ? 'Press again to read them' : 'Read every line that needs it';
    all.disabled = !!_batch || _reading >= 0;
    all.addEventListener('click', () => {
      if (!_armed) { _armed = true; _repaint(api); return; }
      _armed = false;
      _readAll(api);
    });
    acts.appendChild(all);
  }
}

function _line(api, l, i) {
  const row = el('div', 'mv3-wk-line' + (_stale(l) ? ' is-stale' : '') + (_reading === i ? ' is-doing' : ''));
  const take = _take0(l);

  const top = el('div', 'mv3-wk-lrow');
  // The number over the length, exactly as tall as the play button beside them (owner): the
  // duration used to sit on a line of its own under the row and made every read fragment taller.
  const meta = el('div', 'mv3-wk-lmeta');
  meta.appendChild(el('span', 'mv3-wk-lnum', String(i + 1)));
  meta.appendChild(el('span', 'mv3-wk-ldur', take && take.dur ? take.dur.toFixed(1) + 's' : ''));
  top.appendChild(meta);
  top.appendChild(_playBtn((take && take.path) || '', 'this line'));

  const words = el('div', 'mv3-wk-ltext', String(l.text || ''));
  words.title = 'Change the words';
  words.addEventListener('click', () => { _edit = i; _draft = String(l.text || ''); _rsaid = ''; _repaint(api); });
  top.appendChild(words);

  const go = el('button', 'mv3-wk-vuse', _reading === i ? '…' : _unread(l) ? 'read' : 'again');
  go.type = 'button';
  go.title = _unread(l) ? 'Read this line' : 'Read it again, in place of the take it has';
  go.disabled = _reading >= 0 || !!_batch;
  go.addEventListener('click', () => _read(api, i));
  top.appendChild(go);
  row.appendChild(top);

  // Only the staleness needs a line of its own now - it is a sentence, not a number.
  if (_stale(l)) row.appendChild(el('div', 'mv3-wk-lsub', 'stale - the words have changed since'));
  // Back to what was spoken: the other way to end a staleness, and the cheap one.
  if (_stale(l) && _edit !== i) {
    const back = el('button', 'mv3-wk-lback', 'put the words back');
    back.type = 'button';
    back.title = 'Restore the line to what the take says';
    back.disabled = _reading >= 0 || !!_batch;
    back.addEventListener('click', () => _saveText(api, i, take.said));
    row.appendChild(back);
  }

  if (_edit === i) {
    const box = el('textarea', 'mv3-wk-ledit');
    box.value = _draft;
    box.rows = 3;
    box.addEventListener('input', () => { _draft = box.value; });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); _edit = -1; _repaint(api); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _saveText(api, i, _draft); }
    });
    row.appendChild(box);
    const acts = el('div', 'mv3-wk-vfoot');
    const save = el('button', 'mv3-wk-vuse', 'save');
    save.type = 'button';
    save.title = 'Save the words (Ctrl+Enter)';
    save.addEventListener('click', () => _saveText(api, i, _draft));
    const drop = el('button', 'mv3-wk-vuse', 'cancel');
    drop.type = 'button';
    drop.addEventListener('click', () => { _edit = -1; _repaint(api); });
    acts.append(save, drop);
    row.appendChild(acts);
    setTimeout(() => { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }, 0);
  }
  return row;
}

// ── What it does ────────────────────────────────────────────────────────────
async function _saveText(api, i, text) {
  const words = String(text || '').trim();
  if (!words) { _rsaid = 'A line cannot be empty.'; _rbad = true; return _repaint(api); }
  _edit = -1;
  _rsaid = ''; _rbad = false;
  _repaint(api);
  try {
    const d = await (await fetch('/api/scen3/projects/' + encodeURIComponent(api.projectId()) + '/line', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: i, text: words }),
    })).json();
    if (!d || !d.success) throw new Error((d && d.error) || 'refused');
    api.setProject(d.project);
  } catch (e) {
    _rsaid = 'Could not save the words: ' + e.message;
    _rbad = true;
  }
  _repaint(api);
}

// One line, spoken now. The server writes the take into the project itself, so what comes back
// is the project as it now stands - which is what the panel paints from.
// `inBatch` is how "read all" gets past the guard that stops a second read starting on top of one
// already running: the batch IS that runner, and without it the first line of a batch refuses
// itself. A stray click cannot get in this way - the buttons are disabled while a batch runs.
async function _read(api, i, inBatch) {
  if (_reading >= 0 || (_batch && !inBatch)) return false;
  _reading = i;
  _rsaid = ''; _rbad = false;
  _armed = false;
  _repaint(api);
  let ok = false;
  try {
    const d = await (await fetch('/api/scen3/voice/speak', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: api.projectId(), only: [i] }),
    })).json();
    if (!d || !d.success) throw new Error((d && d.error) || 'refused');
    const bad = ((d.report || {}).failed || [])[0];
    if (bad) throw new Error(bad.error || 'the line was not read');
    api.setProject(d.project);
    ok = true;
  } catch (e) {
    _rsaid = 'Line ' + (i + 1) + ' was not read: ' + e.message;
    _rbad = true;
  }
  _reading = -1;
  _repaint(api);
  return ok;
}

// Every line that needs it, one after another, so the panel can say how far it has got. It stops
// at the first failure: twelve identical refusals say nothing the first one did not.
async function _readAll(api) {
  const p = api.project() || {};
  const want = (Array.isArray(p.lines) ? p.lines : []).map((l, i) => (_needs(l) ? i : -1)).filter(i => i >= 0);
  if (!want.length) return;
  _batch = { done: 0, total: want.length };
  _repaint(api);
  for (const i of want) {
    const ok = await _read(api, i, true);
    if (!ok) break;
    _batch.done++;
    _repaint(api);
  }
  _batch = null;
  _repaint(api);
}

/** Coming back to the hub leaves the search behind, but not what was said about the last take. */
export function leave() {
  if (_audio) { _audio.pause(); _playing = ''; }
}
