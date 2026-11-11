'use strict';

/* fx-auto.js - a film's clip effects CHOSEN AND PLACED BY THE AGENT (phase V90, the owner 2026-11-11: "типа будет сначала анализ
   агентом: оценка текста, длины фрагмента и дать список эффектов которые у нас есть ... агент оценивает какие эффекты подойдут для
   конкретного фрагмента. расставляет все что нужно на видео в нужные тайминги"; docs/local-app/plan/, "Фаза V90", "Подфаза 5 — V90:
   подробный план", (аэ1)-(аэ15)).

   ONE CALL OF THE AGENTS' LADDER a film (lib/llm-json.js callLadder - paid once, effort medium, cancellable): the rules and the
   effects the app has, every one with its key, name, group, line (`about`), its length and what it needs (effects.js EFFECTS, minus
   public/js/fx/auto.js SKIP), the two SHEETS of their tiles with the keys under them (public/fx-tiles/agent-1.jpg, agent-2.jpg - made
   by tools/fx-sheets.js; by R2 link, else the bytes), and the film as public/js/fx/auto.js briefOf tells it. Its answer is kept to the
   program's rules by auto.js checkAnswer - the agent proposes, the program decides.
   WHO CALLS: POST /api/fx/auto (routes/fx-auto.js) for the page's "Auto effects" - a clip, several, the ticked highlights fragments -
   which lays the answer itself (one undo step, the faces found by the page); lib/highlights-job.js at a fragment's cut, which lays
   it with `layInto` (the face's path by the server, auto.js facePathOf). No Alerts row of its own ((аэ7); section 9: a call of seconds,
   not a picture, a video or music) - at the cut it is a step of the highlights row.
   THE FAKE AGGREGATOR (lib/fake-agg.js fxAuto) answers on a stand: a set made from the brief, with some the rules must throw out. */

const fs = require('fs');
const path = require('path');
const { PUBLIC_DIR } = require('./config');
const FAKE = require('./fake-agg');
const { toDiskExisting } = require('./media');

const A = require('../public/js/fx/auto.js');
const E = require('../public/js/fx/effects.js');
const P = require('../public/js/fx/params.js');

const EFFORT = 'medium';
const SHEETS_DIR = path.join(PUBLIC_DIR, 'fx-tiles');
const PHRASES_MAX = 60000;     // characters of what is said, at most (a film of an hour - its first part)
const r1 = (x) => (Math.round((+x || 0) * 10) / 10).toFixed(1);

// ── The sheets ──────────────────────────────────────────────────────────────
function _sheets() {
  let idx = null;
  try { idx = JSON.parse(fs.readFileSync(path.join(SHEETS_DIR, 'agent-sheets.json'), 'utf8')); } catch (e) { idx = null; }
  return ((idx && idx.sheets) || []).map((s, i) => ({ n: i + 1, abs: path.join(SHEETS_DIR, String(s.file || '')), keys: (s.keys || []).map(String) }))
    .filter((s) => s.keys.length && fs.existsSync(s.abs));
}
/** The sheets as the ladder takes them: an R2 link a sheet (uploaded once a run of the app - helpers.js keeps it), else its bytes. */
async function _images(sheets) {
  if (FAKE.on()) return [];
  const R2 = require('./r2');
  const out = [];
  for (const s of sheets) {
    const buf = fs.readFileSync(s.abs);
    let url = '';
    if (R2.isConfigured()) {
      try { url = await require('./helpers').uploadToPublicHost(buf, { ext: 'jpg' }); } catch (e) { url = ''; console.warn('[fx-auto] a sheet not on R2: ' + e.message); }
    }
    out.push(url || 'data:image/jpeg;base64,' + buf.toString('base64'));
  }
  return out;
}

// ── What it is told ─────────────────────────────────────────────────────────
const SYSTEM = [
  'You are the editor of short vertical videos (TikTok, Reels, Shorts). You choose the EFFECTS of one film and the seconds they go at,',
  'from the app\'s own list below - nothing else exists, and an effect is named by its KEY.',
  '',
  'You get: the film\'s length; what is said in it, phrase by phrase, with seconds; its on-screen text; its key lines (punchlines,',
  'reveals, numbers - the camera punches in there); where a face is on the screen; the clips you may put effects on, as seconds of',
  'the film; how many effects; and two contact sheets of the effects - each tile one frame of an effect, its KEY under it.',
  '',
  'HOW TO CHOOSE',
  '1. Effects serve the words. Put one where something happens: the hook in the first two seconds, a reveal, a number, a punchline,',
  '   a list, a turn in the story, the end. Not on filler.',
  '2. Match the effect to the moment: a zoom or a glitch on a hit; Black & white or Fade to black on a dark turn; a checklist when',
  '   things are listed; Growth chart when a number grows; Chat when someone asks an AI or a bot; Magazine cover or Headline storm for',
  '   fame, a claim or news; Sparkle or Rainbow glow for joy or beauty; Phone app or Phone when social media or a phone is talked about;',
  '   Split, Film strip or Details to show many things at once; the Behind effects for a big personal moment.',
  '3. HOW MANY: a number N - give exactly N (fewer only when the film has no room for them). "auto" - a hook at the start, then about',
  '   one on each key line or strong moment, never more often than once every 4-6 seconds.',
  '4. "at" is the second of the FILM the effect starts at, inside one of the clips you may use. "len" is its length in seconds: a',
  '   MOMENT effect has its own length (0 keeps it, or give one within its range); an effect that GOES ON runs as long as you give it',
  '   (1 s at least; 0 - to the end of its clip) - keep those short, 1.5-4 s, unless a calm film wants one mood throughout.',
  '5. Effects that "need a face" only where a face is on the screen. Effects that "cut the person out" - ONE at most in the whole',
  '   film, counting those already there. Two moments must not overlap, nor lie over a moment already there. You may use an effect',
  '   more than once.',
  '6. CARDS WITH WORDS (effects with "words:"): write every field - short (a line of 1-4 words, a title of up to 3, a request of up',
  '   to 12), in the language of the film, from what is said at that moment; never copy the examples. growthchart "number": digits only',
  '   (the growth in percent).',
  '7. List them by importance - the most important first: the app keeps the first ones that fit.',
].join('\n');

const SCHEMA = {
  type: 'object', required: ['effects'],
  properties: {
    effects: {
      type: 'array', description: 'The effects, the most important first.',
      items: {
        type: 'object', required: ['k', 'at'],
        properties: {
          k: { type: 'string', description: 'the effect\'s key' },
          at: { type: 'number', description: 'the second of the film it starts at' },
          len: { type: 'number', description: 'its length in seconds; 0 - its own (a moment) or to its clip\'s end (one that goes on)' },
          txt: { description: 'a card\'s words by field key, e.g. {"i1": "...", "i2": "..."} - only for effects with words' },
          why: { type: 'string', description: 'a few words: why here' },
        },
      },
    },
    note: { type: 'string', description: 'one line about the film, optional' },
  },
};

/** One line an effect: key - name [group; its length; what it needs] line. words: its fields. */
function _effectLine(k, sheetOf) {
  const d = E.effectOf(k);
  const [lo, hi] = P.lengthRange(k);
  const len = d.kind === 'intro'
    ? (d.hold != null ? 'a moment of ' + r1(d.dur) + ' s, stands longer if given' : 'a moment of ' + r1(d.dur) + ' s (' + r1(lo) + '-' + r1(hi) + ')')
    : 'goes on';
  const needs = [d.face ? 'needs a face' : '', d.person ? 'cuts the person out' : ''].filter(Boolean).join(', ');
  const words = d.texts ? ' words: ' + d.texts.map(([key, label, def]) => key + ' (' + label + (def ? ', e.g. "' + def + '"' : '') + ')').join(', ') + '.' : '';
  const sheet = sheetOf.get(k);
  return '- ' + k + ' - ' + d.name + ' [' + d.group + '; ' + len + (needs ? '; ' + needs : '') + (sheet ? '; sheet ' + sheet : '') + '] '
    + d.about + words;
}

/** The user's message: the film as the brief tells it, the effects, the sheets. */
function userOf(brief, sheets) {
  const sheetOf = new Map();
  for (const s of sheets) for (const k of s.keys) sheetOf.set(k, s.n);
  const span = (x) => r1(x.a) + '-' + r1(x.b);
  const L = [];
  L.push('FILM: ' + r1(brief.length) + ' s.' + (brief.kind ? ' Kind: ' + brief.kind + '.' : '') + (brief.title ? ' Title: "' + brief.title + '".' : '')
    + (brief.language ? ' Language of its words: ' + brief.language + '.' : ''));
  L.push('CLIPS YOU MAY USE (seconds of the film): ' + brief.targets.map((t) => span(t) + (t.main ? '' : ' (an insert)')).join(', '));
  L.push('WHERE A FACE IS ON THE SCREEN: ' + (brief.faces.length ? brief.faces.map((f) => r1(f[0]) + '-' + r1(f[1])).join(', ')
    : 'nowhere known - do not use effects that need a face'));
  if (brief.keys.length) L.push('KEY LINES: ' + brief.keys.map(span).join(', '));
  if ((brief.existing || []).length) {
    L.push('EFFECTS ALREADY THERE (the person\'s own - they stay; do not lay a moment over them): '
      + brief.existing.map((x) => x.k + ' ' + span(x)).join(', '));
  }
  if (brief.lines.length) L.push('ON-SCREEN TEXT:\n' + brief.lines.map((x) => '[' + span(x) + '] ' + x.text).join('\n'));
  if (brief.noWords) L.push('WHAT IS SAID: nothing heard - lay them by the length and the clips alone.');
  else {
    let said = '';
    for (const p of brief.phrases) {
      const line = '[' + span(p) + '] ' + p.text + '\n';
      if (said.length + line.length > PHRASES_MAX) { said += '[the rest is not shown]\n'; break; }
      said += line;
    }
    L.push('WHAT IS SAID:\n' + said.trimEnd());
  }
  L.push('HOW MANY: ' + (brief.count === 'auto' ? 'auto (at most ' + brief.cap + ')' : String(brief.count)));
  L.push('THE EFFECTS:\n' + A.AGENT_KEYS.map((k) => _effectLine(k, sheetOf)).join('\n'));
  if (sheets.length) L.push('THE PICTURES: ' + sheets.map((s) => 'sheet ' + s.n + ' - ' + s.keys.length + ' effects').join('; ') + ', in that order.');
  return L.join('\n\n');
}

// ── The faces of the clips ──────────────────────────────────────────────────
const FILM_RE = /\.(mp4|mov|webm|m4v|mkv)$/i;
/**
 * The faces records of the clips `ids` of `tl` whose film is counted: kept ones at once; with `count` the app's hidden window counts
 * the rest (lib/faces.js - 1-2 s a minute of film; none when there is no window). -> { <clip id>: record }
 */
async function facesOf(tl, ids, { count = true, signal } = {}) {
  const FACES = require('./faces');
  const want = new Set((ids || []).map(String));
  const out = {};
  for (const t of (tl && tl.tracks) || []) {
    if (!t || t.kind !== 'video') continue;
    for (const c of t.clips || []) {
      if (!c || !want.has(String(c.id)) || !FILM_RE.test(String(c.src || '').split('?')[0])) continue;
      const abs = toDiskExisting(String(c.src).split('?')[0]);
      if (!abs) continue;
      let rec = FACES.cached(abs);
      if (!rec && count && FACES.workerSeen()) {
        try { rec = await FACES.find(abs, { signal }); } catch (e) { rec = null; }
      }
      if (rec) out[String(c.id)] = rec;
    }
  }
  return out;
}

// ── The call ────────────────────────────────────────────────────────────────
/**
 * The agent's effects for the clips `ids` of timeline `tl`, kept to the rules: { byClip, placed, dropped, noWords, count, by }.
 * `o`: { count, kind, title, language, faces (records by clip id - else found here), signal }. Throws in words when it cannot.
 */
async function choose(tl, ids, o = {}) {
  if (!tl || !Array.isArray(tl.tracks)) throw Object.assign(new Error('no timeline'), { status: 400 });
  const faces = o.faces || await facesOf(tl, ids, { signal: o.signal });
  const brief = A.briefOf(tl, ids, { ...o, faces });
  if (!brief.targets.length) throw Object.assign(new Error('no clip with a picture to put effects on'), { status: 400 });
  const sheets = _sheets();
  if (!sheets.length) console.warn('[fx-auto] no sheets of the effects (node tools/fx-sheets.js) - the agent has their words only');
  let answer;
  let by = '';
  if (FAKE.on()) {
    answer = await FAKE.fxAuto(brief, o.signal);
    by = 'fake agent';
  } else {
    const { callLadder } = require('./llm-json');
    const images = await _images(sheets);
    const r = await callLadder({ system: SYSTEM, user: userOf(brief, sheets), schema: SCHEMA, name: 'effects', effort: EFFORT, images, signal: o.signal });
    answer = r.data;
    by = r.by ? r.by.model : '';
  }
  const got = A.checkAnswer((answer && answer.effects) || [], brief, tl);
  if (got.dropped.length) console.log('[fx-auto] kept ' + got.placed + ', left out: ' + got.dropped.map((x) => x.k + ' at ' + x.at + ' (' + x.why + ')').join('; ').slice(0, 600));
  return { byClip: got.byClip, placed: got.placed, dropped: got.dropped, noWords: brief.noWords, count: brief.count, by };
}

/**
 * (block 4) The answer laid INTO `tl` by the server (a highlights fragment at its cut): each effect an id, the face's path where the
 * clip follows its faces (auto.js facePathOf - else it works where a face usually is), the cover's date; added to its clip's `fx`
 * (params.js normalizeFx). -> how many were laid.
 */
function layInto(tl, byClip, { faces = {} } = {}) {
  const f = String((tl && tl.format) || '9:16').split(':');
  const aspect = (+f[0] > 0 && +f[1] > 0) ? (+f[0] / +f[1]) : 9 / 16;
  let n = 0;
  let k = 0;
  for (const t of (tl && tl.tracks) || []) {
    for (const c of (t && t.clips) || []) {
      const add = byClip && byClip[String(c.id)];
      if (!add || !add.length) continue;
      const made = add.map((e) => {
        const one = { ...e, id: 'fx' + Date.now().toString(36) + (k++).toString(36) };
        if (E.effectOf(e.k).face) {
          const p = A.facePathOf(c, faces[String(c.id)], aspect);
          if (p) one.path = p;
        }
        if (e.k === 'magazine') {
          const now = new Date();
          one.txt = { ...(one.txt || {}), date: now.toLocaleString('en-US', { month: 'long' }).toUpperCase() + ' ' + now.getFullYear() };
        }
        return one;
      });
      const next = P.normalizeFx([...(Array.isArray(c.fx) ? c.fx : []), ...made]);
      if (next) { n += next.length - (Array.isArray(c.fx) ? c.fx.length : 0); c.fx = next; }
    }
  }
  return n;
}

/** What one call costs, about: the two sheets and a film's words in, its answer out - at the ladder's first step's price. */
function priceOf(seconds = 60) {
  const AGENTS = require('./agents');
  const model = (AGENTS.ladder()[0] || {}).model || '';
  const tokIn = 2 * 1300 + 4200 + Math.round((+seconds || 60) * 4.5);
  return require('./highlights-agent').usdOf(tokIn, 2500, model);
}

module.exports = { choose, layInto, facesOf, priceOf, userOf, SYSTEM, SCHEMA, EFFORT };
