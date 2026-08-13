// Scenarios v3 — the voice studio: who is speaking, and which voice they get.
//
//   left   the cast character's face, so a voice is chosen against a person and not
//          against a name in a dropdown
//   right  the ElevenLabs shared library: six filters, pages, a free sample per voice
//
// The read always uses the CAST CHARACTER's voice, so what is chosen here is written to the
// character record and holds for every project that casts them. That is deliberate, and
// the popup says whose face it is showing for exactly that reason.
//
// Auditioning is the owner's own sample: free, and it is genuinely that voice. Hearing OUR
// line in it would be real synthesis, which needs the voice in the account and costs
// credits — so that is deliberately not here.

import { castFace, voiceFilters, voiceLibrary, takeVoice, patchCharacter, getProject } from './api.js';
import { adoptProject } from './projects.js';
import { startInlineProgress, freeze } from '../progress.js';

const $ = (sel, root) => (root || document).querySelector(sel);

let _ov = null;
let _kit = null;        // the filter vocabularies, fetched once per page
let _char = null;       // who this popup is casting for
let _audio = null;      // the sample playing, so a second click stops it
let _searchT = null;
let _page = 0;
let _projectId = '';
let _charP = null;      // resolves once the cast character is known
let _saved = [];        // the voices saved for this character
let _active = '';       // the starred one — the same value as character.voice
let _taking = false;    // a take is in flight: the whole picker is frozen meanwhile

// Only ElevenLabs for now. The picker exists because everything in this popup belongs to
// the chosen service — its filters, its library, its terms — so a second provider will
// bring its own panel rather than quietly reusing this one.
const PROVIDERS = [{ id: 'elevenlabs', label: 'ElevenLabs' }];

export function openVoicePopup({ project } = {}) {
  closeVoicePopup();
  if (!project) return;

  const ov = document.createElement('div');
  ov.className = 'sv3-pop-ov sv3-vp-ov';
  ov.innerHTML = `
    <div class="sv3-pop sv3-vp">
      <div class="sv3-pop-head">
        <span class="sv3-pop-title">Voice studio</span>
        <span class="sv3-vp-who"></span>
        <span class="sp"></span>
        <select class="sv3-mt-prov" id="sv3-vp-prov"
                title="Whose library this studio searches. Everything here belongs to it."></select>
        <button class="sv3-btn sm" data-x="close" type="button">&#10005;</button>
      </div>
      <div class="sv3-vp-body">
        <div class="sv3-vp-face">
          <div class="sv3-vp-facebox"><div class="sv3-vp-ph">no reference sheet</div></div>
          <div class="sv3-vp-name"></div>
          <div class="sv3-vp-saved"></div>
        </div>
        <div class="sv3-vp-find">
          <div class="sv3-vp-filters">
            <div class="sv3-vp-selects"></div>
          </div>
          <div class="sv3-vp-results"><div class="sv3-empty">Searching…</div></div>
          <div class="sv3-vp-pager"></div>
        </div>
      </div>
      <div class="sv3-pop-foot">
        <span class="sv3-status" id="sv3-vp-status"></span>
      </div>
    </div>`;
  document.body.appendChild(ov);
  _ov = ov;

  const prov = $('#sv3-vp-prov', ov);
  PROVIDERS.forEach(p => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.label;
    prov.appendChild(o);
  });
  prov.value = PROVIDERS[0].id;
  prov.disabled = PROVIDERS.length < 2;

  $('[data-x="close"]', ov).addEventListener('click', closeVoicePopup);
  ov.addEventListener('click', (e) => { if (e.target === ov) closeVoicePopup(); });
  document.addEventListener('keydown', _onKey);

  _projectId = project.id;
  // The filters open on the character's own gender, so the two have to be sequenced: run
  // them in parallel and whichever wins decides whether the gender gets pre-filled at all.
  _charP = _fillFace(project.id);
  _buildFilters();
}

// ── the search ──────────────────────────────────────────────────────────────
const _status = (t, kind) => {
  const n = _ov && $('#sv3-vp-status', _ov);
  if (!n) return;
  n.textContent = t || '';
  n.className = 'sv3-status' + (kind ? ' ' + kind : '');
};

// The vocabularies are a snapshot on the server — the API offers no endpoint that lists
// them — so this fetches them once and builds the dropdowns from that.
async function _buildFilters() {
  const ov = _ov;
  try {
    if (!_kit) _kit = await voiceFilters();
    if (_ov !== ov) return;
  } catch (e) {
    _status('Could not load the filters: ' + e.message, 'err');
    return;
  }
  const wrap = $('.sv3-vp-selects', ov);
  const add = (key, label, options) => {
    const sel = document.createElement('select');
    sel.dataset.k = key;
    sel.title = label;
    const any = document.createElement('option');
    any.value = ''; any.textContent = label;
    sel.appendChild(any);
    options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = typeof o === 'string' ? o : o.id;
      opt.textContent = typeof o === 'string' ? o : o.label;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => _search(true));
    wrap.appendChild(sel);
  };
  add('gender', 'any gender', _kit.genders || []);
  add('age', 'any age', _kit.ages || []);
  // `descriptives`, plural — the singular form is accepted and then ignored
  add('descriptives', 'any character', _kit.descriptives || []);
  add('use_cases', 'any use', _kit.useCases || []);
  add('accent', 'any accent', _kit.accents || []);
  add('language', 'any language', _kit.languages || []);

  // English by default: the ads are read in it, and without this the first page is a mix of
  // thirty-two languages most of which cannot be used here.
  const lsel = wrap.querySelector('[data-k="language"]');
  if (lsel && [...lsel.options].some(o => o.value === 'en')) lsel.value = 'en';

  // Open on something useful rather than on an empty list: this character's own gender. Both
  // filters always STAY — they are pre-filled, never replaced — so any other value is one
  // click away. The wait matters: the character arrives on its own request, and without it
  // whichever call won the race would decide whether the gender was filled at all.
  try { await _charP; } catch (e) {}
  if (_ov !== ov) return;
  const g = (_char && _char.gender || '').toLowerCase();
  if (g === 'male' || g === 'female') {
    const gsel = wrap.querySelector('[data-k="gender"]');
    if (gsel) gsel.value = g;
  }
  _search(true);
}

// A hundred at a time. Measured against 24 before choosing: 0.9s and 76KB versus 0.7s and
// 18KB, so the round trip to ElevenLabs dominates and the extra rows are nearly free. A long
// first page means the filters get used instead of the pager.
const PER_PAGE = 100;

function _params() {
  const out = { page_size: PER_PAGE, page: _page };
  _ov.querySelectorAll('.sv3-vp-selects select').forEach(s => { if (s.value) out[s.dataset.k] = s.value; });
  return out;
}

// Pages, not an endless "more": with the filters wide open the library holds ten thousand
// voices, and a list that only grows downward gives no way back to the one seen four
// screens ago.
async function _search(reset) {
  const ov = _ov;
  if (reset) _page = 0;
  const results = $('.sv3-vp-results', ov);
  const pager = $('.sv3-vp-pager', ov);
  results.innerHTML = '<div class="sv3-empty">Searching…</div>';
  pager.textContent = '';
  _stopSample();                       // the page under it is about to be replaced
  _status('');
  try {
    const d = await voiceLibrary(_params());
    if (_ov !== ov) return;
    results.textContent = '';
    if (!d.voices.length) {
      results.innerHTML = '<div class="sv3-empty">Nothing matches those filters.</div>';
      return;
    }
    d.voices.forEach(v => results.appendChild(_card(v)));
    results.scrollTop = 0;
    _paintPager(pager, d.total, d.hasMore);
  } catch (e) {
    if (_ov !== ov) return;
    _status('Search failed: ' + e.message, 'err');
  }
}

// prev · the first page · a window around the current one · the last page · next.
// With the filters wide open there are 443 pages, so they cannot all be numbers — and the
// arrows are there because a page number is a small target to hit.
function _paintPager(host, total, hasMore) {
  host.textContent = '';
  const pages = total ? Math.ceil(total / PER_PAGE) : (_page + (hasMore ? 2 : 1));
  const count = document.createElement('span');
  count.className = 'sv3-vp-count';
  count.textContent = total ? `${total} voice${total === 1 ? '' : 's'}` : '';

  if (pages <= 1) { host.appendChild(count); return; }

  const go = (p) => { _page = Math.max(0, Math.min(pages - 1, p)); _search(false); };
  const btn = (label, target, opts) => {
    const o = opts || {};
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sv3-btn sm sv3-vp-pg' + (o.on ? ' on' : '');
    b.textContent = label;
    if (o.title) b.title = o.title;
    if (o.disabled) b.disabled = true;
    else b.addEventListener('click', () => go(target));
    host.appendChild(b);
  };
  const gap = () => {
    const s = document.createElement('span');
    s.className = 'sv3-vp-gap';
    s.textContent = '…';
    host.appendChild(s);
  };

  btn('‹ prev', _page - 1, { disabled: _page === 0, title: 'Previous page' });
  const span = 2;
  const from = Math.max(0, _page - span);
  const to   = Math.min(pages - 1, _page + span);
  if (from > 0) { btn('1', 0); if (from > 1) gap(); }
  for (let p = from; p <= to; p++) btn(String(p + 1), p, { on: p === _page });
  if (to < pages - 1) { if (to < pages - 2) gap(); btn(String(pages), pages - 1); }
  btn('next ›', _page + 1, { disabled: _page >= pages - 1, title: 'Next page' });
  host.appendChild(count);
}

function _card(v) {
  const el = document.createElement('div');
  el.className = 'sv3-vp-card';
  const labels = [v.gender, v.age && String(v.age).replace('_', ' '), v.accent, v.descriptive,
                  v.use_case && String(v.use_case).replace(/_/g, ' ')].filter(Boolean).join(' · ');
  // The avatar IS the play control: a round portrait with a play mark over it reads as
  // "listen to this one" without a second button competing with `take`.
  el.innerHTML = `
    <button class="sv3-vp-av" data-a="play" type="button">
      ${v.image_url ? `<img src="${v.image_url}" alt="">` : ''}
      <span class="sv3-vp-avmark">&#9654;</span>
    </button>
    <div class="sv3-vp-meta">
      <div class="sv3-vp-vname"></div>
      <div class="sv3-vp-labels"></div>
      <div class="sv3-vp-extra"></div>
    </div>
    <div class="sv3-vp-acts">
      <button class="sv3-btn sm primary" data-a="take" type="button">take</button>
    </div>`;
  $('.sv3-vp-vname', el).textContent = v.name || v.voice_id;
  $('.sv3-vp-labels', el).textContent = labels;
  const extra = [];
  if (v.cloned_by_count) extra.push(`${v.cloned_by_count} uses`);
  if (v.featured) extra.push('featured');
  if (v.language) extra.push(v.language);
  $('.sv3-vp-extra', el).textContent = extra.join(' · ');
  if (v.description) el.title = v.description;

  const play = $('[data-a="play"]', el);
  if (!v.preview_url) { play.disabled = true; play.title = 'no sample for this voice'; }
  else {
    play.title = "The owner's own sample — free, and it is this voice";
    play.addEventListener('click', () => _playSample(v.preview_url, play));
  }
  if (!v.image_url) play.classList.add('no-pic');
  $('[data-a="take"]', el).addEventListener('click', (e) => _take(v, e.currentTarget));
  return el;
}

// ── the voices saved for this character ─────────────────────────────────────
// The STARRED one is `character.voice`, the single id every read uses — so the star is not a
// preference stored beside the truth, it IS the truth, drawn.
function _renderSaved() {
  const host = _ov && $('.sv3-vp-saved', _ov);
  if (!host) return;
  host.textContent = '';
  if (!_saved.length) {
    const e = document.createElement('div');
    e.className = 'sv3-vp-nosaved';
    e.textContent = 'no voices saved for this character yet';
    host.appendChild(e);
    return;
  }
  _saved.forEach((v, i) => {
    const on = v.voiceId === _active;
    const row = document.createElement('div');
    row.className = 'sv3-vp-srow' + (on ? ' on' : '');
    row.innerHTML = `
      <div class="sv3-vp-shead">
        <button class="sv3-vp-splay" type="button" title="Play our own sample of this voice">&#9654;</button>
        <span class="sv3-vp-sname"></span>
        <button class="sv3-vp-star${on ? ' on' : ''}" type="button">&#9733;</button>
        <button class="sv3-vp-sdel" type="button" title="Forget this voice">&#10005;</button>
      </div>`;
    $('.sv3-vp-sname', row).textContent = v.name || v.voiceId;

    // The labels and the description are still KEPT with the voice — they are just not given
    // a row of their own. Hovering shows them; the list stays one line per voice.
    const L = v.labels || {};
    const bits = [L.gender, L.age && String(L.age).replace('_', ' '), L.accent, L.descriptive,
                  L.use_case && String(L.use_case).replace(/_/g, ' '), L.language, L.category].filter(Boolean);
    row.title = [bits.join(' · '), v.description,
                 `${v.voiceId}${v.dur ? ' · sample ' + (+v.dur).toFixed(1) + 's' : ''}`]
      .filter(Boolean).join('\n');

    const play = $('.sv3-vp-splay', row);
    if (!v.sample) { play.disabled = true; play.title = 'no sample was recorded for this voice'; }
    else play.addEventListener('click', () => _playSample(v.sample, play));

    const star = $('.sv3-vp-star', row);
    star.title = on ? 'This is the voice every read uses' : 'Make this the voice every read uses';
    if (!on) star.addEventListener('click', () => _star(v));
    $('.sv3-vp-sdel', row).addEventListener('click', () => _forget(v, i));
    host.appendChild(row);
  });
}

// Starring writes `character.voice`. Nothing else has to be told: the read, the counters and
// the Voice-over column all read that one field.
async function _star(v) {
  try {
    await patchCharacter(_char.id, { voice: v.voiceId });
    _active = v.voiceId;
    _renderSaved();
    if (_projectId) { try { adoptProject(await getProject(_projectId)); } catch (e) {} }
    _fillFace(_projectId);
    _status(`"${v.name}" is now ${_char.name}'s voice`, 'ok');
  } catch (e) {
    _status('Could not switch the voice: ' + e.message, 'err');
  }
}

// Forgetting only drops our record of it. The voice stays on the ElevenLabs account, because
// deleting it there could pull it out from under another character using the same one.
async function _forget(v, i) {
  if (v.voiceId === _active) {
    _status('That is the voice in use — star another one first', 'err');
    return;
  }
  const next = _saved.slice(0, i).concat(_saved.slice(i + 1));
  try {
    await patchCharacter(_char.id, { voices: next });
    _saved = next;
    _renderSaved();
    _status(`"${v.name}" removed from the list — it stays on your ElevenLabs account`, 'ok');
  } catch (e) {
    _status('Could not remove it: ' + e.message, 'err');
  }
}

// One sample at a time. Same rule as the fragment reads: a second click stops it.
function _playSample(url, btn) {
  const wasThis = _audio && _audio.btn === btn;
  _stopSample();
  if (wasThis) return;
  const el = new Audio(url);
  _audio = { el, btn };
  btn.classList.add('is-playing');
  const mark = btn.querySelector('.sv3-vp-avmark');
  if (mark) mark.textContent = '■'; else btn.textContent = '■';
  el.addEventListener('ended', _stopSample);
  el.addEventListener('error', () => { _stopSample(); _status('could not play that sample', 'err'); });
  el.play().catch(() => { _stopSample(); _status('could not play that sample', 'err'); });
}

function _stopSample() {
  if (!_audio) return;
  try { _audio.el.pause(); } catch (e) {}
  const b = _audio.btn;
  _audio = null;
  if (b && b.isConnected) {
    b.classList.remove('is-playing');
    const mark = b.querySelector('.sv3-vp-avmark');
    if (mark) mark.textContent = '▶'; else b.textContent = '▶';
  }
}

// Taking a voice adds it to the account — ElevenLabs will not speak with a library id — and
// writes the resulting id onto the CHARACTER, so it holds for every project casting them.
async function _take(v, btn) {
  if (!_char || _taking) return;
  const ov = _ov;
  _taking = true;
  btn.textContent = '…';
  // Nothing else may be chosen while this runs: it adds a voice to the account and records a
  // sample, and a second take landing mid-flight would leave two voices half-saved.
  const thaw = freeze($('.sv3-vp-body', ov));
  // The countdown learns from the last takes — the first one on a machine has no timing to go
  // on, so it starts from what the one measured run took and corrects itself after that.
  const prog = startInlineProgress($('.sv3-pop-foot', ov), {
    label: `Taking "${v.name}" — adding it and recording a sample`,
    estimateMs: 30000,
  });
  _status('');
  try {
    const got = await takeVoice({ ownerId: v.public_owner_id, voiceId: v.voice_id, name: v.name });
    const voiceId = got.voiceId;
    // Everything about the voice is kept with it: its labels, the owner's description, and the
    // sample we just had it read. That is what stops the library being consulted again.
    const entry = {
      voiceId, name: v.name, ownerId: v.public_owner_id,
      sample: got.sample || '', dur: got.dur || 0,
      description: v.description || '',
      labels: {
        gender: v.gender || '', age: v.age || '', accent: v.accent || '',
        descriptive: v.descriptive || '', use_case: v.use_case || '',
        language: v.language || '', category: v.category || '',
      },
      at: new Date().toISOString(),
    };
    const next = _saved.filter(x => x.voiceId !== voiceId).concat([entry]);
    // The newest becomes the starred one, which is the same act as writing `voice`.
    await patchCharacter(_char.id, { voices: next, voice: voiceId });
    _saved = next;
    _active = voiceId;
    _renderSaved();
    if (got.sampleError) _status('Voice taken, but its sample failed: ' + got.sampleError, 'err');
    // The project's own copy carries a DERIVED "does the cast character have a voice", so it
    // has to be re-read for the Voice-over column to stop refusing.
    if (_projectId) { try { adoptProject(await getProject(_projectId)); } catch (e) {} }
    if (_ov !== ov) return;
    prog.finish();
    if (!got.sampleError) {
      _status(`"${v.name}" is now ${_char.name}'s voice · sample ${(got.dur || 0).toFixed(1)}s`, 'ok');
    }
    _charP = _fillFace(_projectId);
    btn.textContent = 'taken';
    btn.disabled = true;
  } catch (e) {
    prog.fail('Could not take that voice: ' + e.message);
    if (_ov !== ov) return;
    _status('Could not take that voice: ' + e.message, 'err');
    btn.textContent = 'take';
  } finally {
    _taking = false;
    thaw();
  }
}

// The face is cropped and cached SERVER-side: the sheet is 4K and its own thumbnail is far
// too small for a panel this size, so a face-sized one is made once and reused.
async function _fillFace(projectId) {
  const ov = _ov;
  try {
    const d = await castFace(projectId);
    if (_ov !== ov) return;                       // closed while it loaded
    const box = $('.sv3-vp-facebox', ov);
    const pic = d.face || d.obraz || '';
    if (pic) {
      box.textContent = '';
      const img = document.createElement('img');
      img.src = pic;
      img.alt = '';
      box.appendChild(img);
    }
    _char = d.character || null;
    _saved = Array.isArray(d.voices) ? d.voices : [];
    _active = String(d.active || '');
    $('.sv3-vp-who', ov).textContent = d.character ? d.character.name : '';
    $('.sv3-vp-name', ov).textContent = d.character
      ? `${d.character.name}${d.character.gender ? ' · ' + d.character.gender : ''}` : '';
    // No voice line here any more: the starred row below says which voice is in use, and a
    // bare id above the list only ate the space that list needs.
    _renderSaved();
  } catch (e) {
    if (_ov !== ov) return;
    _status('Could not load the character: ' + e.message, 'err');
  }
}

function _onKey(e) { if (e.key === 'Escape') closeVoicePopup(); }

export function closeVoicePopup() {
  if (!_ov) return;
  _stopSample();
  clearTimeout(_searchT);
  _ov.remove();
  _ov = null;
  document.removeEventListener('keydown', _onKey);
}
