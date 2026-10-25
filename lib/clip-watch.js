'use strict';

// ════════════════════════════════════════════════════════════════════════════
// AN AGENT WATCHES A CLIP WHOLE (phase V48, the owner 2026-10-25: "нам нужно чтобы агент просматривал видео полностью
// и описывал его. кто что в кадре делает. потому что нам нужно затем это заменять другим персонажем").
//
// Before the video chat's writer writes for Seedance, every clip attached - the part of it that goes - is WATCHED, its
// sound with it, by a model of the agents' ladder that takes video (lib/agents.js `watches`; Claude takes none and is
// stepped over), and described second by second: who is in it, what each one does and says and when, the camera, the
// place and the light, the sounds. The writer reads that instead of guessing from three frames.
//
// - The part is cut and sent as the video model would get it (lib/video-prep.js forWatch - its long side at 720 px, its
//   sound kept), by its public link on R2.
// - The answer may be long: its ceiling is 32 000 tokens and the wait five minutes - the owner (кл2): "лимиты сделай
//   побольше на ответ, чтобы поместился весь ответ". An answer cut at its ceiling is a failure, not a text; PAID ONCE
//   (`once`): an answer that did not come in time, or was cut, is not asked again of the next step.
// - A model that answered without seeing the clip is caught by the length it says the clip has (`LENGTH:`): far from the
//   part's own, the answer is not taken and the next step is asked.
// - WATCHED ONCE (кл6): the description is kept in cache/clip-watch/ by the FILE (its print - the same clip wherever it
//   was moved) and the part; the same part is never watched or paid for again, another part is described anew. The
//   fake aggregator keeps its own (`fake` in the key): a fake description never reaches a real message.
// - No model answered (кл4): `{ fail }` in words - the writer then sees three frames, as before, and the message says
//   "clip not watched".
// It is a text an agent writes, as the writer's prompt is - no Alerts row; the message it is for is its record.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { CACHE_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { toDiskExisting } = require('./media');
const AGENTS = require('./agents');
const FAKE = require('./fake-agg');

const DIR = path.join(CACHE_DIR, 'clip-watch');
// The way it is asked: a new wording is a new key - an old description is not taken for what the new one asks.
const VERSION = 'w1';
const MAX_TOKENS = 32000;
const TIMEOUT = 300000;
// How closely it looks: Gemini samples 1 frame a second by itself - a gesture is shorter than that.
const FPS = 2;
const TEXT_MAX = 40000;

const RULES = [
  'You watch ONE video clip whole, with its sound, and describe it for a prompt writer who will have a video model make it again - most often with someone in it replaced by another character. The writer does not see the clip: your description is all it knows of it, so be exact about who is who and what happens when.',
  'Times are seconds from the start of the clip, with one decimal: 0.0, 2.4.',
  'Write in English, in plain text, in exactly these parts and in this order:',
  'LENGTH: how long the clip lasts, in seconds.',
  'PEOPLE: every person in the clip, one line each, named by a letter (A, B, ...): what they look like in a few words (sex, age, hair, build), what they wear, where they are in the frame (left, right, middle, near, far) and when they are seen. An animal, a product or a vehicle that matters to what happens goes here too, by a letter, said as what it is.',
  'PLACE AND LIGHT: where it is, what is around, the light and the time of day.',
  'CAMERA: the shot size and the angle, how the camera moves, and every cut with its time.',
  'TIMELINE: the clip beat by beat, one line per beat, each line "from-to s: ...": what each person does - the body, the hands, the head and the eyes, what they hold or touch, where they move -, what they say - the words exactly, in double quotes, said in English if they are in another language, and who says them -, and what else happens in the frame. Beats short enough that no action is lost: a gesture, a turn, a step is a beat of its own.',
  'SOUND: the music, the effects and the ambience, with their times; the speech is in the timeline.',
  'Only what is in the clip: no guesses about a story, no mood words in place of what is seen, no markdown.',
].join('\n');

const _key = (print, from, to) => crypto.createHash('sha1')
  .update([VERSION, print, (+from || 0).toFixed(2), (+to || 0).toFixed(2), FAKE.on() ? 'fake' : ''].join('|')).digest('hex');
const _file = (key) => path.join(DIR, key + '.json');

function _cached(key) {
  try {
    const j = JSON.parse(fs.readFileSync(_file(key), 'utf8'));
    return j && typeof j.text === 'string' && j.text.trim() ? j : null;
  } catch (e) { return null; }
}
function _store(key, rec) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    writeFileAtomic(_file(key), JSON.stringify(rec, null, 2));
  } catch (e) { console.warn('[clip-watch] not kept:', e.message); }
}

// What the person reads of the model that watched: its name and its aggregator.
function _byOf(step) {
  const p = (AGENTS.PROVIDERS || []).find(x => x.id === (step && step.provider));
  const m = p ? p.models.find(x => x.id === step.model) : null;
  return m ? m.label + ' · ' + p.label : (step ? step.provider + '/' + step.model : '');
}

// The answer as the writer and the person read it: no fences, no trailing blank, within the card's field.
const _clean = (raw) => String(raw || '').replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').replace(/\r\n/g, '\n').trim().slice(0, TEXT_MAX);

// '' when the answer will do. A model that never saw the clip cannot know how long it is - and one that got no clip at all
// answers without the parts (kie's Gemini, a clip it dropped: "please upload the video clip", V48's probe).
function _check(raw, secs) {
  const t = _clean(raw);
  if (t.length < 60) return 'the description is empty';
  const m = /LENGTH:\s*(\d+(?:\.\d+)?)/i.exec(t);
  if (!m || !/TIMELINE:/i.test(t)) return 'it answered without describing the clip - no length or timeline';
  if (secs > 0) {
    const said = +m[1];
    if (Math.abs(said - secs) > Math.max(1.5, secs * 0.3)) return 'it did not see the clip - it says ' + said + ' s, the clip is ' + secs.toFixed(1) + ' s';
  }
  return '';
}

// Why no model watched it, in a few words for the message (the steps' own words go to the server's log).
function _whyNot(r) {
  if (r.cut) return 'the description was cut off at its length limit';
  if (r.unsure) return 'no answer in time - not asked again of the next model, it may have been paid for';
  const tried = r.tried || [];
  if (tried.length && tried.every(t => /skipped/.test(t))) {
    return tried.some(t => /does not watch video/.test(t)) && !tried.some(t => /skipped, (no key|its key)/.test(t))
      ? 'no model of the agents\' ladder watches video - Admin → AI settings'
      : 'no model that watches video can be asked now (Admin → API keys, AI settings)';
  }
  return 'every model that watches video refused it';
}

/**
 * Watch the part [in, out] of a clip of the library: { text, by, cached, secs } or { fail } in words. `o.signal` stops
 * it; `o.fakeText` - the message's words, for the fake aggregator's `?nowatch` / `?slow`.
 */
async function describe(clip, o) {
  const opts = o || {};
  const c = clip || {};
  const abs = c.path ? toDiskExisting(String(c.path).split('?')[0]) : null;
  if (!abs || !fs.existsSync(abs)) return { fail: 'the clip is not in the library any more' };
  const from = Math.max(0, +c.in || 0);
  const to = +c.out > from ? +c.out : 0;
  const print = require('./sources-store').printOf(abs);
  const key = print ? _key(print, from, to) : '';
  const hit = key ? _cached(key) : null;
  if (hit) return { text: hit.text, by: hit.by || '', cached: true, secs: +hit.secs || 0 };

  if (FAKE.on()) {
    const t = String(opts.fakeText || '');
    await new Promise(r => setTimeout(r, /\?slow\b/.test(t) ? 9000 : 2500));
    if (/\?nowatch\b/.test(t)) return { fail: 'Fake watcher: no model watched it (?nowatch in the message)' };
    const secs = to > from ? to - from : 5;
    const text = FAKE.watch(secs);
    if (key) _store(key, { v: VERSION, text, by: 'fake watcher', secs, path: c.path, in: from, out: to, at: new Date().toISOString(), fake: true });
    return { text, by: 'fake watcher', cached: false, secs };
  }

  // Nobody on the ladder to ask: said before anything is cut or uploaded.
  if (!AGENTS.ladder().some(AGENTS.watches)) return { fail: 'no model of the agents\' ladder watches video - Admin → AI settings' };
  let prep;
  try { prep = await require('./video-prep').forWatch(abs, { from, to, signal: opts.signal }); }
  catch (e) { return { fail: 'the clip could not be prepared to be watched - ' + e.message }; }
  let url;
  try { url = await require('./helpers').uploadToPublicHost(prep.file, { ext: 'mp4', verify: true }); }
  catch (e) { return { fail: 'the clip could not be put on R2 - ' + String(e.message || e).slice(0, 200) }; }
  finally { prep.drop(); }
  const secs = prep.secs;
  let r;
  try {
    r = await AGENTS.ask([{ role: 'system', content: RULES }, { role: 'user', content: 'Describe this clip.' }], {
      videos: [url], videoFps: FPS, maxTokens: MAX_TOKENS, timeout: TIMEOUT, effort: 'medium', once: true, signal: opts.signal,
      accept: (raw) => _check(raw, secs),
    });
  } catch (e) {
    return { fail: e && e.cancelled ? 'stopped' : 'the watching broke off - ' + String(e.message || e).slice(0, 200) };
  }
  if (!r.raw) {
    console.warn('[clip-watch] not watched:', (r.tried || []).join(' | '));
    return { fail: _whyNot(r) };
  }
  const text = _clean(r.raw);
  const by = _byOf(r.by);
  if (key) _store(key, { v: VERSION, text, by, secs, path: c.path, in: from, out: to, at: new Date().toISOString() });
  return { text, by, cached: false, secs };
}

module.exports = { describe, RULES, VERSION, MAX_TOKENS, TIMEOUT, FPS, DIR, _check };
