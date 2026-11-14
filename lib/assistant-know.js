'use strict';

// WHAT THE ASSISTANT KNOWS - its two modes' instructions, and what is attached to a message, in words.
//
//   system(mode)        the system text of a mode, built once and then the same bytes every turn (so Claude reads it
//                       from its cache) - Ideas'; Help's is built for each message from the chapters chosen:
//     ideas  - a brainstorming partner for videos, music and prompts, with a NOTE ON THE APP'S GENERATORS: which
//              generators there are, their models and limits - read from the code's own tables (lib/video-models.js,
//              lib/mv3-img.js, lib/th-video.js, lib/omni-prompt.js, lib/audio-engines.js) so it does not go stale - and
//              how to write a prompt for each, written by hand;
//     help   - how to do things in the app, by THE GUIDE that ships with the program - a book of chapters,
//              public/guide/<nn>-<name>.md (the draft public/guide/guide.md stands for the chapters not written yet): the
//              model first picks 1-3 chapters by the table of contents (pickMessages / pickOf), then answers by them alone
//              (helpSystem) - two calls, cheap on any model.
//   attached(list)      [{ kind, ref }] -> [{ kind, ref, name, text }]: a character's look (its image's address - a look
//                       or a character's sheet), a product of IMAGES -> Props (its address) or a scenario (its id), read
//                       here from the library's own stores as words. Pictures are never sent.

const fs = require('fs');
const path = require('path');
const { DATA_DIR, PUBLIC_DIR } = require('./config');

const GUIDE_DIR = path.join(PUBLIC_DIR, 'guide');
const TOC = require('../public/js/assistant/guide-toc.js');

const _read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const _range = (lo, hi) => (lo === hi ? lo + ' s' : lo + '-' + hi + ' s');

// ── The note on the generators (Ideas) ──────────────────────────────────────
function _videoLines() {
  const V = require('./video-models');
  const pairs = Object.values(V.PAIRS || {});
  return V.MODELS.map((m) => {
    const mine = pairs.filter(p => p.model === m.id);
    const d = mine.map(p => p.duration || {});
    const lo = Math.min(...d.map(x => +x.min || 0)), hi = Math.max(...d.map(x => +x.max || 0));
    const pmax = Math.min(...mine.map(p => +p.promptMax || 0).filter(Boolean));
    const lim = mine.reduce((a, p) => {
      const l = p.limits || {};
      return { i: Math.max(a.i, +l.images || 0), v: Math.max(a.v, +l.videos || 0), a: Math.max(a.a, +l.audios || 0) };
    }, { i: 0, v: 0, a: 0 });
    const n = (k, one) => (k === 1 ? '1 ' + one : k + ' ' + one + 's');
    const refs = [lim.i ? n(lim.i, 'picture') : '', lim.v ? n(lim.v, 'clip') : '', lim.a ? n(lim.a, 'sound') : ''].filter(Boolean).join(', ');
    const len = d.some(x => x.fromClip) ? 'as long as its clip (' + _range(lo, hi) + ')' : _range(lo, hi);
    const brief = m.brief.replace(/^[^:]+:\s*/, '').replace(/\s*Makes its own sound\.?$/, '');
    return '- ' + m.label + ': ' + brief + ' Length ' + len + '.'
      + (refs ? ' Takes up to ' + refs + '.' : '') + (pmax > 0 && isFinite(pmax) ? ' Prompt up to ' + pmax + ' characters.' : '')
      + (m.speaks ? ' Makes its own sound and speech.' : ' Silent - the sound is added on the timeline.');
  }).join('\n');
}

function _pictureLines() {
  const I = require('./mv3-img');
  return Object.entries(I.ENGINES || {}).map(([id, e]) => {
    const refs = Math.max(...Object.keys(e.providers || {}).map(p => I.maxRefsOf(id, p) || 0));
    return '- ' + (e.label || id) + (refs ? ': up to ' + refs + ' reference pictures' : '');
  }).join('\n');
}

function _headLines() {
  const T = require('./th-video');
  const omniMax = require('./omni-prompt').MAX;
  return T.MODELS.map(m => '- ' + m.label + ': ' + m.about + (m.id === 'omnihuman' ? ' Its prompt for a line is at most ' + omniMax + ' characters.' : '')).join('\n');
}

function _soundLines() {
  const A = require('./audio-engines');
  return Object.entries(A.MODES || {}).map(([, m]) => '- ' + m.label + ' (' + (A.ENGINES[m.engine] || m.engine) + ')').join('\n');
}

const IDEAS_RULES = [
  'You are the Ideas assistant inside UGC Studio, a desktop app for making UGC ads and short vertical videos (TikTok, Shorts, Reels).',
  'You help the person brainstorm: ideas for videos and ads, hooks, script outlines, music for a video, and prompts for the app\'s generators.',
  '',
  'How you answer:',
  '- In the language the person writes in. A prompt for a generator is always in English - the app sends only English to its models.',
  '- Short and concrete. Lists over paragraphs. Ask one question back only when you cannot go on without it.',
  '- When an idea is meant to be made, say which generator of the app suits it and why, in one line.',
  '- Every prompt for a generator goes in its own fenced block, the first line of the fence naming the generator and its mode, the prompt alone inside - the person copies it as it is:',
  '```prompt Seedance 2.5 · video chat',
  'A woman in a yellow raincoat runs across a wet street at night, handheld camera following her, neon reflections in the puddles.',
  '```',
  '- Keep a prompt within its generator\'s limits below (length, references, seconds).',
  '- You know nothing of the person\'s library except what they attach to a message (a character\'s look, a product, a scenario - in words, never pictures). Use what is attached exactly as it is described.',
  '- You cannot press anything in the app or make anything yourself: the person copies the prompt into the generator.',
];

const IDEAS_TIPS = [
  'How to write for each (the app\'s own experience):',
  '- Pictures chat: one picture per prompt - the subject, what it does, the place, the light, the framing and lens, the style. Say what each attached picture is for ("the woman from the first picture, the jacket from the second"). nano-banana-2 is the app\'s default and keeps faces from references best; gpt-image-2.5 writes legible words on a picture (posters, packaging); seedream-4.5 is photo-real; grok-imagine is quick drafts.',
  '- Video chat: one continuous shot per clip, its action in the order it happens, the camera\'s move, the light and the sound. Spoken words in quotes, with who says them. Name attached references in plain words ("the man in the first picture", "the moves of the clip"); the chat\'s writer turns them into the model\'s own names. Seedance with ONE reference clip and the words "replace X in the clip" edits that clip. Kling motion control needs one full-body picture and one clip of the moves - its prompt is short, the moves come from the clip.',
  '- Talking head: the script is read line by line in an ElevenLabs voice; each line becomes a clip of the person speaking from that line\'s frame. Write lines as spoken sentences, one thought per line, at most a few seconds each. For OmniHuman a line\'s prompt says what the person does while speaking - the face, the gaze, the head, the hands - never the words.',
  '- Frames chat (talking head): the frames of the person in the place, by framing (close-up, medium, wide), with products of IMAGES -> Props held exactly as on their picture.',
  '- Music (Suno V6): Simple makes background music without vocals from a mood; Custom takes a title (up to 80 characters), a Style - genres, instruments, tempo, mood, comma-separated, up to 1000 characters, best under 200 -, lyrics up to 5000 characters with [Verse], [Chorus], [Bridge] tags, and styles to exclude (up to 500); Lyrics writes song texts from an idea of up to 200 characters; Sounds makes a short sound from up to 500 characters.',
  '- ElevenLabs: music from a description (up to 4100 characters, by the minute), Video to Music (music fitted to a clip), sound effects (a short description of the sound, up to 1000 characters).',
  '- Voiceover (a project, not a generator): the script read in a voice, stock B-roll found for every sentence. Highlights: a long video cut into vertical shorts with captions and music.',
];

let _ideas = '';
function ideasNote() {
  if (_ideas) return _ideas;
  _ideas = [
    IDEAS_RULES.join('\n'),
    'THE APP\'S GENERATORS (from the app\'s own tables):',
    'PICTURES (the pictures chat - IMAGES -> generate):\n' + _pictureLines(),
    'VIDEO (the video chat - VIDEO -> generate):\n' + _videoLines(),
    'TALKING HEAD (a project: who, where, the script, mood and voice, frames, clips):\n' + _headLines(),
    'MUSIC AND SOUNDS (the sound window - AUDIO -> generate):\n' + _soundLines(),
    IDEAS_TIPS.join('\n'),
  ].join('\n\n');
  return _ideas;
}

// ── The guide (Help) ────────────────────────────────────────────────────────
// The book is read from its folder and kept until a file of it changes: each chapter's id (its file name without .md,
// "04-merge"), title, sections and text; the draft guide.md last, as "draft", while it is there.
let _book = { key: '', chapters: [] };

/** The chapters of the guide, in order: [{ id, file, title, sections: [{ id, title }], text }]. */
function book() {
  let names = [];
  try { names = fs.readdirSync(GUIDE_DIR).filter(n => TOC.CHAPTER_RE.test(n) || n === TOC.DRAFT).sort(); } catch (e) { names = []; }
  const stamp = names.map((n) => { try { return n + ':' + fs.statSync(path.join(GUIDE_DIR, n)).mtimeMs; } catch (e) { return n; } }).join('|');
  if (stamp === _book.key) return _book.chapters;
  const chapters = [];
  for (const n of names.filter(x => x !== TOC.DRAFT).concat(names.includes(TOC.DRAFT) ? [TOC.DRAFT] : [])) {
    let text = '';
    try { text = fs.readFileSync(path.join(GUIDE_DIR, n), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { continue; }
    const draft = n === TOC.DRAFT;
    const t = TOC.tocOf(text, n);
    chapters.push({ id: draft ? 'draft' : n.replace(/\.md$/, ''), file: n, title: draft ? 'The rest of the app (draft)' : t.title,
                    sections: t.sections, text });
  }
  _book = { key: stamp, chapters };
  return chapters;
}

/** The table of contents for the page: the chapters and their sections, no text. */
function contents() {
  return book().map(c => ({ id: c.id, file: c.file, title: c.title, sections: c.sections }));
}

const HELP_RULES = [
  'You are the Help assistant inside UGC Studio, a desktop app for making UGC ads and short vertical videos.',
  'You answer how to do things in the app: where a button is, what a window does, how to make each kind of project, where files go.',
  '',
  'How you answer:',
  '- In the language the person writes in. The app\'s own words - pages, buttons, windows - exactly as the guide writes them, in English, so they can be found on the screen.',
  '- By the chapters of the guide below and nothing else. When they do not say, say so plainly - never guess a button that may not exist.',
  '- Steps as a short numbered list: where to go, what to press, what happens.',
  '- You cannot press anything in the app yourself. Do not mention the guide\'s pictures - the person sees the app itself.',
];

/** The first call: which chapters answer this - the table of contents and the conversation's last turns. */
function pickMessages(chat) {
  const toc = book().map(c => c.id + '  ' + c.title + '\n' + c.sections.map(x => '    #' + x.id + '  ' + x.title).join('\n')).join('\n');
  const turns = chat.messages.slice(-6).map(m => (m.role === 'user' ? 'Person: ' : 'Assistant: ') + String(m.text || '').slice(0, 1200)).join('\n\n');
  return [
    { role: 'system', content: 'You choose which chapters of the UGC Studio guide answer the person\'s last message. The table of contents:\n\n' + toc
      + '\n\nAnswer ONLY with JSON, nothing before or after it: {"chapters": ["<id>", ...], "section": "<id>#<section>"}'
      + ' - 1 to 3 chapter ids, the most useful first; "section" - the one section that answers best, or "" when none does.' },
    { role: 'user', content: turns || '(nothing yet)' },
  ];
}

/** The first call's answer read: { chapters: [ids that exist], at: { chapter, section, title } | null }. */
function pickOf(raw) {
  const chapters = book();
  const ids = new Set(chapters.map(c => c.id));
  let j = null;
  const m = /\{[\s\S]*\}/.exec(String(raw || ''));
  try { j = m ? JSON.parse(m[0]) : null; } catch (e) { j = null; }
  const picked = (j && Array.isArray(j.chapters) ? j.chapters : []).map(String).filter(id => ids.has(id)).slice(0, 3);
  let at = null;
  const sec = /^([^#\s]+)#([a-z0-9-]+)$/.exec(String((j && j.section) || '').trim());
  if (sec && ids.has(sec[1])) {
    const ch = chapters.find(c => c.id === sec[1]);
    const s = ch.sections.find(x => x.id === sec[2]);
    if (s) at = { chapter: ch.id, section: s.id, title: ch.title + ' › ' + s.title };
  }
  if (at && !picked.includes(at.chapter)) picked.unshift(at.chapter);
  if (!at && picked.length) { const ch = chapters.find(c => c.id === picked[0]); at = { chapter: ch.id, section: '', title: ch.title }; }
  return { chapters: picked.slice(0, 3), at };
}

/** The second call's system text: the rules and the chosen chapters whole (every chapter when none was chosen). */
function helpSystem(ids) {
  const all = book();
  const use = ids && ids.length ? all.filter(c => ids.includes(c.id)) : all;
  if (!use.length) return HELP_RULES.join('\n') + '\n\n(The guide is missing from this copy of the program.)';
  return HELP_RULES.join('\n') + '\n\nTHE GUIDE - the chapters that answer this:\n\n'
    + use.map(c => '=== CHAPTER ' + c.id + ': ' + c.title + ' ===\n' + c.text.trim()).join('\n\n');
}

/** The system text of Ideas (Help's is built per message - helpSystem). */
function system(mode) {
  return mode === 'help' ? helpSystem([]) : ideasNote();
}

// ── What is attached (Ideas) ────────────────────────────────────────────────
const KINDS = ['look', 'prop', 'scenario'];
const _clip = (s, n) => { const t = String(s || '').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

function _look(ref) {
  const looks = _read(path.join(DATA_DIR, 'obrazy.json'), []);
  const chars = _read(path.join(DATA_DIR, 'characters.json'), []);
  const lk = (Array.isArray(looks) ? looks : []).find(x => x && String(x.char || '') === ref);
  const ch = (Array.isArray(chars) ? chars : []).find(c => c && (lk ? String(c.id) === String(lk.charId)
    : String(c.sheet || c.baseFace || '') === ref));
  if (!lk && !ch) return null;
  const lines = [];
  if (ch) lines.push('Character: ' + (ch.name || 'unnamed') + (ch.gender ? ' (' + ch.gender + ')' : '') + (ch.notes ? '. Notes: ' + _clip(ch.notes, 600) : ''));
  if (lk) {
    lines.push('Look: ' + (lk.name || 'look') + (lk.gender && !(ch && ch.gender) ? ' (' + lk.gender + ')' : ''));
    const lb = lk.lb ? _read(path.join(DATA_DIR, 'scen3-lookbook-meta.json'), {})[String(lk.lb).split('?')[0]] : null;
    if (lb && lb.description) lines.push('The outfit (its lookbook): ' + _clip(lb.description, 1500));
    // A talking head that read this look keeps what it saw: the person and the clothes.
    let read = null;
    try { read = require('./projects-store').list().map(p => p && p.frameRef).find(r => r && r.look === ref && (r.character || r.clothes)); } catch (e) { read = null; }
    if (read && read.character) lines.push('How the person looks: ' + _clip(read.character, 1500));
    if (read && read.clothes) lines.push('Clothes: ' + _clip(Array.isArray(read.clothes) ? read.clothes.join('; ') : read.clothes, 1000));
  }
  const name = lk ? (ch ? ch.name + ' · ' : '') + (lk.name || 'look') : (ch.name || 'character');
  return { name, text: lines.join('\n') };
}

function _prop(ref) {
  const P = require('./props');
  if (!P.isProp(ref)) return null;
  const e = P.entry(ref);
  const f = P.facts(ref);
  const lines = ['Product: ' + f.name];
  if (e.words) lines.push('What the person said about it: ' + _clip(e.words, 1000));
  if (f.description) lines.push('Description: ' + _clip(f.description, 2500));
  return { name: f.name, text: lines.join('\n') };
}

function _scenario(ref) {
  const all = _read(path.join(DATA_DIR, 'scen3-scenarios.json'), []);
  const s = (Array.isArray(all) ? all : []).find(x => x && String(x.id) === ref);
  if (!s) return null;
  const lines = (Array.isArray(s.lines) ? s.lines : []).map((l, i) => (i + 1) + '. ' + String((l && l.text) || '').trim()).filter(l => !/^\d+\. $/.test(l));
  let body = lines.join('\n');
  if (body.length > 12000) body = body.slice(0, 12000) + '\n…';
  const meta = [s.type ? 'kind: ' + String(s.type).replace(/_/g, ' ') : '', s.product ? 'product: ' + s.product : '', s.vertical ? 'niche: ' + s.vertical : ''].filter(Boolean).join(', ');
  return { name: s.title || 'scenario', text: 'Scenario: ' + (s.title || 'untitled') + (meta ? ' (' + meta + ')' : '') + '\n' + body };
}

/** What is attached, read: [{ kind, ref, name, text }] - a thing that is not there any more is left out. */
function attached(list) {
  const out = [];
  for (const a of (Array.isArray(list) ? list : []).slice(0, 8)) {
    const kind = String((a && a.kind) || '');
    const ref = String((a && a.ref) || '').split('?')[0];
    if (!KINDS.includes(kind) || !ref) continue;
    if (out.some(x => x.kind === kind && x.ref === ref)) continue;
    const got = kind === 'look' ? _look(ref) : kind === 'prop' ? _prop(ref) : _scenario(ref);
    if (got) out.push({ kind, ref, name: got.name, text: got.text });
  }
  return out;
}

/** The words the model reads for what was attached to one message. */
function contextOf(items) {
  if (!items || !items.length) return '';
  return items.map(a => '[Attached ' + (a.kind === 'look' ? 'character' : a.kind === 'prop' ? 'product' : 'scenario') + ']\n' + a.text).join('\n\n');
}

module.exports = { GUIDE_DIR, KINDS, system, ideasNote, book, contents, pickMessages, pickOf, helpSystem, attached, contextOf };
