/* ════════════════════════════════════════════════════════════════════════════
   HOME'S QUICK START (phase V63, P14; the owner 2026-10-30 (бс1)-(бс8), 2026-11-01 (хп31)-(хп34), (хп2), (хп44), 2026-11-02
   (хп58), (хп59) and "давай сделаем его [попап highlights] в два шага быстрый запуск").

   Each tile of New project (js/home/main.js) opens ITS POPUP over Home - a window of js/gen-window.js openFrame, the page dimmed
   and blurred under it; ✕ or Escape - nothing is made, Home stays ((бс3)). The popup's press makes the project with what was
   chosen and opens it in Merge:
     blank        the name (today's date, as Merge's own) and the format 9:16 / 16:9 -> POST /api/mv3/timeline/new
     talking      THE TEXT - a scenario of the shelf, "+ your text" (a line a paragraph, (хп58)), "+ scenario" - the voiceover's
                  list (merge-v3/vo-script.js paintChooser with `put`: nothing is written until "create") - and WHO - a character
                  in a look, the list of the "who" window (merge-v3/wk-maker.js lookGroups, paintChoose); not chosen - the
                  character and the place are chosen in the project ((хп33)). "create": the project and its timeline
                  (scen-api.js talkingHead, or POST /scen3/projects { lines, name } - made English, V29), the look cast
                  (/scen3/projects/:id/cast - its name too) -> Merge on setup
     highlights   the popup of V68 in its two steps (merge-v3/hl-popup.js) with no project (GET /api/highlights/offer): its
                  press MAKES the project and starts it (POST /api/highlights/start) - the one popup that pays, (бс8) -> Merge
     voiceover    the text (the same list, the whole own text one line), the mood (/scen3/motion-presets) and the voice - field
                  1's menu and the voices' window as they are (merge-v3/wk-voice.js paintRow, openVoices; a NEW voice of the
                  library may be taken here, (хп59) - it is a saved voice from then on) -> THE voiceover draft with them
                  (scen-api.js voiceoverDraft, /scen3/projects/:id/script, /scen3/projects { voice, video }) -> Merge on setup
   EACH REMEMBERS ITS LAST CHOICE ((хп2); (бс7) is undone): `ugc_home_start_v1` (mirrored into the library by storage-sync.js) -
   blank its format; talking its text and look; voiceover its text, voice and mood; highlights its own memory by kinds
   (`mv3_hl_kinds_v1`, merge-v3/hl-kinds.js - one with Merge's). Merge's "+ new project" stays as it was ((бс2)).
   ════════════════════════════════════════════════════════════════════════════ */

import { openFrame, GEN_SIZE, POPUP_SIZE } from '../gen-window.js';
import { showError } from '../notice.js';
import { el, api, ls, lsSet } from './util.js';
import { sheets } from './windows.js';

const KEEP = 'ugc_home_start_v1';
const _mem = (kind) => { const m = ls(KEEP, null); return (m && typeof m === 'object' && m[kind] && typeof m[kind] === 'object') ? m[kind] : {}; };
const _keep = (kind, v) => { const m = ls(KEEP, null); const all = m && typeof m === 'object' ? m : {}; all[kind] = v; lsSet(KEEP, all); };

// The sheets of what each popup borrows: Merge's (the lists, the voice row, the buttons), the dialogs' (the scenario window, the
// own text), the attachment window's tiles (who), the captions' and the popup's own (highlights).
const BASE = ['merge-v3.css', 'dialog.css'];
const SHEETS = { blank: BASE, talking: BASE.concat(['mv3-imagen.css']), voiceover: BASE, highlights: BASE.concat(['mv3-captions.css', 'mv3-highlights.css']) };

async function _post(url, body) {
  let r = null, d = null;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    d = await r.json();
  } catch (e) { d = null; }
  if (!r || !d || d.success === false) throw new Error((d && d.error) || 'The app did not answer - try again in a moment.');
  return d;
}
const _merge = (key, step) => { location.href = '/merge?p=' + encodeURIComponent(key) + (step ? '&step=' + step : ''); };
const _today = () => new Date().toISOString().slice(0, 10);
const _foreign = (t) => /(?!\p{Script=Latin})\p{L}/u.test(String(t || ''));

let _cur = null;                   // the popup open: { kind, frame }

/** A tile pressed: `kind` - 'blank' | 'talking' | 'highlights' | 'voiceover'. */
export async function openStart(kind) {
  if (_cur && _cur.frame.alive()) return;
  try {
    await sheets(SHEETS[kind] || BASE);
    if (kind === 'blank') _blank();
    else if (kind === 'talking') await _talking();
    else if (kind === 'voiceover') await _voiceover();
    else if (kind === 'highlights') await _highlights();
  } catch (e) { showError('The quick start did not open: ' + ((e && e.message) || e)); }
}

// A popup's window: the frame, its crumb, `onClose` - and `_cur` while it is open.
function _frame(kind, label, o) {
  let frame = null;
  frame = openFrame({
    name: label, size: o.size, geom: o.geom,
    onClose: () => { if (_cur && _cur.frame === frame) _cur = null; if (o.onClose) o.onClose(); },
  });
  frame.setCrumbs([{ label: 'new project · ' + label }]);
  frame.body.classList.add('hm-qs');
  _cur = { kind, frame };
  return frame;
}
// The foot every popup has: what it says, and its press.
function _foot(frame, label, title) {
  const foot = el('div', 'mv3-x-foot hm-qs-foot');
  const said = el('span', 'hm-qs-said');
  const go = el('button', 'mv3-c-btn hm-qs-go u-btn is-main', label);
  go.type = 'button';
  if (title) go.title = title;
  foot.append(said, go);
  frame.body.appendChild(foot);
  return { foot, said, go, say: (t, bad) => { said.textContent = t || ''; said.classList.toggle('is-bad', !!bad); } };
}

// ── BLANK: the name and the format ((хп31), (хп44)) ─────────────────────────────
function _blank() {
  const st = { format: _mem('blank').format === '16:9' ? '16:9' : '9:16', busy: false };
  const frame = _frame('blank', 'blank', { size: { w: 560, h: 330 }, geom: { key: 'start_blank', move: true, keepPos: true } });
  const form = el('div', 'hm-qs-form');
  frame.body.appendChild(form);
  form.appendChild(el('div', 'mv3-x-hdr', 'name'));
  const name = el('input', 'mv3-sc-inp hm-qs-name');
  name.type = 'text';
  name.maxLength = 120;
  name.value = _today() + ' - ';
  name.placeholder = 'what the project is called';
  form.appendChild(name);
  form.appendChild(el('div', 'mv3-x-hdr', 'format'));
  const fmts = el('div', 'hm-qs-fmts');
  form.appendChild(fmts);
  const btns = {};
  for (const [f, word] of [['9:16', 'vertical'], ['16:9', 'horizontal']]) {
    const b = el('button', 'hm-qs-fmt');
    b.type = 'button';
    b.append(el('span', 'hm-qs-shape ' + (f === '9:16' ? 'is-v' : 'is-h')), el('b', null, f), el('small', null, word));
    b.addEventListener('click', () => { st.format = f; paint(); });
    btns[f] = b;
    fmts.appendChild(b);
  }
  form.appendChild(el('p', 'mv3-x-note', 'An empty timeline - main video, main audio and Subtitles; the format can be changed in the preview later.'));
  const F = _foot(frame, 'create', 'Make the empty project and open it in Merge');
  const paint = () => {
    for (const [f, b] of Object.entries(btns)) b.classList.toggle('is-on', f === st.format);
    F.go.disabled = st.busy || !name.value.trim();
    F.go.textContent = st.busy ? 'creating…' : 'create';
  };
  const go = async () => {
    const title = name.value.trim();
    if (st.busy) return;
    if (!title) { F.say('A name is needed.', true); return; }
    st.busy = true;
    F.say('');
    paint();
    try {
      const d = await _post('/api/mv3/timeline/new', { title, kind: 'blank', format: st.format });
      _keep('blank', { format: st.format });
      _merge(d.key);
    } catch (e) { st.busy = false; F.say(e.message, true); paint(); }
  };
  F.go.addEventListener('click', go);
  name.addEventListener('input', () => { F.say(''); paint(); });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  paint();
  setTimeout(() => { name.focus(); name.setSelectionRange(name.value.length, name.value.length); }, 0);
}

// ── THE TEXT - one card for the talking head and the voiceover ──────────────────
// Chosen: its title, how many lines, the lines themselves, "other text" (back to the list) and - one's own - "edit". Not chosen:
// the list of the voiceover's script column as it is (vo-script.js paintChooser), its choice kept here (`put`), not written.
//   st.text: { from: 'scenario', scenarioId, title, n, gender } | { from: 'text', lines, name } (talking) | { from: 'text', text, name }
async function _textCard(host, st, o) {
  const VS = await import('../merge-v3/vo-script.js');
  const VT = await import('../merge-v3/vo-text.js');
  const API = await import('../merge-v3/scen-api.js');
  const lines = {};                         // scenario id -> its lines, read once
  const put = (body, s) => {
    if (body.scenarioId != null) {
      const sc = s || {};
      const g = String(sc.gender || ((sc.roles || [])[0] || {}).gender || '').toLowerCase();
      st.text = { from: 'scenario', scenarioId: String(body.scenarioId), title: String(sc.title || 'untitled'),
        n: +sc.lineCount || (Array.isArray(sc.lines) ? sc.lines.length : 0), gender: g };
      if (Array.isArray(sc.lines)) lines[st.text.scenarioId] = sc.lines.map(l => String((l && l.text) || l || '')).filter(Boolean);
    } else if (o.talking) st.text = { from: 'text', lines: body.lines || [], name: String(body.name || '') };
    else st.text = { from: 'text', text: String(body.text || ''), name: String(body.name || '') };
    o.changed();
    return Promise.resolve(st.text);
  };
  const adopt = () => paint();
  adopt.repaint = () => paint();
  const own = () => (st.text && st.text.from === 'text'
    ? { text: o.talking ? (st.text.lines || []).join('\n') : st.text.text, name: st.text.name } : {});
  async function linesOf(id) {
    if (lines[id]) return lines[id];
    const s = await API.get(id);
    lines[id] = (s && Array.isArray(s.lines) ? s.lines : []).map(l => String((l && l.text) || '')).filter(Boolean);
    return lines[id];
  }
  function paint() {
    host.textContent = '';
    if (!st.text) {
      VS.paintChooser(host, null, adopt, {
        put, talking: !!o.talking, ownText: own,
        hint: o.talking ? 'The text of the talking head: a scenario, or your own - every paragraph a line, with its own frame and clip.'
          : 'The script of the voiceover: a scenario, or your own text - all of it one take.',
      });
      return;
    }
    const t = st.text;
    const card = el('div', 'hm-qs-text');
    const head = el('div', 'hm-qs-text-h');
    const title = t.from === 'scenario' ? t.title : (t.name || (o.talking ? (t.lines || [])[0] : t.text) || 'your text');
    head.appendChild(el('b', null, title));
    const sub = el('span', 'hm-qs-text-sub');
    head.appendChild(sub);
    head.appendChild(el('span', 'sp'));
    if (t.from === 'text') {
      const ed = el('button', 'mv3-sc-new u-btn is-s', 'edit');
      ed.type = 'button';
      ed.title = 'Change the text';
      ed.addEventListener('click', () => VT.openOwnText((b) => put(b), adopt, { talking: !!o.talking, ...own() }));
      head.appendChild(ed);
    }
    const other = el('button', 'mv3-sc-new u-btn is-s', 'other text');
    other.type = 'button';
    other.title = 'Back to the scenarios and your own text';
    other.addEventListener('click', () => { st.text = null; o.changed(); paint(); });
    head.appendChild(other);
    card.appendChild(head);
    const list = el('ol', 'hm-qs-lines');
    card.appendChild(list);
    host.appendChild(card);
    const show = (arr) => {
      const n = arr.length;
      sub.textContent = (t.from === 'scenario' ? 'scenario · ' : 'your text · ') + (o.talking ? n + (n === 1 ? ' line' : ' lines') : 'one take');
      list.textContent = '';
      for (const s of arr) list.appendChild(el('li', null, s));
    };
    if (t.from === 'text') show(o.talking ? (t.lines || []) : [t.text]);
    else {
      show([]);
      sub.textContent = 'scenario · reading its lines…';
      linesOf(t.scenarioId).then((arr) => { if (st.text === t) show(o.talking ? arr : [arr.join(' ')]); })
        .catch(() => { if (st.text === t) { st.text = null; o.changed(); paint(); } });
    }
  }
  paint();
  return { paint };
}

// ── TALKING HEAD: the text and who ((хп32), (хп33), (хп58)) ────────────────────
async function _talking() {
  const CS = await import('../chars-store.js');
  const WM = await import('../merge-v3/wk-maker.js');
  const API = await import('../merge-v3/scen-api.js');
  const m = _mem('talking');
  const st = { text: m.text && typeof m.text === 'object' ? m.text : null, look: m.look && m.look.obrazId ? m.look : null, busy: false };
  // (the owner's check of P14: "попап talking head - тоже компактней. поле who под полем сценариев") The chats' size, ONE column:
  // the text, who under it.
  const frame = _frame('talking', 'talking head', { size: POPUP_SIZE, geom: { key: 'start_talking', resize: true, move: true, keepSize: true, keepPos: true } });
  const cols = el('div', 'hm-qs-cols is-one');
  const L = el('div', 'hm-qs-col is-text');
  const R = el('div', 'hm-qs-col is-who');
  cols.append(L, R);
  frame.body.appendChild(cols);
  L.appendChild(el('div', 'mv3-x-hdr', 'the text'));
  const textHost = el('div', 'hm-qs-box');
  L.appendChild(textHost);
  R.appendChild(el('div', 'mv3-x-hdr', 'who'));
  const whoLine = el('div', 'hm-qs-who');
  R.appendChild(whoLine);
  const whoHost = el('div', 'hm-qs-box is-choose');
  R.appendChild(whoHost);
  const F = _foot(frame, 'create', 'Make the talking head and open it in Merge, on its setup');
  const keep = () => _keep('talking', { text: st.text, look: st.look });

  let chars = null;
  const whoState = {};
  const paintFoot = () => {
    const t = st.text;
    F.go.disabled = st.busy || !t;
    F.go.textContent = st.busy ? 'creating…' : 'create';
    if (!st.busy) F.say(!t ? 'Choose the text first - a scenario, or your own.' : '', !t);
  };
  const paintWho = () => {
    whoLine.textContent = '';
    if (st.look) {
      whoLine.appendChild(el('span', null, st.look.characterName + ' · in this look'));
      const x = el('button', 'mv3-sc-new u-btn is-s', '✕ none');
      x.type = 'button';
      x.title = 'Choose nobody here - the character and the place are chosen in the project';
      x.addEventListener('click', () => { st.look = null; keep(); paintWho(); });
      whoLine.appendChild(x);
    } else whoLine.appendChild(el('span', 'hm-qs-quiet', 'Not chosen - the character and the place are chosen in the project.'));
    if (!chars) { whoHost.textContent = 'reading the characters…'; return; }
    const g = st.text && st.text.gender ? st.text.gender : '';
    WM.paintChoose(whoHost, {
      state: whoState,
      groups: WM.lookGroups(chars),
      filter: g ? { label: g, on: true, test: (grp) => CS.filterByGender([grp.char], g).length > 0 } : null,
      mark: (it) => (it.look && st.look && String(it.look.id) === String(st.look.obrazId) ? 'chosen' : ''),
      press: (it) => {
        if (!it.look) return;
        const same = st.look && String(st.look.obrazId) === String(it.look.id);
        st.look = same ? null : { characterId: String(it.char.id), characterName: it.char.name, obrazId: String(it.look.id), obrazImage: it.look.image };
        keep();
        paintWho();
      },
      empty: chars.length ? 'No looks yet - a character is dressed in a look in the project, "who".'
        : 'No characters yet - make one with New Character (Library on Home).',
    });
  };
  await _textCard(textHost, st, { talking: true, changed: () => { keep(); paintFoot(); paintWho(); } });
  paintFoot();
  paintWho();
  CS.loadCharacters().then((all) => {
    chars = CS.byLooks(all || []);
    // A look remembered that is not on its character any more is let go.
    if (st.look && !chars.some(c => (c.obrazy || []).some(o => String(o.id) === String(st.look.obrazId)))) { st.look = null; keep(); }
    if (st.look) whoState.group = st.look.characterId;
    paintWho();
  }).catch((e) => { whoHost.textContent = 'Could not read the characters: ' + e.message; });

  F.go.addEventListener('click', async () => {
    const t = st.text;
    if (!t || st.busy) return;
    st.busy = true;
    paintFoot();
    F.say(t.from === 'text' && _foreign((t.lines || []).join(' ')) ? 'translating into English…' : 'making the project…');
    try {
      let key = '';
      if (t.from === 'scenario') key = await API.talkingHead(t.scenarioId);
      else {
        const d = await _post('/api/scen3/projects', { lines: t.lines, name: t.name });
        key = (await _post('/api/mv3/timeline/new', { projectId: d.project.id })).key;
      }
      if (st.look) {
        // Cast as the "who" window casts: its name follows (V67). A refusal leaves "who" to the project.
        try { await _post('/api/scen3/projects/' + encodeURIComponent(key.replace(/^sv3_/, '')) + '/cast', st.look); }
        catch (e) { console.warn('[home/start] the look was not cast - it is chosen in the project:', e.message); }
      }
      keep();
      _merge(key, 'setup');
    } catch (e) { st.busy = false; paintFoot(); F.say(e.message, true); }
  });
}

// ── VOICEOVER: the text, the mood and the voice ((хп34), (хп59)) ───────────────
async function _voiceover() {
  const VOICE = await import('../merge-v3/wk-voice.js');
  const API = await import('../merge-v3/scen-api.js');
  const m = _mem('voiceover');
  const st = { text: m.text && typeof m.text === 'object' ? m.text : null, pick: m.pick && m.pick.voiceId ? m.pick : null,
    mood: String(m.mood || ''), moods: null, busy: false };
  const frame = _frame('voiceover', 'voiceover', {
    size: GEN_SIZE, geom: { key: 'start_voiceover', resize: true, move: true, keepSize: true, keepPos: true },
    onClose: () => { VOICE.closeVoices(); VOICE.leave(); },
  });
  const cols = el('div', 'hm-qs-cols');
  const L = el('div', 'hm-qs-col');
  const R = el('div', 'hm-qs-col');
  cols.append(L, R);
  frame.body.appendChild(cols);
  L.appendChild(el('div', 'mv3-x-hdr', 'the text'));
  const textHost = el('div', 'hm-qs-box');
  L.appendChild(textHost);
  R.appendChild(el('div', 'mv3-x-hdr', 'mood'));
  const moodSel = el('select', 'mv3-wk-vsel hm-qs-mood');
  moodSel.title = 'The emotion of the whole voiceover: the text is marked up by it, and read by its [tags]';
  R.appendChild(moodSel);
  const moodAbout = el('p', 'mv3-x-note');
  R.appendChild(moodAbout);
  R.appendChild(el('div', 'mv3-x-hdr', 'voice'));
  const voiceHost = el('div', 'hm-qs-voice');
  const voiceNotes = el('div', 'hm-qs-vnotes');
  R.append(voiceHost, voiceNotes);
  R.appendChild(el('p', 'mv3-x-note', 'What is not chosen here is chosen in the project\'s setup, field 1. A voice taken from the ElevenLabs library is saved with its demo - a little of ElevenLabs\' credits.'));
  const F = _foot(frame, 'create', 'Put the text, the mood and the voice into the voiceover draft and open it in Merge, on its setup');
  const keep = () => _keep('voiceover', { text: st.text, pick: st.pick, mood: st.mood });
  const textOf = () => (!st.text ? '' : st.text.from === 'text' ? st.text.text : st.text.title);

  // The voice: field 1's row and its menu, with the popup as its project (nobody cast - the pick is the voice).
  const vapi = {
    char: () => null, project: () => null, projectId: () => '', setProject: () => {},
    mood: () => st.mood, pick: () => st.pick,
    setPick: async (entry) => { st.pick = entry || null; keep(); },
    go: (v) => { if (v === 'voice') VOICE.openVoices(vapi, { key: 'home-voiceover', lang: VOICE.scriptLang(true, textOf()) }); },
    repaint: () => { paintVoice(); VOICE.paintVoices(vapi); },
    reload: () => Promise.resolve(),
    note: (t, bad) => el('div', 'hm-qs-vnote' + (bad ? ' is-bad' : ''), t),
    patchChar: async () => { throw new Error('a voiceover has no character'); },
  };
  function paintVoice() {
    voiceHost.textContent = '';
    voiceNotes.textContent = '';
    VOICE.paintRow(voiceHost, vapi, { notes: voiceNotes });
  }
  const paintMood = () => {
    moodSel.textContent = '';
    const none = el('option', '', st.moods ? 'none - chosen in the project' : 'reading the moods…');
    none.value = '';
    moodSel.appendChild(none);
    for (const md of st.moods || []) {
      const o = el('option', '', md.label);
      o.value = md.id;
      if (md.id === st.mood) o.selected = true;
      moodSel.appendChild(o);
    }
    const cur = (st.moods || []).find(md => md.id === st.mood);
    moodAbout.textContent = cur ? (cur.about || '') : '';
  };
  moodSel.addEventListener('change', () => { st.mood = moodSel.value; keep(); paintMood(); });
  const paintFoot = () => {
    F.go.disabled = st.busy;
    F.go.textContent = st.busy ? 'creating…' : 'create';
  };
  await _textCard(textHost, st, { talking: false, changed: () => keep() });
  paintMood();
  paintVoice();
  paintFoot();
  api('/api/scen3/motion-presets').then((d) => {
    st.moods = Array.isArray(d.moods) ? d.moods : [];
    if (st.mood && !st.moods.some(md => md.id === st.mood)) { st.mood = ''; keep(); }
    paintMood();
  }).catch(() => { st.moods = []; paintMood(); });

  F.go.addEventListener('click', async () => {
    if (st.busy) return;
    st.busy = true;
    paintFoot();
    F.say('putting it into the voiceover draft…');
    try {
      const key = await API.voiceoverDraft();
      const id = key.replace(/^sv3_/, '');
      const t = st.text;
      if (t) await API.voiceoverScript(id, t.from === 'scenario' ? { scenarioId: t.scenarioId } : { text: t.text, name: t.name });
      const patch = {};
      if (st.pick) patch.voice = { pick: st.pick };
      if (st.mood) patch.video = { mood: st.mood };
      if (Object.keys(patch).length) await _post('/api/scen3/projects', { id, ...patch });
      keep();
      _merge(key, 'setup');
    } catch (e) { st.busy = false; paintFoot(); F.say(e.message, true); }
  });
}

// ── HIGHLIGHTS: its popup, its press makes the project ((бс5), (бс8)) ───────────
async function _highlights() {
  const HP = await import('../merge-v3/hl-popup.js');
  if (HP.isOpen()) return;
  const offer = await api('/api/highlights/offer');
  HP.openPopup(null, offer, {
    start: (spec) => _post('/api/highlights/start', spec),
    onStarted: (alertId, d) => { if (d && d.key) _merge(d.key); },
  });
}
