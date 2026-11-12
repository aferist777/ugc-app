'use strict';

// ════════════════════════════════════════════════════════════════════════════
// GENERATED SOUND (phase V34.C, the owner 2026-10-22) - music and sound effects made by Suno (kie.ai) or ElevenLabs, from
// the sound window (js/sound/sound-window.js, on both pages). One record per press in data/audio-gens.json - the
// window's history - and, for music and sounds, one row in Alerts (lib/alerts.js kind 'music', what 'music' | 'sound').
//
// THE JOURNAL'S RULE (CLAUDE.md, PLAN.md section 9), all of it:
//   AT THE PRESS (create)  the record, pending with no task, and its Alerts row (job type 'music') with a `kick` - before
//                          anything is asked. The asking goes on behind the answer (run): the simple mode's writer first
//                          (stage "writing the style"), then the engine.
//   PAID ONCE              `asked` is written just before the create that costs money. A create with NO answer
//                          (lib/task-started.js `unsure`) fails the record with words that say it may have been paid
//                          for; a record found with `asked` and no task after the app was closed says the same and is
//                          never asked again by itself. An answer that says no about the CONTENT is `refused`: no retry.
//   THE SERVER SEES IT THROUGH  the row's poll asks kie.ai (or reads what ElevenLabs already handed back), downloads each
//                          file ONCE into media/work/ (a poll turned away is asked again next tick - it is not a failed
//                          task), and `file` puts them where they belong: music into AUDIO -> Music (lib/music-store.js,
//                          media/audio/, two Suno variants "<title> · 1" / "· 2"), sounds into SFX -> My sounds ->
//                          Generated (lib/sounds-store.js, the required category of kind 'sounds').
//                          (phase V59, the owner's (мг4а)) A press from the sound window in the Library names the folder under
//                          Music open there (`into` - a folder of kind 'music', lib/library-cats.js): the tracks lie in it;
//                          highlights and its moods take only what a mood's preset made, as before - a press with no
//                          preset while they are open lands in Music's root (the page sends no `into` for them). A folder
//                          gone by the time the tracks come - Music's root. (phase V60.2, (ми6а)) `into: 'highlights'` -
//                          Custom from a mood folder - lays them in highlights' own root (the record's `folder`, no mood).
//   RETRY FROM ALERTS      the row restarts at once on a new kick and a new record; the asking goes on behind it (`later`).
//   LYRICS                 Suno's Generate Lyrics is TEXT for a few tenths of a cent: no row in Alerts, but the same
//                          record, watched by the server here, so leaving the page loses nothing.
//
// ElevenLabs answers with the file itself: there is no task number - the call IS the generation, and its record holds
// `landed` (the file in media/work/) the moment it returns.
//
// The fake aggregator (lib/fake-agg.js, UGC_VIDEO_FAKE=1 on the checkout's own local-data): no engine is asked, the
// writer answers "[fake] ...", and after 20 s tones are made and filed like real tracks.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { writeFileAtomic } = require('./atomic-write');
const { DATA_DIR, MEDIA, CACHE_DIR } = require('./config');
const ENG = require('./audio-engines');
const FAKE = require('./fake-agg');
const JOBS = require('./gen-jobs');
const ALERTS = require('./alerts');
const REFUSAL = require('./gen-refusal');

const FILE = path.join(DATA_DIR, 'audio-gens.json');
const KEEP = 400;
// Suno takes a few minutes for its pair; ElevenLabs' longest music (10 minutes of it) takes longer than that.
const ROW_LIMIT_MS = 40 * 60 * 1000;
const LYRICS_LIMIT_MS = 6 * 60 * 1000;

const NOT_ASKED = 'the app was closed before it was asked for - try again';
const MAYBE_PAID = 'the app was closed while it was being asked for - it may have been paid for and not followed; look at the engine\'s own history before asking again';
const _unsureWords = (e) => String((e && e.message) || 'no answer').slice(0, 300)
  + ' - it may have been paid for and not followed; look at the engine\'s own history before asking again';

// ── The store ───────────────────────────────────────────────────────────────
function _read() {
  try { const l = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(l) ? l.filter(r => r && r.id) : []; }
  catch (e) { return []; }
}
// Every pending record, and the newest finished ones up to KEEP. Newest first.
function _write(list) {
  const pending = list.filter(r => r.state === 'pending');
  const ended = list.filter(r => r.state !== 'pending').slice(0, KEEP);
  const keep = new Set(pending.concat(ended));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(FILE, JSON.stringify(list.filter(r => keep.has(r)), null, 2));
}
const get = (id) => _read().find(r => r.id === String(id || '')) || null;
// Read, change one record, write - in one tick.
function _patch(id, fields) {
  const list = _read();
  const r = list.find(x => x.id === String(id || ''));
  if (!r) return null;
  Object.assign(r, fields || {});
  _write(list);
  return r;
}
// (phase V34.E, the owner's (р1)) Merge's "this project · N" is the open project's: its own presses - the draft's are the drafts'
// one list, as their chats' conversation is (lib/mv3-chat.js threadOf).
function _thread(p) {
  const k = String(p || '');
  if (!k) return '';
  let d = '';
  try { d = require('./merge-store').draftKey(); } catch (e) { /* no store: no draft */ }
  return k === d ? 'draft' : k;
}
function list(limit, project) {
  let l = _read();
  if (project) { const t = _thread(project); l = l.filter(x => _thread(x.project) === t); }
  return l.slice(0, Math.max(1, Math.min(KEEP, +limit || 60)));
}

const _newId = () => 'ag' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const _newKick = () => 'k' + crypto.randomBytes(6).toString('hex');
// The kicks of the askings running in THIS process: a record pending with no task on a kick that is not here died with
// the app.
const _asking = new Set();

// ── What a record says about itself ─────────────────────────────────────────
function _said(req) {
  const r = req || {};
  const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  if (r.mode === 'simple' && r.preset) {
    // (V34.F) A highlights mood: its name, as Music -> highlights shows it.
    const m = require('./music-store').moods().find(x => x.id === r.preset);
    // (phase V68) And the press's style, by its name: "highlights · calm · Felt Piano".
    const R = _rules();
    const s = R && typeof R.presetOf === 'function' ? R.presetOf(r.preset, r.n) : null;
    return one('highlights · ' + (m ? m.label : r.preset) + (s && s.name ? ' · ' + s.name : '') + (r.presetEdit ? ' · edited' : ''));
  }
  if (r.mode === 'simple') {
    // The almanac's chips by their labels (V34.A's CHIPS).
    const chips = [];
    let A = null;
    try { A = require('../public/js/audio/almanac-data.js'); } catch (e) { A = null; }
    for (const k of ['genre', 'mood', 'sound']) {
      for (const id of ((r.chips || {})[k] || [])) {
        const c = A && A.CHIPS && (A.CHIPS[k] || []).find(x => x && x.id === id);
        chips.push(c ? c.label : id);
      }
    }
    return one([...chips, r.words].filter(Boolean).join(', '));
  }
  if (r.mode === 'custom') return one(r.title + (r.style ? ' - ' + r.style : ''));
  if (r.mode === 'lyrics') return one(r.idea);
  if (r.mode === 'video') return one(r.description || ('music for ' + _videoName(r)));
  return one(r.prompt);
}
// (phase V54) What Video to Music's video is called: the clip's name, the file's as the page named it, else the file's own.
const _videoName = (r) => String((r.clip && r.clip.name) || r.name
  || path.posix.basename(String(r.video || '')).replace(/\.[a-z0-9]+$/i, '') || 'the video').slice(0, 120);
function _title(rec) {
  const noun = rec.kind === 'sound' ? 'Sound' : rec.kind === 'lyrics' ? 'Lyrics' : 'Music';
  return noun + ' · ' + (rec.fake ? 'FAKE · ' : '') + String(rec.said || '').slice(0, 60);
}
const _engineLabel = (rec) => rec.engine === 'eleven'
  ? 'ElevenLabs ' + (rec.mode === 'sfx' ? 'sound effects' : rec.mode === 'video' ? 'video to music' : 'music')
  : 'Suno ' + ((rec.req && rec.req.model) || 'V6') + (rec.mode === 'sounds' ? ' sounds' : rec.mode === 'lyrics' ? ' lyrics' : '');

// What "try again" sends: the person's choices as they were normalized - and, for the simple mode, the style the writer
// wrote, so a retry is the same music asked for again rather than a new reading of the chips.
const _request = (rec) => Object.assign({ mode: rec.mode }, rec.req || {}, rec.written ? { written: rec.written } : {});

// The video of Video to Music, on disk.
function _videoAbs(addr) {
  const abs = require('./media').toDiskExisting(String(addr || ''));
  return abs && fs.existsSync(abs) ? abs : '';
}

/** The keys a request needs, said in words before anything is written. */
function _keyMissing(engine) {
  if (FAKE.on()) return '';
  if (engine === 'eleven') return ENG.elKey() ? '' : 'there is no ElevenLabs key - add it on Admin -> API keys';
  const k = String((require('./helpers').kieHeaders().Authorization || '')).replace(/^Bearer\s*/, '');
  return k ? '' : 'there is no kie.ai key - add it on Admin -> API keys';
}

// (phase V54, block 2) VIDEO TO MUSIC'S LIMITS - ElevenLabs takes up to ten minutes and 200 MB: said at the press, before any
// money. A file is measured now; a clip by its length on the timeline now, and the file made of it once more before it is sent
// (_prepareClip). The length found is the record's `seconds` - the price, and the fake's tone.
const V2M_MAX_SEC = 600;
const V2M_MAX_BYTES = 200 * 1000 * 1000;
const _bad = (msg, status) => Object.assign(new Error(msg), { status: status || 400 });
const _len = (s) => (s >= 60 ? Math.floor(s / 60) + ' min ' + Math.round(s % 60) + ' s' : Math.round(s * 10) / 10 + ' s');
const _mb = (n) => Math.round(n / 1e6) + ' MB';
async function _videoCheck(req) {
  if (req.clip) {
    const c = require('./merge-clips').clipOf(req.clip.key, req.clip.clipId);
    if (c.error) throw _bad(c.error, c.code);
    const dur = Math.round((+c.clip.dur || 0) * 100) / 100;
    if (dur > V2M_MAX_SEC) throw _bad('the clip is ' + _len(dur) + ' - Video to Music takes up to 10 minutes; cut it shorter first');
    Object.assign(req.clip, { name: String(c.clip.name || req.clip.name || 'clip').slice(0, 200),
      start: Math.round((+c.clip.start || 0) * 100) / 100, dur });
    req.seconds = Math.round(dur * 10) / 10;
    return;
  }
  const abs = _videoAbs(req.video);
  if (!abs) throw _bad('that video is not on disk');
  let size = 0;
  try { size = fs.statSync(abs).size; } catch (e) { size = 0; }
  if (size > V2M_MAX_BYTES) throw _bad('the video is ' + _mb(size) + ' - Video to Music takes up to 200 MB');
  let d = 0;
  try { d = +(await require('./media-probe').probe(abs)).duration || 0; } catch (e) { d = 0; }
  if (d > V2M_MAX_SEC) throw _bad('the video is ' + _len(d) + ' long - Video to Music takes up to 10 minutes');
  if (d > 0) req.seconds = Math.round(d * 10) / 10;
}

// (phase V59, the owner's (мг4а)) The folder under Music a press asks its tracks to go into: an own folder of kind 'music'
// that is there now - '' for anything else (Music's root). Music only, and never with a highlights mood: its preset files
// its tracks into its own folder.
function _intoOf(req, into) {
  const id = String(into || '').trim();
  if (!id || !req || req.kind !== 'music') return '';
  const MUSIC = require('./music-store');
  if (req.preset && MUSIC.isMood(req.preset)) return '';
  // (phase V60.2, (ми6а)) The Library's window on a mood folder asks a press that is not the mood's preset (Custom) into
  // highlights itself: the highlights popup offers it, the mood folder keeps only what its preset made (the owner's (ф3)).
  if (id === MUSIC.HIGHLIGHTS) return MUSIC.HIGHLIGHTS;
  return require('./library-cats').find('music', id) ? id : '';
}

// (phase V60.1, the owner 2026-10-29: "давай в simple давать пользователю редактировать стандартный шаблон кнопкой edit";
// (пк6а)-(пк8а)) The sound window in the Library, on a mood folder, may send `presetEdit: { style, negative }` - the mood's preset
// with Suno's style and excludes changed, for ONE press. Checked here: a style is needed, both within Suno's lengths; an edit
// that says what the press's style says is none. lib/audio-writer-rules.js fromPreset takes it in place of that style's
// words (since V68 a mood has four, `n` picks one) - the bed's tail and excludes, the title and the mood folder (`moodMade`)
// stay the style's.
function _presetEdit(id, e, n) {
  if (!e || typeof e !== 'object') return null;
  const R = _rules();
  const L = (R && R.LIMIT) || { style: 1000, negative: 1000 };
  const one = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n').trim();
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  const style = one(e.style);
  const negative = one(e.negative);
  if (!style) throw bad('the mood\'s style is empty - write it, or go back to the standard one');
  if (style.length > L.style) throw bad('the mood\'s style is ' + style.length + ' characters - Suno takes up to ' + L.style);
  if (negative.length > L.negative) throw bad('the mood\'s excludes are ' + negative.length + ' characters - Suno takes up to ' + L.negative);
  const own = R && typeof R.presetOf === 'function' ? R.presetOf(id, n) : null;
  if (own && one(own.style) === style && one(own.negative) === negative) return null;
  return { style, negative };
}

// A record, pending with no task. Not written into Alerts - create() and the retry do that.
async function _make(mode, body, where, extra) {
  const req = ENG.normalize(mode, body);
  // (phase V60.1) A highlights mood's preset as the person changed it for this press - kept on the request, so a retry from
  // Alerts asks for the same.
  if (req.mode === 'simple' && req.preset && body && body.presetEdit) {
    const e = _presetEdit(req.preset, body.presetEdit, req.n);
    if (e) req.presetEdit = e;
  }
  if (req.mode === 'video') await _videoCheck(req);
  const miss = _keyMissing(req.engine);
  if (miss) throw Object.assign(new Error(miss), { status: 400 });
  const x = extra || {};
  const rec = {
    id: _newId(), mode: req.mode, engine: req.engine, kind: req.kind, req,
    said: _said(req).slice(0, 300),
    state: 'pending', stage: '', asked: false, taskId: '', provider: '',
    written: (x.written && typeof x.written === 'object') ? x.written : null, fell: '',
    landed: [], results: [], lyrics: [],
    error: '', refused: false, cancelled: false,
    alertId: String(x.alertId || ''), where: (where && typeof where === 'object') ? where : null,
    project: String(x.project || ''),
    // (phase V59) The folder under Music its tracks go into - an own folder of kind 'music' that is there at the press.
    into: _intoOf(req, x.into),
    at: new Date().toISOString(), askedAt: '', doneAt: '',
  };
  if (FAKE.on()) rec.fake = true;
  const l = _read();
  l.unshift(rec);
  _write(l);
  return rec;
}

/**
 * A press of "generate": the record and its Alerts row NOW, the asking behind the answer.
 * @param mode   one of ENG.MODES
 * @param body   the constructor's fields
 * @param where  the place it was started from { page, href, label, spot? } - its Alerts row leads back there
 */
async function create(mode, body, where, extra) {
  if (!ENG.MODES[mode]) throw Object.assign(new Error('no such mode: ' + mode), { status: 400 });
  if (ENG.MODES[mode].kind !== 'lyrics' && !(where && where.href)) {
    throw Object.assign(new Error('where it was asked from is needed - its row in Alerts leads back there'), { status: 400 });
  }
  const rec = await _make(mode, body, where, extra);
  const kick = _newKick();
  _asking.add(kick);
  if (rec.kind !== 'lyrics') {
    try {
      const row = JOBS.submitted({
        kind: 'music', what: rec.kind === 'sound' ? 'sound' : 'music',
        title: _title(rec), where, engine: _engineLabel(rec), taskIds: [],
        stage: _firstStage(rec),
        job: { type: 'music', params: { genId: rec.id, kick, request: _request(rec) } },
      });
      _patch(rec.id, { alertId: row.id });
    } catch (e) {
      _asking.delete(kick);
      _patch(rec.id, { state: 'failed', error: 'its row in Alerts could not be written: ' + e.message, doneAt: new Date().toISOString() });
      throw e;
    }
  }
  setImmediate(() => { run(rec.id, kick).catch(e => console.warn('[audio-gens] run', rec.id, e.message)); });
  return get(rec.id);
}

// Still this asking's: pending, not let go of, nothing asked yet that answered - and its row, when it has one, running on
// this kick with no task.
function _ours(id, kick) {
  const g = get(id);
  if (!g || g.state !== 'pending' || g.cancelled || g.taskId || (g.landed || []).length) return false;
  if (!_asking.has(kick)) return false;
  if (!g.alertId) return true;
  const row = ALERTS.get(g.alertId);
  if (!row || row.state !== 'running' || (row.taskIds || []).length) return false;
  return ((((row.job || {}).params || {}).kick) || '') === String(kick || '');
}

function _stage(id, words, kick) {
  if (!_ours(id, kick)) return;
  const g = _patch(id, { stage: String(words || '').slice(0, 120) });
  if (g && g.alertId) ALERTS.update(g.alertId, { stage: g.stage });
}

function _fail(id, why, refused) {
  const g = _patch(id, { state: 'failed', stage: '', error: String(why || 'it did not come').slice(0, 600), refused: !!refused,
    doneAt: new Date().toISOString() });
  if (g && g.alertId) ALERTS.fail(g.alertId, g.error, refused ? { refused: true } : undefined);
  return g;
}

// The row's retry request, from the record as it is now (the writer's style, once written).
function _rowRequest(id) {
  const g = get(id);
  if (!g || !g.alertId) return;
  const row = ALERTS.get(g.alertId);
  if (!row || !row.job || row.state !== 'running') return;
  ALERTS.update(g.alertId, { job: { ...row.job, params: { ...(row.job.params || {}), request: _request(g) } } });
}

// ── The writer of the simple mode ───────────────────────────────────────────
// The chips and the person's words -> Suno's style, a title, what to keep out and the knobs (the owner: "можно из чипсов
// составлять что нужно, писатель переписывает в промпт для suno"). The RULES are V34.A's (lib/audio-writer-rules.js: the
// writer's system prompt and message, `finish` - its JSON clamped into a bed's request with the bed's guards - and
// `compose` - the same request from the chips alone). The agents' ladder, asked once (a step with no answer stops it).
// With the writer off, none answering, or the fake aggregator - `compose`, and the record says why (`fell`). The chips
// are the almanac's ids by group ({ genre, mood, sound }).
function _rules() {
  try { return require('./audio-writer-rules'); } catch (e) { return null; }
}
// Only the groups: a list (an older record's, empty) is no chips.
function _chipsObj(chips) {
  const c = chips && !Array.isArray(chips) && typeof chips === 'object' ? chips : {};
  const out = {};
  for (const k of ['genre', 'mood', 'sound']) out[k] = (Array.isArray(c[k]) ? c[k] : []).map(String).slice(0, 8);
  return out;
}
function _writerInput(req) {
  return {
    engine: 'suno', chips: _chipsObj(req.chips), words: req.words ? String(req.words) : '',
    seconds: +req.seconds || 0, kind: req.projectKind || 'blank', bpm: +req.bpm || 0,
  };
}
// The request a rules' answer makes -> what the record keeps and sends.
function _fromOut(out, by, fell) {
  const i = (out && out.input) || {};
  return {
    style: String(i.style || '').slice(0, 1000), title: String(i.title || 'Background').slice(0, 80),
    negative: String(i.negative_tags || '').slice(0, 1000),
    styleWeight: i.style_weight == null ? null : +i.style_weight, weirdness: i.weirdness_constraint == null ? null : +i.weirdness_constraint,
    variety: i.variety == null ? null : +i.variety, duration: +i.duration || 0,
    by: by || (out && out.by) || '', fell: fell || '',
    // (phase V68) A mood's style names its title itself ("Calm Ground · Felt Piano") - no press number added when filed.
    ...(out && out.named ? { named: true } : {}),
  };
}
// No rules at all (V34.A's file missing): the chips as they are, a bed's tail and its excludes.
function _plain(req) {
  const words = [].concat(Array.isArray(req.chips) ? req.chips : Object.values(req.chips || {}).flat(), req.words).filter(Boolean);
  return {
    style: words.join(', ').slice(0, 900) + ', instrumental, background music, no lead melody',
    title: (words.slice(0, 3).join(' ') || 'Background').slice(0, 80),
    negative: 'vocals, singing, lyrics, spoken word', styleWeight: null, weirdness: null, variety: null,
    duration: req.seconds ? Math.max(10, Math.min(360, Math.ceil(+req.seconds) + 2)) : 0, by: 'as picked', fell: 'the writer rules are not here yet',
  };
}
async function _writeStyle(req) {
  const R = _rules();
  // (V34.F) A highlights mood is written by its preset - no writer asked, nothing to wait for.
  if (req.preset && R && typeof R.fromPreset === 'function') {
    // (phase V60.1) The person's edit of the preset for this press, when there is one.
    const out = R.fromPreset(req.preset, { engine: 'suno', n: req.n || 0, seconds: +req.seconds || 0, kind: 'highlights', edit: req.presetEdit || null });
    if (out) {
      const w = _fromOut(out, 'preset');
      if (FAKE.on()) w.style = ('[fake] ' + w.style).slice(0, 1000);
      return w;
    }
  }
  if (!R || typeof R.compose !== 'function') return _plain(req);
  const input = _writerInput(req);
  if (req.writer === false) return _fromOut(R.compose(input), 'as picked');
  if (FAKE.on()) {
    const w = _fromOut(R.compose(input), 'fake writer');
    await FAKE.think(w.style);
    w.style = ('[fake] ' + w.style).slice(0, 1000);
    return w;
  }
  let a;
  try {
    a = await require('./agents').ask([{ role: 'system', content: R.systemFor('suno') }, { role: 'user', content: R.messageFor(input) }],
      { once: true, timeout: 45000 });
  } catch (e) { return _fromOut(R.compose(input), 'as picked', 'the writer failed: ' + e.message); }
  const raw = String((a && a.raw) || '');
  if (!raw) return _fromOut(R.compose(input), 'as picked', a && a.unsure ? 'the writer did not answer' : 'no writer answered');
  const out = R.finish(raw, input);
  return _fromOut(out, out && out.by === 'writer' ? (a.by ? a.by.provider + '/' + a.by.model : 'writer') : 'as picked',
    out && out.by === 'writer' ? '' : 'the writer answered no style - the chips went as they are');
}

// What is sent: the request, with the simple mode's written style, title, excludes, knobs and length in it.
function _sendable(g) {
  const r = Object.assign({}, g.req);
  if (g.mode === 'simple' && g.written) {
    const w = g.written;
    Object.assign(r, { style: w.style, title: w.title, negative: w.negative, seconds: +w.duration || 0 });
    for (const k of ['styleWeight', 'weirdness', 'variety']) if (w[k] != null) r[k] = w[k];
  }
  return r;
}

// How long the fake's tones are: what was asked, or a length like the real thing's.
function _fakeLen(g) {
  const r = g.req || {};
  if (+r.seconds > 0) return +r.seconds;
  return g.kind === 'sound' ? 3 : 30;
}

// The first words of a press's row: the simple mode's writer, Video to Music's clip being made into a file, or nothing yet.
const _firstStage = (g) => (g.mode === 'simple' && !g.written ? 'writing the style'
  : g.mode === 'video' && g.req && g.req.clip ? 'preparing the clip' : 'starting');

// (phase V54, block 2) VIDEO TO MUSIC FROM A CLIP: the clip as it is seen made into a file (lib/merge-clips.js startClip - the
// export's graph, small; this computer's ffmpeg, nothing paid) in cache/v2m/, measured once more against ElevenLabs' limits.
// { path } - or { error } in words, or { gone } when the press was let go of meanwhile (the making stopped).
async function _prepareClip(g, kick) {
  const MC = require('./merge-clips');
  const dir = path.join(CACHE_DIR, 'v2m');
  const out = path.join(dir, g.id + '.mp4');
  // What an earlier making left behind (a file held when it was let go of, the app closed meanwhile): gone after a day.
  try {
    for (const f of fs.readdirSync(dir)) {
      const abs = path.join(dir, f);
      try { if (Date.now() - fs.statSync(abs).mtimeMs > 24 * 3600 * 1000) fs.rmSync(abs, { force: true }); } catch (e) { /* held */ }
    }
  } catch (e) { /* no folder yet */ }
  const s = MC.startClip({ key: g.req.clip.key, clipId: g.req.clip.clipId, out });
  if (s.error) return { error: s.error };
  let shown = -1;
  for (;;) {
    await new Promise(r => setTimeout(r, 400));
    const j = MC.get(s.job.id);
    if (!_ours(g.id, kick)) { MC.cancel(s.job.id); return { gone: true, path: out }; }
    if (!j) return { error: 'the clip was not made into a file', path: out };
    if (j.state === 'done') break;
    if (j.state !== 'running') return { error: 'the clip could not be made into a file: ' + (j.error || j.state), path: out };
    const p = Math.floor((+j.pct || 0) / 10) * 10;
    if (p > shown) { shown = p; _stage(g.id, 'preparing the clip · ' + p + '%', kick); }
  }
  let size = 0;
  try { size = fs.statSync(out).size; } catch (e) { size = 0; }
  if (!size) return { error: 'the clip came out empty', path: out };
  if (size > V2M_MAX_BYTES) return { error: 'the clip came out ' + _mb(size) + ' - Video to Music takes up to 200 MB', path: out };
  return { path: out };
}

// ── The asking, behind the press ────────────────────────────────────────────
async function run(id, kick) {
  let made = '';                 // (V54) a clip made into a file for Video to Music - gone once ElevenLabs has answered
  try {
    let g = get(id);
    if (!g || !_ours(id, kick)) return;
    // 1b. (phase V54) Video to Music from a clip: the clip made into a file first - free; a failure costs nothing.
    if (g.mode === 'video' && g.req.clip) {
      _stage(id, 'preparing the clip', kick);
      const r = await _prepareClip(g, kick);
      made = r.path || '';
      if (r.gone || !_ours(id, kick)) return;
      if (r.error) { _fail(id, r.error + ' - nothing was paid'); return; }
    }
    // 1. The simple mode's style, written once (a retry carries it).
    if (g.mode === 'simple' && !g.written) {
      _stage(id, 'writing the style', kick);
      const w = await _writeStyle(g.req);
      if (!_ours(id, kick)) return;
      const fell = w.fell || '';
      delete w.fell;
      g = _patch(id, { written: w, fell });
      _rowRequest(id);
    }
    // 2. The engine - the paid moment, written before the money.
    _stage(id, g.engine === 'eleven' ? 'ElevenLabs is making it' : 'asking Suno', kick);
    _patch(id, { asked: true, askedAt: new Date().toISOString() });
    if (FAKE.on()) {
      if (g.kind === 'lyrics') {
        if (!_ours(id, kick)) return;
        _patch(id, { taskId: 'fake:lyrics-' + Date.now().toString(36), provider: 'fake', stage: '' });
        setTimeout(() => {
          const now = get(id);
          if (!now || now.state !== 'pending') return;
          if (/\?fail\b/.test(now.said)) { _fail(id, 'the fake model refused (?fail in the idea)'); return; }
          _patch(id, { state: 'done', doneAt: new Date().toISOString(), lyrics: [1, 2].map(n => ({
            title: '[fake] ' + now.said.slice(0, 40) + ' ' + n,
            text: '[Verse]\n[fake] ' + now.said + '\nline two of variant ' + n + '\n\n[Chorus]\n[fake] la la la ' + n,
          })) });
        }, 5000);
        return;
      }
      const taskId = FAKE.task('a', { prompt: g.said, duration: _fakeLen(g), count: (g.engine === 'suno' && g.kind === 'music') ? 2 : 1 });
      _started(id, kick, taskId, 'fake');
      return;
    }
    if (g.engine === 'suno') {
      let taskId;
      try { taskId = await ENG.sunoCreate(_sendable(g)); }
      catch (e) { if (_ours(id, kick)) _fail(id, e.unsure ? _unsureWords(e) : e.message, !e.unsure && !!e.refused); return; }
      if (!_ours(id, kick)) { console.warn('[audio-gens] ' + id + ' was let go of while it was asked for - task ' + taskId + ' is not followed'); return; }
      _started(id, kick, taskId, 'kie');
      return;
    }
    // ElevenLabs: the answer is the file.
    let got;
    try { got = await ENG.eleven(_sendable(g), g.mode === 'video' ? (made || _videoAbs(g.req.video)) : ''); }
    catch (e) { if (_ours(id, kick)) _fail(id, e.unsure ? _unsureWords(e) : e.message, !e.unsure && !!e.refused); return; }
    fs.mkdirSync(MEDIA.work, { recursive: true });
    const name = (g.kind === 'sound' ? 'elsfx_' : 'elmusic_') + g.id + got.ext;
    const abs = path.join(MEDIA.work, name);
    fs.writeFileSync(abs + '.part', got.buf);
    fs.renameSync(abs + '.part', abs);
    if (!_ours(id, kick)) {
      // Let go of while ElevenLabs was making it: paid, and nobody wants it - the file goes.
      try { fs.rmSync(abs, { force: true }); } catch (e) { /* held */ }
      console.warn('[audio-gens] ' + id + ' was let go of while ElevenLabs made it - not filed');
      return;
    }
    _patch(id, { provider: 'elevenlabs', stage: 'filing it', landed: [{ path: '/media/work/' + name, title: '' }] });
    if (g.alertId) ALERTS.update(g.alertId, { stage: 'filing it' });
    JOBS.wake();
  } finally {
    _asking.delete(kick);
    if (made) { try { fs.rmSync(made, { force: true }); } catch (e) { /* held for a moment - the next clip's making sweeps it */ } }
  }
}

// A task number came back: the record holds it, the row follows it (lyrics are followed here).
function _started(id, kick, taskId, provider) {
  if (!_ours(id, kick)) return;
  const g = _patch(id, { taskId: String(taskId), provider, stage: '' });
  if (g.alertId) {
    ALERTS.update(g.alertId, { taskIds: [String(taskId)], stage: '' });
    _rowRequest(id);
    JOBS.wake();
  } else if (g.kind === 'lyrics') {
    _watchLyrics(id);
  }
}

// ── Following a task ────────────────────────────────────────────────────────
const _safe = (s) => String(s || '').replace(/[^A-Za-z0-9_-]+/g, '').slice(0, 60) || crypto.randomBytes(4).toString('hex');

// Each track downloaded ONCE into media/work/: asked again, the files already there are the answer. Written beside and
// renamed, so a download cut off half way never looks like a track.
async function _download(g, tracks) {
  fs.mkdirSync(MEDIA.work, { recursive: true });
  const out = [];
  for (let i = 0; i < tracks.length && i < 4; i++) {
    const name = (g.kind === 'sound' ? 'sunosfx_' : 'suno_') + _safe(g.taskId) + '_' + (i + 1) + '.mp3';
    const abs = path.join(MEDIA.work, name);
    if (!fs.existsSync(abs)) {
      const r = await axios({ url: tracks[i].url, method: 'GET', responseType: 'arraybuffer', timeout: 120000 });
      fs.writeFileSync(abs + '.part', Buffer.from(r.data));
      fs.renameSync(abs + '.part', abs);
    }
    out.push({ path: '/media/work/' + name, title: tracks[i].title || '', dur: tracks[i].dur || 0 });
  }
  return out;
}

// One look at a record's task: { state, stage?, error?, refused? } - `landed` written when its files are here. Throws when
// the engine did not answer (asked again next tick).
async function _look(g) {
  if (String(g.taskId).startsWith('fake:')) {
    const out = await FAKE.resolve(g.taskId, MEDIA.work, 'fake');
    if (out.state === 'success') {
      _patch(g.id, { landed: (out.audioPaths || []).map(p => ({ path: p, title: '' })) });
      return { state: 'success' };
    }
    return out;
  }
  const out = await ENG.sunoPoll(g.taskId, g.kind);
  if (out.state !== 'success') return out;
  const landed = await _download(g, out.tracks);
  _patch(g.id, { landed });
  return { state: 'success' };
}

// The Suno lyrics of a record, followed by the server (no row): every 4 s until they come, fail, or six minutes pass.
const _watching = new Set();
function _watchLyrics(id) {
  if (_watching.has(id)) return;
  _watching.add(id);
  (async () => {
    const started = Date.now();
    for (;;) {
      await new Promise(r => setTimeout(r, 4000));
      const g = get(id);
      if (!g || g.state !== 'pending') break;
      if (Date.now() - started > LYRICS_LIMIT_MS) { _fail(id, 'the lyrics did not come in ' + Math.round(LYRICS_LIMIT_MS / 60000) + ' minutes'); break; }
      let out;
      try { out = await ENG.sunoPoll(g.taskId, 'lyrics'); } catch (e) { continue; }
      if (out.state === 'success') { _patch(id, { state: 'done', stage: '', lyrics: out.lyrics, doneAt: new Date().toISOString() }); break; }
      if (out.state === 'failed') { _fail(id, out.error, out.refused); break; }
    }
  })().catch(e => console.warn('[audio-gens] lyrics', id, e.message)).finally(() => _watching.delete(id));
}

// ── Filing ──────────────────────────────────────────────────────────────────
async function _file(id) {
  const g = get(id);
  if (!g) throw new Error('the record of this generation is gone');
  if (g.state === 'done' && (g.results || []).length) return _resultOf(g);
  const landed = (g.landed || []).filter(l => l && l.path);
  if (!landed.length) throw new Error('nothing came back to file');
  const { toDisk } = require('./media');
  const probe = require('./media-probe').probe;
  const lens = [];
  // And each one's waveform (lib/audio-wave.js), so its tile and the sound window's result row draw it at once.
  const waves = [];
  for (const l of landed) {
    let d = +l.dur || 0;
    try { d = (await probe(toDisk(l.path))).duration || d; } catch (e) { /* the engine's own number */ }
    lens.push(Math.round((d || 0) * 100) / 100);
    let w = [];
    try { w = await require('./audio-wave').peaks(toDisk(l.path)); } catch (e) { w = []; }
    waves.push(w);
  }
  const results = [];
  if (g.kind === 'sound') {
    const SND = require('./sounds-store');
    for (let i = 0; i < landed.length; i++) {
      const name = (String(g.said || 'sound').slice(0, 70) + (landed.length > 1 ? ' · ' + (i + 1) : '')).trim();
      const { item } = await SND.add(landed[i].path, {
        name, categoryLabel: 'Generated', source: 'gen',
        meta: { engine: g.engine, mode: g.mode, prompt: String(g.said || '').slice(0, 500), gen: g.id },
      });
      if (item && waves[i] && waves[i].length) require('./audio-cut').setWave(item.id, waves[i]);
      if (item) results.push({ kind: 'sounds', id: item.id, path: item.audioPath, title: item.name, dur: item.duration || lens[i] || 0 });
    }
  } else {
    // ── From here to the write: one tick. ──
    const MUSIC = require('./music-store');
    const names = require('./names');
    fs.mkdirSync(MEDIA.audio, { recursive: true });
    let taken = [];
    try { taken = fs.readdirSync(MEDIA.audio); } catch (e) { taken = []; }
    let base = g.written ? g.written.title : (g.req.title || String(g.said || '').split(/\s+/).slice(0, 6).join(' ') || 'Music');
    // (phase V54, the owner's (зв5)) Video to Music's track is named after its video: "music for <the clip>".
    if (g.mode === 'video') base = 'music for ' + _videoName(g.req);
    // (V34.F) A mood's presses shared the preset's title - the press's number told them apart ("Calm Ground 2 · 1"). (phase
    // V68) A style's title names it already ("Calm Ground · Felt Piano", lib/audio-writer-rules.js fromPreset): left as it is.
    if (g.req.preset && +g.req.n > 0 && !(g.written && g.written.named)) base = String(base || 'Music') + ' ' + (+g.req.n + 1);
    const title = String(base || 'Music').slice(0, 80);
    const gen = g.engine === 'suno' ? String(g.taskId).replace(/^fake:/, '') : g.id;
    const style = g.written ? g.written.style : (g.req.style || g.req.prompt || g.req.description || '');
    const lib = MUSIC.read();
    const now = new Date().toISOString();
    const add = [];
    // (phase V59, (мг4а)) Asked into a folder under Music that is still there: the files go straight into it (one move each
    // from media/work/, nothing points at them yet) and the records name it; else Music's root, as before.
    const cat = g.into && g.into !== MUSIC.HIGHLIGHTS && !(g.req.preset && MUSIC.isMood(g.req.preset)) ? require('./library-cats').find('music', g.into) : null;
    for (let i = 0; i < landed.length; i++) {
      const from = toDisk(landed[i].path);
      let audioPath;
      if (cat && from && fs.existsSync(from)) {
        audioPath = require('./shelf-files').placeNew(landed[i].path, 'music', cat.id, cat.label);
      } else {
        const name = names.uniqueFile(path.basename(from), taken);
        taken.push(name);
        const dest = path.join(MEDIA.audio, name);
        if (from && fs.existsSync(from)) fs.renameSync(from, dest);
        audioPath = '/media/audio/' + name;
      }
      const rec = {
        id: (g.engine === 'suno' ? 'suno_' : 'el_') + _safe(gen) + '_' + (i + 1),
        title: landed.length > 1 ? title + ' · ' + (i + 1) : title,
        audioPath,
        style: String(style || '').slice(0, 1000), createdAt: now, gen, variant: i + 1, duration: lens[i] || 0,
        source: g.engine === 'suno' ? 'suno' : 'elevenlabs',
      };
      if (waves[i] && waves[i].length) rec.wave = waves[i];
      // (phase V59) In that folder: the record names it, as a track put there by hand does (lib/music-store.js add).
      if (cat && audioPath.startsWith(require('./library-cats').kindUrl('music') + cat.folder + '/')) { rec.categoryId = cat.id; rec.categoryLabel = cat.label; }
      if (g.req.lyrics) rec.lyrics = String(g.req.lyrics).slice(0, 5000);
      // (V34.F) Made by a highlights mood: into Music -> highlights -> that mood (lib/music-store.js, its rule).
      if (g.req.preset && MUSIC.isMood(g.req.preset)) Object.assign(rec, { folder: MUSIC.HIGHLIGHTS, mood: g.req.preset, moodMade: g.req.preset });
      // (phase V60.2, (ми6а)) Asked into highlights itself (Custom from a mood folder): its root - no mood, made by no preset.
      else if (g.into === MUSIC.HIGHLIGHTS) rec.folder = MUSIC.HIGHLIGHTS;
      if (!lib.some(x => x && (x.id === rec.id || x.audioPath === rec.audioPath))) add.push(rec);
      results.push({ kind: 'music', id: rec.id, path: rec.audioPath, title: rec.title, dur: rec.duration });
    }
    if (add.length) { lib.unshift(...add); MUSIC.write(lib); }
  }
  if (!results.length) throw new Error('nothing could be filed');
  // (phase V54, (зв5)) Made from a clip: the track lies under it on the timeline too - laid by the server, the page open or not.
  const fields = {};
  if (g.mode === 'video' && g.req.clip && results[0]) {
    const lay = _layUnder(g, results[0]);
    if (lay.lane) fields.laid = { key: g.req.clip.key, lane: lay.lane, at: lay.at };
    else if (!lay.done) fields.notLaid = String(lay.why || 'it was not laid');
  }
  const done = _patch(id, { state: 'done', stage: '', results, landed: [], doneAt: new Date().toISOString(), ...fields });
  return _resultOf(done);
}

// (phase V54, the owner's (зв5), (зв6)) THE TRACK UNDER ITS CLIP: from the clip's start - where it is NOW -, at the volume of a
// bed (0.5). (phase V77, the owner's (тч14)) ON A LANE OF ITS OWN: a new lane at the far end of the audio block every time; with
// four sound lanes already (the limit) on one below main audio free under the whole track, else the track is only in Music
// and the record says why. A highlights fragment's mood music on its "audio 2" is not touched. In ONE tick on the
// timeline as it is now (merge-store update); the clip carries `laidBy` so a page open on it takes it as the server's own lay
// (js/merge-v3/store.js) - its next save drops the mark (lib/timeline-shape.js keeps no such field). Laid once: a record
// filed again finds its clip there. -> { lane, at } | { why } | { done }
function _layUnder(g, res) {
  const c = g.req.clip || {};
  const id = 'v2m' + g.id;
  const r2 = (v) => Math.round((+v || 0) * 100) / 100;
  let out = null;
  const stored = require('./merge-store').update(c.key, (tl) => {
    const tracks = Array.isArray(tl.tracks) ? tl.tracks : null;
    if (!tracks) { out = { why: 'its timeline could not be read' }; return false; }
    if (tracks.some((t) => (t.clips || []).some((x) => x && x.id === id))) { out = { done: true }; return false; }
    let clip = null;
    for (const t of tracks) if (t.kind === 'video' && !clip) clip = (t.clips || []).find((x) => x && x.id === c.clipId) || null;
    if (!clip) { out = { why: 'the clip is not on the timeline any more - the track is in Music' }; return false; }
    const at = r2(clip.start);
    const len = r2(+res.dur > 0 ? res.dur : clip.dur);
    const auds = tracks.filter((t) => t && t.kind === 'audio');
    const free = (t) => !(t.clips || []).some((x) => x && (+x.start || 0) < at + len - 0.005 && (+x.start || 0) + (+x.dur || 0) > at + 0.005);
    let lane = auds.length >= 4 ? (auds.slice(1).find(free) || null) : null;
    if (!lane) {
      if (auds.length >= 4) { out = { why: 'no audio lane is free under the clip - four is the limit; the track is in Music' }; return false; }
      const newId = () => { let n = tracks.length + 1; while (tracks.some((t) => t && t.id === 'a' + n)) n++; return 'a' + n; };
      const plain = (name, main) => ({ id: newId(), kind: 'audio', name, linkId: null, main, volume: null, speed: null, clips: [] });
      // The music NEVER becomes main audio (the planning session's check): the first sound lane is main audio by its place - the
      // page names and marks lanes so (timeline-b.js _renumber), cut silence and the captions take their sound from it. A
      // timeline with no sound lane at all gets an empty main audio first - linked to main video when that has no sound lane
      // of its own, as a new timeline is made (lib/timeline-shape.js emptyBlank) - and the music goes on "audio 2" after it.
      if (!auds.length) {
        const words = tracks.findIndex((t) => t && (t.kind === 'subs' || t.kind === 'text'));
        const main = plain('main audio', true);
        tracks.splice(words < 0 ? tracks.length : words, 0, main);
        const vids = tracks.filter((t) => t && t.kind === 'video');
        const mv = vids.length ? vids[vids.length - 1] : null;
        if (mv && !(mv.linkId && tracks.some((t) => t && t.id === mv.linkId))) { mv.linkId = main.id; main.linkId = mv.id; }
        auds.push(main);
      }
      lane = plain('audio ' + (auds.length + 1), false);
      // At the far end of the audio block.
      tracks.splice(tracks.map((t) => t && t.kind).lastIndexOf('audio') + 1, 0, lane);
    }
    lane.clips = (lane.clips || []).concat([{
      id, src: res.path, thumb: null, name: String(res.title || 'music').slice(0, 200), libId: res.id || null,
      start: at, dur: len, srcDur: len, trimIn: 0, trimOut: 0, speed: 1, reversed: false,
      volume: 0.5, bed: true, pairId: null, fit: null, cropAlign: null, laidBy: 'v2m',
    }]).sort((a, b) => (+a.start || 0) - (+b.start || 0));
    out = { lane: lane.name, at };
    return true;
  });
  if (stored === null) return { why: 'its project is not there any more - the track is in Music' };
  return out || { why: 'it was not laid' };
}
// The row's result. (phase V59) `ids` - the tracks' (or sounds') ids on the Library's shelf: a row of the Library's music
// window leads to its folder with them outlined (js/alerts-bell.js _hrefOf).
function _resultOf(g) {
  const r = g.results || [];
  return { path: r[0] ? r[0].path : '', media: 'audio', title: r[0] ? r[0].title : '', variants: r.map(x => x.path), ids: r.map(x => x.id) };
}

// ── The journal's type ──────────────────────────────────────────────────────
// 'music' - the name Merge's generator gave it in phase A7.
JOBS.register('music', {
  timeoutMs: ROW_LIMIT_MS,
  poll: async (row) => {
    const p = (row.job || {}).params || {};
    const g = get(p.genId || '');
    if (!g) return { state: 'failed', error: 'the record of this generation is gone' };
    if (g.state === 'done') return { state: 'success' };
    if (g.state === 'failed') return { state: 'failed', error: g.error || 'it did not come', refused: !!g.refused };
    if ((g.landed || []).length) return { state: 'success' };
    if (!g.taskId) {
      if (p.kick && _asking.has(p.kick)) return { state: 'pending' };
      const why = g.asked ? MAYBE_PAID : NOT_ASKED;
      _patch(g.id, { state: 'failed', stage: '', error: why, doneAt: new Date().toISOString() });
      return { state: 'failed', error: why };
    }
    const out = await _look(g);
    if (out.state === 'failed') {
      // The runner's own reading of a failure (lib/gen-jobs.js): a type that does not say is read by its words.
      out.refused = out.refused !== undefined ? !!out.refused : REFUSAL.isRefusal(out.error);
      _patch(g.id, { state: 'failed', stage: '', error: String(out.error || '').slice(0, 600), refused: out.refused, doneAt: new Date().toISOString() });
    }
    return out;
  },
  file: async (row) => _file((((row.job || {}).params || {}).genId) || ''),
  busy: (row) => _asking.has((((row.job || {}).params || {}).kick) || ''),
  cancel: (row) => {
    const g = get((((row.job || {}).params || {}).genId) || '');
    if (g && g.state === 'pending') _patch(g.id, { state: 'failed', cancelled: true, stage: '', error: 'you stopped waiting for it', doneAt: new Date().toISOString() });
  },
  // Asked for again: a new record on a new kick, the same row; the asking goes on behind it.
  submit: async (request, row) => {
    const r = request || {};
    // The project it was made for goes with it - Merge's "this project · N" is the project's (V34.E).
    const was = get((((row || {}).job || {}).params || {}).genId || '');
    // ...and so does the folder under Music it was asked into (phase V59).
    const g = await _make(r.mode, r, (row && row.where) || null,
      { alertId: row && row.id, written: r.written, project: was ? was.project : '', into: was ? was.into : '' });
    const kick = _newKick();
    _asking.add(kick);
    return {
      params: { genId: g.id, kick, request: _request(g) },
      stage: _firstStage(g),
      later: () => run(g.id, kick),
    };
  },
});

// A RECORD ENDS WITH ITS ROW: a row that timed out, or was let go of, takes its pending record with it.
ALERTS.onEnd((row) => {
  if (!row || row.state !== 'failed' || ((row.job || {}).type) !== 'music') return;
  const g = get((((row.job || {}).params || {}).genId) || '');
  if (!g || g.state !== 'pending') return;
  _patch(g.id, { state: 'failed', stage: '', error: String(row.error || 'it did not come').slice(0, 600), cancelled: !!row.cancelled,
    doneAt: new Date().toISOString() });
});

/** At start: lyrics still being followed are followed again; one never asked for fails in words. Rows are the runner's. */
// Only the records of an earlier run: the server calls this a while after it starts, and a press made since is this
// process's own.
const BOOT_AT = Date.now();
function resume() {
  let n = 0;
  for (const g of _read()) {
    if (g.state !== 'pending' || g.kind !== 'lyrics' || !(Date.parse(g.at) < BOOT_AT)) continue;
    if (g.taskId && !String(g.taskId).startsWith('fake:')) { _watchLyrics(g.id); n++; }
    else {
      const why = g.taskId ? 'the app was closed before the lyrics came - try again' : (g.asked ? MAYBE_PAID : NOT_ASKED);
      _patch(g.id, { state: 'failed', stage: '', error: why, doneAt: new Date().toISOString() });
    }
  }
  return n;
}

/** Take a finished record off the history - never its files (they are on the shelves). */
function remove(id) {
  const l = _read();
  const g = l.find(r => r.id === String(id || ''));
  if (!g) return { code: 404, error: 'not found' };
  if (g.state === 'pending') return { code: 409, error: 'it is still being made' };
  _write(l.filter(r => r !== g));
  return { code: 200 };
}

module.exports = { FILE, create, get, list, remove, resume };
