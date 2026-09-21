/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the voice of the character who speaks (docs/local-app/PLAN.md, "Setting & voice",
   phase V2).

   Two faces, and they are the same question one level apart:

     the voice row      which voice this character speaks in, chosen from the ones they already
                        have - a demo to listen to and a dropdown to change it - at the top of the
                        voice field of the setup (js/merge-v3/wk-fragments.js)
     voice              the sub-level: the saved voices in full, and under them the ElevenLabs
                        shared library with its filters, to take a new one; painted into the right
                        column beside the script

   THE READS ARE SPOKEN FROM HERE (generate, readLine, readAll, saveText): the fragments pane shows
   the lines and their buttons, and this module is what those buttons call - a take is the voice's
   business, whichever panel asks for it. ONE MODEL, ElevenLabs v3 with tags (decided with the owner
   2026-09-21, docs/local-app/PLAN.md, phase W): a line is tagged by the mood of the video before it is
   read, the words with their tags are what the take says, and a project read with v2 before that
   keeps those reads until a line is read again.

   A VOICE BELONGS TO THE CHARACTER, not to this project (decided with the owner): changing the
   voice here is ADDING one to that character. `voices` is everything they have, `voice` is the
   one every read uses, and both are written through the Character page's own door
   (PATCH /api/char-store/:id) - so a voice taken here is on the Character page the moment it
   is taken, and the two cannot disagree.

   BEFORE THERE IS A CHARACTER the project may choose a voice of its own (the owner, 2026-09-21,
   phase W2.5): `choose a voice` opens the same library, and the voice taken is written on the
   project (`voice.pick`, routes/scen3.js) - the reads use it until a character with a voice of
   their own is cast, and a character's voice wins the moment they are. A character without one
   reads in the project's pick too.

   TAKING IS THE ONLY PAID THING HERE, and it is small: the account gains a voice slot and the
   server records our own 30-second demo with it (routes/scen3.js, /scen3/voices/take). A voice
   the library already holds keeps the demo it has and costs nothing. Searching and listening to
   the owners' samples is free, which is why the search is free to be pressed as often as it takes.
   Nothing on this level goes into Alerts: a voice answers in seconds, and a row that is finished
   before it can be read is noise (decided with the owner).
   ════════════════════════════════════════════════════════════════════════════ */

import { el } from './wk-maker.js';
import { isRead, plainWords } from './scen-api.js';

const PAGE = 12;                       // results per page; the panel shows them as a list

let _filters = null;                   // the vocabularies, read once per page load
let _res = null;                       // the last search: { voices, total, hasMore }
let _page = 1;
let _busy = '';                        // 'search' | 'take:<voice id>' | 'star' - one at a time
let _said = '';                        // what the panel says under the bar
let _bad = false;                      // ...and whether that is a failure
let _asked = false;                    // a search has been run, so the pager means something
let _q = { search: '', gender: '', age: '', accent: '', descriptives: '', use_cases: '', language: '' };

// The reads. THREE LINES AT A TIME for "generate" (the owner, 2026-09-21): one call carries a
// chunk, the server speaks its lines together and writes the project once, and half a second
// later the next chunk goes - so the panel says how far it has got instead of freezing for a
// minute, and the script is read in a third of the time.
const CHUNK = 3;
const CHUNK_GAP_MS = 500;
let _reading = [];                      // the lines being spoken now
let _batch = null;                      // { done, total } while every stale line is being read
let _tagging = false;                   // the tagger is marking the script up
let _rsaid = '';                        // what the reads have to say, and whether it is bad
let _rbad = false;

// One player for the whole panel: two voices at once is not a comparison, it is noise. The row
// that owns the sound is remembered so a repaint can put the pause sign back where it was.
let _audio = null;
let _playing = '';

// A repaint is the step's: the list the reads change lives in the fragments pane, which keeps its
// own scroll offset across repaints (js/merge-v3/wk-fragments.js, _listAt).
const _repaint = (api) => api.repaint();

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
// Only the voices' buttons: the reads in the script have a player of their own
// (js/merge-v3/wk-fragments.js, .is-read).
function _mark() {
  const on = !!(_audio && !_audio.paused) ? _playing : '';
  document.querySelectorAll('.mv3-wk-vplay:not(.is-read)').forEach((b) => {
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

// ── The voice row ───────────────────────────────────────────────────────────
// The character has a voice or they have not, and both answers lead to the same place: the
// sub-level where voices are chosen. The dropdown is only for the ones already theirs - picking
// a NEW one is a search, not a choice from a list. With nobody cast, or a character with no
// voice of their own, the row is the project's own pick - or the way to one.
export function paintRow(host, api) {
  const rec = api.char();
  const pick = api.pick();
  const mine = _saved(rec);
  const now = _active(rec);

  const row = el('div', 'mv3-wk-vrow is-now');
  if (!mine.length && pick) {
    // The project's own voice: one, so a name rather than a menu of one.
    row.appendChild(_playBtn(pick.sample || '', 'our own demo'));
    const txt = el('div', 'mv3-wk-vtxt');
    txt.appendChild(el('div', 'mv3-wk-vname', pick.name || pick.voiceId));
    txt.appendChild(el('div', 'mv3-wk-vsub', rec
      ? 'the project’s voice - ' + (rec.name || 'the character') + ' has none of their own'
      : 'the project’s voice - a character with one of their own will speak in theirs'));
    row.appendChild(txt);
    row.appendChild(_pick(api, 'change'));
  } else if (!mine.length) {
    row.appendChild(el('span', 'mv3-wk-vsub is-grow', rec
      ? (rec.name || 'This character') + ' has no voice yet - every line is read in it'
      : 'No voice yet - choose one for the project, or a character who has one'));
    row.appendChild(_pick(api, 'choose a voice'));
  } else {
    row.appendChild(_playBtn((now && now.sample) || '', 'our own demo'));
    const sel = el('select', 'mv3-wk-vsel');
    sel.title = 'The voice every line is read in' + (now ? ' · ' + (_sub(now) || 'no tags') : '');
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
  }
  host.appendChild(row);

  if (mine.length && !now) host.appendChild(api.note('None of them is set as the voice - pick one above.', true));
  // What the sub-level had to say - a voice taken, or one that could not be - is said ONCE
  // here, on the way back, and then let go: it is news about what just happened, not a label.
  if (_said) { host.appendChild(api.note(_said, _bad)); _said = ''; _bad = false; }
  if (_rsaid) host.appendChild(api.note(_rsaid, _rbad));
}

/** Does the character have a voice to read in? */
export const hasVoice = (rec) => !!_active(rec);
/** Is there a voice to read in at all - the character's, or the project's own pick? The field's
 *  `generate` and every read button wait for one. The server applies the same rule
 *  (routes/scen3.js, _castVoice). */
export const canRead = (api) => hasVoice(api.char()) || !!api.pick();

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
  x.title = 'Back to the script';
  x.addEventListener('click', () => api.go('hub'));
  acts.appendChild(x);
  host.appendChild(acts);
}

export function paintPicker(host, api) {
  _bar(host, api);
  const rec = api.char();
  if (_filters === null) { _loadFilters(api); host.appendChild(api.note('reading the filters…')); return; }

  const mine = _saved(rec);
  const now = String((rec && rec.voice) || '');
  const own = api.pick();

  if (rec) {
    host.appendChild(el('div', 'mv3-wk-vhead', mine.length
      ? (rec.name || 'This character') + '’s voices'
      : (rec.name || 'This character') + ' has no voice yet'));
  } else {
    host.appendChild(el('div', 'mv3-wk-vhead', own ? 'The project’s voice' : 'No voice yet'));
  }
  // The project's own pick, when it is what the reads use: no character, or one without a voice.
  if (own && !mine.length) {
    const row = el('div', 'mv3-wk-vrow is-on');
    row.appendChild(_playBtn(own.sample || '', 'our own demo'));
    const txt = el('div', 'mv3-wk-vtxt');
    txt.appendChild(el('div', 'mv3-wk-vname', own.name || own.voiceId));
    txt.appendChild(el('div', 'mv3-wk-vsub', _sub(own) || 'no tags'));
    row.appendChild(txt);
    row.appendChild(el('span', 'mv3-wk-vtag', 'the voice'));
    host.appendChild(row);
    host.appendChild(api.note(rec
      ? 'Every line is read in it until ' + (rec.name || 'the character') + ' is given a voice of their own.'
      : 'Every line is read in it. A character cast with a voice of their own speaks in theirs.'));
  } else if (!rec && !own) {
    host.appendChild(api.note('Take one from the library below - it becomes the project’s voice. A character cast later with a voice of their own speaks in theirs.'));
  }
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
    return;
  }
  const found = (_res && _res.voices) || [];
  if (!found.length) {
    host.appendChild(api.note(_busy === 'search' ? 'searching…' : 'Nothing matches all of those. Drop a filter.'));
    return;
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
    take.title = !rec ? 'Add it to the account and make it the project’s voice'
      : have.has(String(v.voice_id))
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
// character, or on the project when nobody is cast. It becomes the voice straight away: the one
// just chosen on purpose is the one meant to be used.
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

    const rec = api.char();
    const entry = {
      voiceId: t.voiceId, name: t.name || card.name, gender: card.gender || '',
      age: card.age || '', accent: card.accent || '', descriptive: card.descriptive || '',
      language: card.language || '', sample: t.sample || '', dur: t.dur || 0,
    };
    if (!rec) {
      // Nobody cast: the project's own voice (routes/scen3.js, voice.pick).
      await api.setPick(entry);
      _said = t.reused ? 'Already in the library, so its demo was kept. It is the project’s voice now.'
        : t.sampleError ? 'Taken. Its demo failed to record, which is cosmetic.'
          : 'Taken - it is the project’s voice now.';
      _bad = false;
      _busy = '';
      return _repaint(api);
    }
    const all = _saved(rec);
    const had = all.some(v => String(v.voiceId) === String(t.voiceId));
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

// ── The reads ───────────────────────────────────────────────────────────────
// A take is STALE when the words are no longer the ones that were spoken - the server keeps what
// it said in each take (routes/scen3.js, /scen3/voice/speak) - so nothing has to be marked by
// hand, and editing a line makes its read stale by itself. Unread or stale is the one rule,
// shared with the timeline chip that waits for every line (js/merge-v3/scen-api.js).
//
// The read is the standard one: eleven_multilingual_v2, no tags, no parameters (decided with the
// owner; moods and tags are a conversation of their own). That is what a project with no voice
// settings gets, and none are set here.
const _needs = (l) => !isRead(l);
const _tagged = (l) => !!String((l && l.tagged) || '').trim();

/** What the reads are doing: the tagger at work, the lines being spoken (none, one, or a chunk
 *  of three), and the batch "generate" is walking, if any. */
export const reading = () => ({ tagging: _tagging, lines: _reading, busy: _tagging || _reading.length > 0 || !!_batch, batch: _batch });

/** The words of a line, changed - with their [tags] when the line has tags, which the server keeps
 *  as long as the words in them are these words. What the take said stays with the take, which is
 *  what makes the line stale until it is read again - or the words are put back. */
export async function saveText(api, i, text) {
  const raw = String(text || '').trim();
  const words = plainWords(raw);
  if (!words) { _rsaid = 'A line cannot be empty.'; _rbad = true; return _repaint(api); }
  const p = api.project() || {};
  const l = (Array.isArray(p.lines) ? p.lines : [])[i];
  _rsaid = ''; _rbad = false;
  _repaint(api);
  try {
    const d = await (await fetch('/api/scen3/projects/' + encodeURIComponent(api.projectId()) + '/line', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_tagged(l) ? { index: i, text: words, tagged: raw } : { index: i, text: words }),
    })).json();
    if (!d || !d.success) throw new Error((d && d.error) || 'refused');
    api.setProject(d.project);
  } catch (e) {
    _rsaid = 'Could not save the words: ' + e.message;
    _rbad = true;
  }
  _repaint(api);
}

// ── The tags ────────────────────────────────────────────────────────────────
// The tagger marks the script up by the mood of the video (routes/scen3.js, /scen3/voice/tag): the
// whole script when nothing is tagged yet - the arc is a property of the sequence - and only the
// lines that lack tags when some are, so what was approved stays as it is. The server switches the
// project to the tagged read as it does.
async function _tag(api, only) {
  const body = { projectId: api.projectId(), mood: api.mood() };
  if (only && only.length) body.only = only;
  const d = await (await fetch('/api/scen3/voice/tag', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })).json();
  if (!d || !d.success) throw new Error((d && d.error) || 'the tagging failed');
  api.setProject(d.project);
  return d.report || {};
}

/**
 * The voice field's `generate` (decided with the owner 2026-09-21): the tags where they are
 * missing, then every line that needs reading, one after another - no second press, the read is
 * credits rather than dollars.
 */
export async function generate(api) {
  if (_tagging || _reading.length || _batch) return;
  const p = api.project() || {};
  const lines = Array.isArray(p.lines) ? p.lines : [];
  const untagged = lines.map((l, i) => (_tagged(l) ? -1 : i)).filter(i => i >= 0);
  _tagging = true;
  _rsaid = ''; _rbad = false;
  _repaint(api);
  try {
    if (untagged.length) await _tag(api, untagged.length === lines.length ? [] : untagged);
  } catch (e) {
    _tagging = false;
    _rsaid = 'The tagging failed: ' + e.message;
    _rbad = true;
    return _repaint(api);
  }
  _tagging = false;
  await readAll(api);
}

// A chunk of lines, spoken now in one call - tagged first where they have no tags yet, because
// every read is v3 with tags. The server speaks them together, writes their takes into the
// project itself and answers with the project as it now stands - which is what the panel paints
// from. `inBatch` is how "generate" gets past the guard that stops a second read starting on top
// of one already running: the batch IS that runner, and without it its first chunk refuses
// itself. A stray click cannot get in this way - the buttons are disabled while a batch runs.
async function _speak(api, lines, inBatch) {
  if (_reading.length || (_batch && !inBatch)) return false;
  _reading = lines.slice();
  _rsaid = ''; _rbad = false;
  _repaint(api);
  let ok = false;
  try {
    const p = api.project() || {};
    const all = Array.isArray(p.lines) ? p.lines : [];
    const untagged = lines.filter(i => all[i] && !_tagged(all[i]));
    if (untagged.length) await _tag(api, untagged);
    const d = await (await fetch('/api/scen3/voice/speak', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: api.projectId(), only: lines }),
    })).json();
    if (!d || !d.success) throw new Error((d && d.error) || 'refused');
    api.setProject(d.project);
    const bad = ((d.report || {}).failed || []);
    if (bad.length) {
      throw new Error((bad.length === 1 ? 'line ' + bad[0].line : 'lines ' + bad.map(b => b.line).join(', '))
        + ' - ' + (bad[0].error || 'not read'));
    }
    ok = true;
  } catch (e) {
    _rsaid = (lines.length === 1 ? 'Line ' + (lines[0] + 1) + ' was not read: ' : 'Not read: ') + e.message;
    _rbad = true;
  }
  _reading = [];
  _repaint(api);
  return ok;
}

/** One line, spoken now - from the open fragment's own button. */
export const readLine = (api, i) => _speak(api, [i], false);

// Every line that needs it, three at a time with half a second between the chunks (the owner,
// 2026-09-21), so the panel can say how far it has got. It stops at the first chunk that fails:
// twelve identical refusals say nothing the first one did not.
const _wait = (ms) => new Promise(r => setTimeout(r, ms));
export async function readAll(api) {
  const p = api.project() || {};
  const want = (Array.isArray(p.lines) ? p.lines : []).map((l, i) => (_needs(l) ? i : -1)).filter(i => i >= 0);
  if (!want.length) return;
  _batch = { done: 0, total: want.length };
  _repaint(api);
  for (let at = 0; at < want.length; at += CHUNK) {
    if (at) await _wait(CHUNK_GAP_MS);
    const chunk = want.slice(at, at + CHUNK);
    const ok = await _speak(api, chunk, true);
    if (!ok) break;
    _batch.done += chunk.length;
    _repaint(api);
  }
  _batch = null;
  _repaint(api);
}

/** Coming back to the hub leaves the search behind, but not what was said about the last take. */
export function leave() {
  if (_audio) { _audio.pause(); _playing = ''; }
}
