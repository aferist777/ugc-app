/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — undo / redo.

   Snapshot stack, not a command log: push() takes a copy of the whole timeline
   state BEFORE a mutation, undo() puts it back. Coarse, but it cannot get out of
   step with the data the way per-operation inverses do - and the operations here
   (stamp a value onto every clip in a track, trim, move, delete) are exactly the
   kind whose inverse is fiddly to write and easy to get subtly wrong.

   WHY THIS EXISTS AT ALL: a lane's Fit or Align STAMPS it onto every clip in that
   lane, overwriting whatever each clip had (timeline-b.js stampTrack). That is the
   behaviour that was asked for, and it destroys per-clip work in one click. So the
   history was built with the stamp rather than after it, and it is driven by two
   buttons that show their own true state, with Ctrl+Z / Ctrl+Y as their shortcut
   (js/merge-v3/bar.js).

   Until the timeline store calls bind() (js/merge-v3/store.js) canUndo()/canRedo()
   are false, and the buttons are correctly disabled rather than pretending.
   ═══════════════════════════════════════════════════════════════════════════ */

// Deep enough for a working session, bounded so a long one cannot grow without
// limit. Each entry is a JSON string of the timeline state.
const MAX = 60;

let _io = null;          // { read(), write(state) } - supplied by the store
let _undo = [];
let _redo = [];
let _subs = [];
// A SERIES OF ONE GESTURE is one step (K10b): the word editor's [ and ] move an edge a hundredth at a time,
// and twenty presses are one thing to take back. A push with the same tag as the last one, soon after it and
// with nothing undone in between, keeps the snapshot taken before the series.
const SERIES_MS = 1500;
let _lastTag = null, _lastAt = 0;

function _emit() { for (const cb of _subs) { try { cb(); } catch (e) {} } }

// Called once by whoever owns the timeline state.
export function bind(io) {
  _io = (io && typeof io.read === 'function' && typeof io.write === 'function') ? io : null;
  _undo = []; _redo = [];
  _lastTag = null;
  _emit();
}

// Call BEFORE mutating. Taking the snapshot after the change would record the
// result and undo would be a no-op. `tag`: the gesture a series belongs to (see SERIES_MS).
export function push(tag) {
  if (!_io) return;
  const now = Date.now();
  if (tag && tag === _lastTag && !_redo.length && _undo.length && now - _lastAt < SERIES_MS) { _lastAt = now; return; }
  _lastTag = tag || null;
  _lastAt = now;
  let snap;
  try { snap = JSON.stringify(_io.read()); } catch (e) { return; }
  if (snap == null) return;
  // A push that changes nothing is not a step: repeated identical states would
  // make undo look broken (press it, nothing moves).
  if (_undo.length && _undo[_undo.length - 1] === snap) return;
  _undo.push(snap);
  if (_undo.length > MAX) _undo.shift();
  _redo.length = 0;        // a new edit invalidates the redo branch
  _emit();
}

function _step(from, to) {
  if (!_io || !from.length) return false;
  _lastTag = null;
  let cur;
  try { cur = JSON.stringify(_io.read()); } catch (e) { return false; }
  const next = from.pop();
  to.push(cur);
  if (to.length > MAX) to.shift();
  try { _io.write(JSON.parse(next)); } catch (e) { return false; }
  _emit();
  return true;
}

export function undo() { return _step(_undo, _redo); }
export function redo() { return _step(_redo, _undo); }

export function canUndo() { return !!_io && _undo.length > 0; }
export function canRedo() { return !!_io && _redo.length > 0; }
export function depth() { return { undo: _undo.length, redo: _redo.length }; }

// Subscribe to state changes so a button can paint its own enabled state. Called
// once immediately, so a subscriber never has to paint itself first.
export function onChange(cb) {
  if (typeof cb !== 'function') return;
  _subs.push(cb);
  try { cb(); } catch (e) {}
}
