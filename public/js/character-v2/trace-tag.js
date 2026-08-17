// WHO ASKED — the page's half of the trace.
//
// The server can see every outgoing call but not what the user pressed, and that is the one
// thing that makes a log readable: "Save character" with five calls under it beats five calls
// with a timestamp each. So the page says so, in a header, and the server hangs everything
// downstream off it.
//
// fetch is patched rather than each call site edited. There are dozens of them across five
// modules, and the ones added next month would silently miss the log - which is the failure
// mode this whole feature exists to prevent.
//
// A run is one user action. Controls are locked while one is in flight (see lockControls),
// so a single current run is not a simplification that will bite: two cannot overlap. Calls
// made outside a run - the character list on load, a look strip refresh - are still tagged,
// as `background`, because "absolutely everything" was the point.

const HDR_RUN = 'X-CV2-Run';
const HDR_ACTION = 'X-CV2-Action';
const HDR_PAGE = 'X-CV2-Page';

// Two things that must never be tagged.
//
// ui-state: storage-sync mirrors client keys to the server continuously and has nothing to
// do with generation - tagging it buries real work under a metronome.
//
// trace: READING the log is not part of the log. The panel refreshes once a second while it
// is open, so tagging those reads would file a new run every second, and within a minute the
// generation you opened the panel to look at has been pushed out of the window by records of
// you looking at it. Measured, not predicted: the tree emptied while being watched.
const MUTE = /\/api\/(ui-state|character-v2\/trace)/;

let _run = null;
let _n = 0;

const _mint = () => 'r' + Date.now().toString(36) + (++_n).toString(36);

// The label _run() is already showing the user, so the log and the spinner say the same
// words. Returns the id in case a caller wants to close exactly its own run.
export function begin(action) {
  // startedAt so the popup can run a live timer. The server only learns of a call once it
  // FINISHES, so without this the panel could not say "running, 34s" - the very thing you
  // open it for while waiting.
  _run = { id: _mint(), action: String(action || 'background').replace(/…$/, ''), startedAt: Date.now() };
  // On window rather than passed around: the settings popup is imported lazily and may not
  // exist when a run starts, so it reads what is current whenever it happens to open.
  window.__cv2Live = _run;
  return _run.id;
}

export function end(id) {
  if (!id || !_run || _run.id === id) { _run = null; window.__cv2Live = null; }
}

export function current() {
  return _run ? { ..._run } : null;
}

// Same-origin only. A cross-origin fetch would carry our headers to somebody else's server,
// and these say nothing secret but there is no reason for them to travel.
function isOurs(input) {
  try {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!url) return false;
    if (/^https?:\/\//i.test(url)) return new URL(url).origin === location.origin;
    return true;
  } catch (e) {
    return false;
  }
}

export function install() {
  if (window.__cv2TraceTag) return;
  window.__cv2TraceTag = true;
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (isOurs(input) && !MUTE.test(url)) {
        const h = new Headers((init && init.headers) || (input && input.headers) || {});
        h.set(HDR_RUN, (_run && _run.id) || _mint());
        h.set(HDR_ACTION, (_run && _run.action) || 'background');
        h.set(HDR_PAGE, 'character');
        init = { ...(init || {}), headers: h };
      }
    } catch (e) {
      // A tagging failure must never cost the request itself.
    }
    return real(input, init);
  };
}
