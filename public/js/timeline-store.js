/* ═══════════════════════════════════════════════════════════════════════════
   TIMELINE STORE — where a Merge project's layout lives.

   timeline_data_v2 is the whole editor's model: per session, which birols / hooks /
   halfers are placed, their timings, trims, effects and picks. The Merge v2 editor reads
   and writes it 84 times across its five files.

   It used to be declared in the middle of scen-montage.js - 72KB of the old Scenarios
   block - which meant the new editor could not load without dragging that in. These four
   declarations are the entire dependency, so they live here instead.

   The store is server-backed: edit-sync.js owns timeline_data_v2, hydrating it from
   data/edit-state.json before the page reads it and pushing every change back. Writing
   through setTimelineData is what triggers that, so nothing here talks to the server
   itself - it just must not bypass localStorage.
   ═══════════════════════════════════════════════════════════════════════════ */

const TIMELINE_DATA_KEY = 'timeline_data_v2';

function getTimelineData()  { try { return JSON.parse(localStorage.getItem(TIMELINE_DATA_KEY) || '{}'); } catch { return {}; } }
function setTimelineData(d) { localStorage.setItem(TIMELINE_DATA_KEY, JSON.stringify(d)); }

// How long a piece of audio is, asked of the browser rather than the server. Used when an
// insert is placed, to size it from its source. Resolves 0 rather than rejecting: a clip
// that will not report its length should not take a placement down with it.
function getAudioDuration(src) {
  return new Promise(resolve => {
    const a = new Audio(src);
    a.addEventListener('loadedmetadata', () => resolve(a.duration || 0), { once: true });
    a.addEventListener('error', () => resolve(0), { once: true });
    a.load();
  });
}

window.TIMELINE_DATA_KEY = TIMELINE_DATA_KEY;
window.getTimelineData   = getTimelineData;
window.setTimelineData   = setTimelineData;
window.getAudioDuration  = getAudioDuration;
