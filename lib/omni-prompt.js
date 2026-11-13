'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE PROMPT OF A LINE FILMED BY OMNIHUMAN 2.0 - the writer's rules, its request, and the limit.
//
// OmniHuman is given the line's frame, its read and at most 300 characters of English. The read drives the mouth by
// itself, so the prompt says nothing about the lips; what the model does respond to is the PERFORMANCE - the expression,
// where the eyes go, the head and the hands, the body - and a calm camera. It sees the picture, so the person, the
// clothes and the place are not described: only what moves.
//
// One request for the lines that need writing, as Kling's writer does (routes/scen3.js _writePromptsNow, which asks it
// through the agents' ladder, lib/agents.js): the agent sees the frames the lines open on and the arc of the whole
// script, and is told the same things Kling's writer is - the mood, the shot, how the place moves, the products. What
// comes back is cut to the limit here (fit), at the last whole sentence.
// ════════════════════════════════════════════════════════════════════════════

const MAX = 300;

// What every OmniHuman prompt obeys, whatever the line says.
const RULES = 'RULES for every prompt - OmniHuman 2.0 animates the person of the frame from the voice; the prompt only'
  + ' directs the performance:'
  + '\n- AT MOST ' + MAX + ' CHARACTERS, in English, present tense, one to three short plain sentences - no lists, no quotes,'
  + ' no headings.'
  + '\n- What the person DOES while speaking to the camera: the expression and how it changes, the brows and the eyes, the'
  + ' head (a nod, a tilt), the hands (a gesture inside the frame), the shoulders and the body (a lean, a shift of weight).'
  + '\n- THE GAZE: into the lens and held; at most a brief glance away where a thought turns, straight back.'
  + '\n- THE CAMERA: steady - at most a slow, subtle push-in or a light handheld feel; never a cut, a zoom jump or a new angle.'
  + '\n- NOTHING about the mouth, the lips or lip sync: the voice moves the mouth by itself.'
  + '\n- Do NOT describe the person, the clothes, the place or the light - the picture shows them. The place only for what'
  + ' moves in it, in a few words, and only when there is room.'
  + '\n- Do not write the words they say, and do not mention the script, the audio, the frame or the image.'
  + '\n- The clip CONTINUES the frame the line opens on: the movement starts from the pose that picture shows.';
// The one shot size with a hand already busy: it holds the phone.
const SELFIE = ' IN A SELFIE the arm holding the phone stays where it is - only the free hand gestures, inside the frame.';
// A product in the person's hand in the frame.
const PRODUCT = ' A PRODUCT in the hand stays exactly as it is - the same hand, its label to the camera - moved only a little.';

/**
 * The request for the lines `o.lines` ([{ n, at, shot, moment, products: [{ name, label }], words }] - `at` the
 * IMAGE number of the frame it opens on, 0 when unknown). `o`: { shown (pictures sent), mood: { label, brief, face,
 * gestures }, sets: [{ id, label, rule }], envMotion, lines }.
 */
function ask(o) {
  const mood = o.mood || {};
  const sets = Array.isArray(o.sets) ? o.sets : [];
  const one = sets.length === 1;
  const lines = Array.isArray(o.lines) ? o.lines : [];
  const anyProd = lines.some(l => (l.products || []).length);
  return 'You are directing a talking-head video made by OmniHuman 2.0: one person, one place, speaking straight to'
    + ' camera. IMAGE 1' + (o.shown > 1 ? ' to ' + o.shown : '') + (o.shown > 1 ? ' are' : ' is') + ' the first frame'
    + (o.shown > 1 ? 's' : '') + ' of this video - the instants the lines open on.'
    + '\n\nTHE FEEL OF THE WHOLE VIDEO: ' + (mood.label || '') + '. ' + (mood.brief || '')
    + '\nTHE FACE: ' + (mood.face || '')
    + '\nTHE BODY: ' + (mood.gestures || '')
    + (one ? '\nTHE SHOT: ' + sets[0].rule
      : '\nTHE SHOTS - each line says which: ' + sets.map(s => s.label + ': ' + s.rule).join(' | '))
    + (o.envMotion ? '\nTHE PLACE MOVES BY ITSELF: ' + o.envMotion : '')
    + '\n\n' + RULES
    + (sets.some(s => s.id === 'selfie') ? SELFIE : '')
    + (anyProd ? PRODUCT : '')
    + '\n\nThe lines, in order. Each says which frame it opens on and what is happening in that frame. The script is one'
    + ' arc: write each line\'s performance as its place in that arc, not as a performance of its own.\n'
    + lines.map(l => '[' + l.n + '] frame ' + (l.at > 0 ? 'IMAGE ' + l.at : 'unknown')
      + (one || !l.shot ? '' : ', ' + l.shot)
      + (l.moment ? ' (' + l.moment + ')' : '')
      + (l.products || []).map(p => ', holding the product "' + p.name + '"' + (p.label ? ' (its label: ' + p.label + ')' : '')).join('')
      + ' | "' + String(l.words || '').replace(/\s+/g, ' ').trim() + '"').join('\n')
    + '\n\nAnswer with JSON and nothing else: {"lines":[{"n":<the number in brackets>,"prompt":"..."}]}'
    + ' - exactly ' + lines.length + ' entr' + (lines.length === 1 ? 'y' : 'ies') + ', one per line above, each prompt at most '
    + MAX + ' characters.';
}

/** The agent's answer as [{ n, prompt }] - [] when it is not the JSON asked for. */
function read(raw) {
  const m = String(raw || '').match(/\{[\s\S]*\}/);
  if (!m) return [];
  let j = null;
  try { j = JSON.parse(m[0]); } catch (e) { j = null; }
  const list = (j && Array.isArray(j.lines)) ? j.lines : [];
  return list.map(x => ({ n: parseInt(x && x.n, 10) || 0, prompt: String((x && (x.prompt || x.motion)) || '') })).filter(x => x.n > 0);
}

/**
 * The text cut to `max` characters at its last whole sentence; one sentence longer than that is cut at its last whole
 * word. Spaces are made single.
 */
function fit(text, max) {
  const lim = max > 0 ? max : MAX;
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (t.length <= lim) return t;
  const head = t.slice(0, lim);
  let at = 0;
  const re = /[.!?]["'”)]?(?=\s|$)/g;
  let m;
  while ((m = re.exec(head))) at = m.index + m[0].length;
  if (at > 0) return head.slice(0, at).trim();
  const sp = head.lastIndexOf(' ');
  return (sp > 0 ? head.slice(0, sp) : head).replace(/[\s,;:-]+$/, '').trim();
}

module.exports = { MAX, RULES, ask, read, fit };
