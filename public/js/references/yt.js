// A DOWNLOADED YOUTUBE VIDEO of REFERENCES -> YouTube -> Videos - a source of the scenarios and of highlights.
// What its viewer offers, on the Library page and in Merge's panel alike (js/library/viewer.js actions):
//   To highlights   a new highlights project in Merge on it, chosen in its popup already
//   Delete          pressed twice - "really?" on the button: the source goes with its transcript and its
//                   topics (DELETE /api/sources/:id); scenarios written from it keep their text
// It is not moved anywhere: its file and its record are the source's.

let _armed = null;      // { id, t } - the one whose "Delete" was pressed once

// one "Really?", 3 s (js/really.js); what goes is said in the line beside it
import { REALLY, MS } from '../really.js';
// a viewer's action is an icon and its word - put back whole when "Really?" lets go
import { fillAct } from '../library/viewer.js';

/** The viewer's buttons for a downloaded YouTube video. */
export function ytActions(it) {
  const armed = !!(_armed && _armed.id === it.id);
  return [
    { id: 'hl', label: 'To highlights', title: 'A new highlights project in Merge on this video - its words are heard once and kept with it' },
    { id: 'srcdel', label: armed ? REALLY : 'Delete', danger: true, armed,
      title: 'Delete this source - its video, its transcript and its topics. Scenarios written from it keep their text.' },
  ];
}

/** Where the source's video is on a timeline, in words ('' when nowhere). */
async function _usage(it) {
  try {
    const r = await fetch('/api/library/usage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media: [it.media] }) }).then(x => x.json());
    const n = ((r && r.projects) || []).length;
    return n ? ' It is on the timelines of ' + n + ' project' + (n === 1 ? '' : 's') + ' - its clips there turn red.' : '';
  } catch (e) { return ''; }
}

/**
 * "Delete" pressed: the first press arms it and says what goes ({ armed, msg }); the second, within a few seconds, deletes
 * ({ removed: true }). Throws with the server's words.
 */
export async function ytDelete(it) {
  if (!_armed || _armed.id !== it.id) {
    if (_armed) clearTimeout(_armed.t);
    const id = it.id;
    _armed = { id, t: setTimeout(() => {
      if (!_armed || _armed.id !== id) return;
      _armed = null;
      // The button goes back to itself where it is still on screen - without drawing the viewer again (that restarts the video).
      document.querySelectorAll('.lib-view-acts button').forEach((b) => { if (b.textContent === REALLY) { fillAct(b, 'Delete'); b.classList.remove('is-armed'); } });
    }, MS) };
    return { armed: true, msg: 'Press again to delete the source - its video, its transcript and its topics.' + await _usage(it) };
  }
  clearTimeout(_armed.t);
  _armed = null;
  const r = await fetch('/api/sources/' + encodeURIComponent((it.meta && it.meta.source) || it.id), { method: 'DELETE' })
    .then(x => x.json()).catch(() => null);
  if (!r || !r.success) throw new Error((r && r.error) || 'not deleted');
  return { removed: true };
}
