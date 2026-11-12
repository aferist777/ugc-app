/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the person's OWN caption presets (phase V30, block 5; the owner's (с13), (с45)-(с52)).

   The list lives in the library (data/caption-presets.json, lib/caption-presets-store.js); this keeps the page's
   copy and tells everyone who shows it: preset-use.js (so "based on My Yellow" and "back to the preset" know them),
   the tiles (captions-view.js) and the strip (inspector.js). Every change is the server's - it checks the name - and
   answers the whole list.

   A preset is saved from the strip ("save as my preset", a name asked in the window - (с13)); its look never changes
   after (с45: a taken name is refused, never replaced); it is renamed or deleted with a right-click on its tile, deleted
   at once (с47). The lane or line it was saved from stays as it was (с46).
   ═══════════════════════════════════════════════════════════════════════════ */

import { setMine } from '../captions/preset-use.js';
import { PRESETS } from '../captions/presets.js';
import { TEXT_PRESETS } from '../captions/presets-text.js';

let _list = [];
const _subs = new Set();

function _take(list) {
  _list = (Array.isArray(list) ? list : []).filter((p) => p && p.id && p.style);
  setMine(_list);
  for (const fn of _subs) { try { fn(_list); } catch (e) { console.warn('[my presets]', e); } }
}

// TWO KINDS (phase V42): one saved from a text lane or line is `kind: 'text'` - the text gallery's. `list` / `byId` are the CAPTION
// presets', as they always were (the highlights popup's styles, hl-style.js, are for subtitles); `all` / `find` both kinds, for the
// captions view, which shows each gallery's own.
/** The person's caption presets (for subtitles), newest first. */
export const list = () => _list.filter((p) => p.kind !== 'text');
export const byId = (id) => list().find((p) => p.id === id) || null;
/** Every preset of the person's, both kinds, newest first. */
export const all = () => _list;
export const find = (id) => _list.find((p) => p.id === id) || null;

/** Told after every change of the list (and once it is first read). */
export function onChange(fn) { _subs.add(fn); return () => _subs.delete(fn); }

/** Read from the server - when Merge starts. A failed read leaves the list as it was. */
export async function load() {
  try {
    const d = await fetch('/api/mv3/captions/presets').then((r) => r.json());
    if (d && d.success) _take(d.presets);
  } catch (e) { /* the server is restarting: the next change reads it */ }
  return _list;
}

async function _post(url, body) {
  let r = null, d = null;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    d = await r.json();
  } catch (e) { d = null; }
  if (!r || !d || !d.success) throw new Error((d && d.error) || 'The app did not answer - try again in a moment.');
  if (d.presets) _take(d.presets);
  return d;
}

/** A new preset from a style - `kind` 'text' when saved from a text lane or line (V42). A refusal (a taken name, (с45)) is thrown in the
 * server's words. */
export const save = (name, style, kind) => _post('/api/mv3/captions/presets', { name, style, kind: kind === 'text' ? 'text' : '' }).then((d) => d.preset);
export const rename = (id, name) => _post('/api/mv3/captions/presets/rename', { id, name }).then((d) => d.preset);
export const remove = (id) => _post('/api/mv3/captions/presets/delete', { id });

/** The name the window offers (с48): "My preset", or "My preset 2" and on when it is taken - by the person's or the app's. */
export function freeName() {
  const taken = new Set(_list.map((p) => String(p.name).toLowerCase()).concat(PRESETS.concat(TEXT_PRESETS).map((p) => String(p.name).toLowerCase())));
  if (!taken.has('my preset')) return 'My preset';
  for (let n = 2; ; n++) if (!taken.has('my preset ' + n)) return 'My preset ' + n;
}
