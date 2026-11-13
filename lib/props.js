'use strict';

// IMAGES -> PROPS: the products a character holds in a frame.
//
// A product is ONE picture in media/props/ - the file IS the entry, as an environment's is (routes/library.js MADE) - and
// what is known about it lives beside it in data/props-meta.json (lib/shelf-meta.js), keyed by the picture's address:
//   name          what it is called - given in the New prop window, or the agent's NAME when none was
//   words         what the person said about it, as typed, in any language - kept apart, so "read again" reads them anew
//   description   the agent's, in English, in sections (NAME / WHAT IT IS / SIZE / LOOK / LABEL / HOW IT IS HELD /
//                 FROM YOUR WORDS) - or written by hand in the viewer (`by: 'you'`)
//   by, at        who wrote the description (the agent's model, or 'you') and when
//
//   add({ buf | path, name, words })   the picture made sendable (lib/image-in.js) and COPIED into Props (a picture of
//                                      IMAGES stays where it is), its thumbnail, its entry; then
//                                      describe() behind the answer
//   describe(media)                    the agent LOOKS at the picture and reads the person's words, and writes the
//                                      description - replacing the one there was ("read again")
//   reading(media)                     whether that is going on now
//   facts(media, fallback)             { name, description } for the frames chat and the clips' writers - what is kept now,
//                                      else what the frame remembered (a product deleted)
//
// Nothing is generated and no Alerts row is written: the description is a reading of fractions of a cent.

const fs = require('fs');
const path = require('path');
const SM = require('./shelf-meta');
const { PROPS_DIR } = require('./config');
const { toUrl, toDiskExisting } = require('./media');
const { folderName, uniqueName } = require('./names');
const FAKE = require('./fake-agg');

const _reading = new Set();             // the products being described right now, by address
const SECTIONS = [['name', 'NAME'], ['what', 'WHAT IT IS'], ['size', 'SIZE'], ['look', 'LOOK'], ['label', 'LABEL'],
  ['held', 'HOW IT IS HELD'], ['words', 'FROM YOUR WORDS']];

/** Whether the agent is describing the product at `media` right now. */
function reading(media) {
  return _reading.has(String(media || ''));
}

/** The entry of a product, by its address ({} when nothing is known). */
function entry(media) {
  return SM.read('props')[String(media || '')] || {};
}

function _write(media, fn) {
  const all = SM.read('props');
  const m = { ...(all[media] || {}) };
  fn(m);
  m.at = new Date().toISOString();
  all[media] = m;
  SM.write('props', all);
  return m;
}

/**
 * A product brought in. `o`: { buf (a picture's bytes) | path (a library address - IMAGES, REFERENCES), name, words }.
 * -> { id, media, name } once the picture lies in Props with its thumbnail and its entry; the description is written behind.
 */
async function add(o) {
  const IN = require('./image-in');
  const H = require('./helpers');
  let buf = o && o.buf;
  if (!buf && o && o.path) {
    const abs = toDiskExisting(String(o.path).split('?')[0]);
    if (!abs || !fs.existsSync(abs)) throw Object.assign(new Error('that picture is not in the library any more'), { status: 400 });
    buf = fs.readFileSync(abs);
  }
  if (!buf || !buf.length) throw Object.assign(new Error('a photo of the product is needed'), { status: 400 });
  const pic = await IN.sendable(buf);
  const name = String((o && o.name) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const words = String((o && o.words) || '').trim().slice(0, 4000);
  fs.mkdirSync(PROPS_DIR, { recursive: true });
  // The file is named after the product when it has a name - never renamed after (an address is what the frames remember).
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const taken = fs.readdirSync(PROPS_DIR).map(f => f.replace(/\.[^.]+$/, ''));
  const base = uniqueName(folderName(name || 'prop ' + stamp, 'prop ' + stamp), taken);
  const file = base + '.' + pic.ext;
  const abs = path.join(PROPS_DIR, file);
  fs.writeFileSync(abs, pic.buf);
  try { await H.createThumbnail(abs, path.join(PROPS_DIR, 'thumbs', base + '.jpg')); }
  catch (e) { console.warn('[props] no thumbnail for ' + file + ': ' + e.message); }
  const media = toUrl(PROPS_DIR) + '/' + file;
  _write(media, (m) => { if (name) m.name = name; if (words) m.words = words; m.description = ''; m.by = ''; });
  describe(media).catch((e) => console.warn('[props] ' + file + ' was not described: ' + e.message));
  return { id: file, media, name };
}

const SYSTEM = [
  'You describe a PRODUCT from its photo for a team that will draw it, exactly as it is, in a person\'s hand in the frame of a',
  'UGC video ad. Look at the photo; read what the person knows about it. Everything you write is in English.',
  'Answer as ONE json object and nothing else: {"name": "...", "what": "...", "size": "...", "look": "...", "label": "...",',
  '"held": "...", "words": "..."}',
  '- name: what it is called - the brand and the product as printed on it, or a short plain name (2-6 words).',
  '- what: what it is, in one sentence (a face cream in a squeeze tube, a can of an energy drink...).',
  '- size: its real size in centimetres (height x width, and depth when it matters) and how it sits in a hand (fits in one',
  '  palm, held between two fingers, needs both hands) - an estimate from the kind of product and the person\'s words, said',
  '  as "about".',
  '- look: what is SEEN - the shape, the colours, the materials and the finish, the cap or lid, anything on it.',
  '- label: every word printed on it EXACTLY as printed, letter for letter, the front first, with where each sits and its',
  '  colour; what cannot be read is said to be unreadable - never guessed, never invented. "none" when it has no lettering.',
  '- held: how a person naturally holds and shows it in a frame (in one hand, the label to the camera; the cap open; on the',
  '  palm...) and how it is used, if that is shown.',
  '- words: what the person\'s words add that the photo does not show (what it does, for whom, a taste, what matters to',
  '  show), put into English; "none" when they said nothing.',
  'What is visible comes from the photo only; what is not visible comes from the person\'s words only. Describe the product',
  'alone - never its background, the hand holding it or the table it stands on. Plain sentences, no lists inside a field.',
].join('\n');

const _joined = (j) => SECTIONS.map(([k, label]) => label + ': ' + String(j[k] || '').replace(/\s+/g, ' ').trim())
  .filter(line => !/:\s*$/.test(line)).join('\n');

/**
 * The agent writes the product's description from its picture and the person's words - and it REPLACES the one there was.
 * The name the person gave stays; with none, the agent's NAME becomes it. Resolves with the entry, or throws in words
 * (the entry keeps what it had).
 */
async function describe(media) {
  media = String(media || '');
  if (_reading.has(media)) throw Object.assign(new Error('it is being described already'), { status: 409 });
  const abs = toDiskExisting(media);
  if (!abs || !fs.existsSync(abs)) throw Object.assign(new Error('the product is not in Props any more'), { status: 404 });
  _reading.add(media);
  try {
    const m0 = entry(media);
    const user = 'The name they gave it: ' + (m0.name || 'none') + '.\nWhat they know about it (any language):\n'
      + (String(m0.words || '').trim() || 'nothing');
    let j = null, by = '';
    if (FAKE.on()) {
      await new Promise(r => setTimeout(r, 1500));
      if (/\?fail\b/.test(String(m0.words || ''))) throw new Error('the fake agent could not describe it (?fail in the words)');
      j = { name: m0.name || 'Fake product', what: '[fake] a product in a small bottle.', size: 'about 12 x 4 cm, fits in one palm.',
        look: '[fake] a white bottle with a green cap.', label: '"FAKE" on the front in green.', held: 'in one hand, the label to the camera.',
        words: String(m0.words || '').trim() ? '[fake] ' + String(m0.words).trim().slice(0, 200) : 'none' };
      by = 'fake agent';
    } else {
      const GENS = require('./mv3-gens');
      const AGENT = require('./mv3-agent');
      const { parseLooseJson } = require('./helpers');
      let urls = [];
      try { urls = await GENS.hostRefs([media]); } catch (e) { throw new Error('the picture could not be shown to the agent (' + e.message + ')'); }
      const r = await AGENT.see(SYSTEM, user, urls);
      if (!r.text) throw new Error('no agent answered (' + (r.tried || []).join(', ') + ')');
      j = parseLooseJson(r.text) || parseLooseJson(AGENT._escapeRaw(r.text));
      if (!j || typeof j !== 'object' || !String(j.what || j.look || '').trim()) throw new Error('the agent answered nothing usable');
      by = r.by ? String(r.by.model || '') : '';
    }
    const description = _joined(j).slice(0, 4000);
    // Written only while the product is still there.
    if (!fs.existsSync(abs)) throw new Error('the product was deleted meanwhile');
    return _write(media, (m) => {
      m.description = description;
      m.by = by || 'agent';
      delete m.fail;
      if (!m.name && String(j.name || '').trim()) m.name = String(j.name).replace(/\s+/g, ' ').trim().slice(0, 120);
    });
  } catch (e) {
    // Why it was not described, for the window and the viewer ("read again" tries anew); the description there was stays.
    try { if (fs.existsSync(abs)) _write(media, (m) => { m.fail = String(e.message || e).slice(0, 300); }); } catch (err) { /* the store as it is */ }
    throw e;
  } finally {
    _reading.delete(media);
  }
}

/**
 * What the frames chat and the clips' writers are told of a product: { name, description } as kept now; a product deleted
 * from Props - what `fallback` remembered ({ name, description } of the frame), else its file's name.
 */
function facts(media, fallback) {
  const m = entry(media);
  const f = fallback || {};
  const file = String(media || '').split('/').pop().replace(/\.[^.]+$/, '');
  return {
    name: String(m.name || f.name || file || 'the product'),
    description: String(m.description || f.description || ''),
  };
}

/** Whether an address is a product of Props. */
const isProp = (media) => String(media || '').split('?')[0].startsWith(toUrl(PROPS_DIR) + '/');

module.exports = { add, describe, reading, entry, facts, isProp, SECTIONS };
