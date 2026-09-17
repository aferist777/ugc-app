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

// One player for the whole panel: two voices at once is not a comparison, it is noise. The row
// that owns the sound is remembered so a repaint can put the pause sign back where it was.
let _audio = null;
let _playing = '';

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
    host.appendChild(_pick(api, 'choose a voice'));
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
  host.appendChild(row);

  if (now) host.appendChild(el('div', 'mv3-wk-vsub', _sub(now) || 'no tags'));
  if (!now) host.appendChild(api.note('None of them is set as the voice - pick one above.', true));
  // What the sub-level had to say - a voice taken, or one that could not be - is said ONCE
  // here, on the way back, and then let go: it is news about what just happened, not a label.
  if (_said) { host.appendChild(api.note(_said, _bad)); _said = ''; _bad = false; }
  host.appendChild(_pick(api, 'another voice'));
}

function _pick(api, label) {
  const b = el('button', 'mv3-wk-vmore', label);
  b.type = 'button';
  b.title = 'The saved voices, and the ElevenLabs library';
  b.addEventListener('click', () => api.go('voice'));
  const row = el('div', 'mv3-wk-vfoot');
  row.appendChild(b);
  return row;
}

// ── The sub-level ───────────────────────────────────────────────────────────
function _bar(head, api) {
  const acts = el('div', 'mv3-wk-bar');
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
  head.appendChild(acts);
}

export function paintPicker(host, head, api) {
  _bar(head, api);
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
  api.repaint();
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
  api.repaint();
}

// The voice of the character, from one they already have. `voices` is untouched - this says
// only which of them is THE one.
async function _star(api, voiceId) {
  if (_busy || !voiceId) return;
  _busy = 'star';
  _said = ''; _bad = false;
  api.repaint();
  try {
    await api.patchChar({ voice: String(voiceId) });
  } catch (e) {
    _said = 'Could not set the voice: ' + e.message;
    _bad = true;
  }
  _busy = '';
  api.repaint();
}

// Taking ADDS the voice to the account - ElevenLabs answers voice_not_found for a library id
// that is not in it - and the account-side id it hands back is the one that goes on the
// character. It becomes the voice straight away: the one just chosen on purpose is the one
// meant to be used.
async function _take(api, card) {
  if (_busy) return;
  _busy = 'take:' + card.voice_id;
  _said = ''; _bad = false;
  api.repaint();
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
  api.repaint();
}

/** Coming back to the hub leaves the search behind, but not what was said about the last take. */
export function leave() {
  if (_audio) { _audio.pause(); _playing = ''; }
}
