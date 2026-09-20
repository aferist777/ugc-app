/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the shell's geometry: two sashes, the left column and its stack.

   The left column holds the switchable pair (Library / Inspector) with the timeline
   under it; the preview takes the whole height on the right. The vertical sash sets
   the column's width, the horizontal one the timeline's height inside the column.

   Sizes are kept in localStorage, which storage-sync.js mirrors to the server
   (/api/ui-state) - so a dragged sash survives a different browser, not just a
   reload. That is the whole reason these are plain string keys and not, say, a
   CSS custom property nobody can persist.

   Every size is CLAMPED against the live viewport on the way in as well as on
   the way out. Storing a raw pixel width is only safe if a narrower window
   re-clamps it: a 900px left column restored into a 1000px window would leave
   the preview 60px wide, and nothing on the page would explain why.
   ═══════════════════════════════════════════════════════════════════════════ */

// New keys, on purpose: a width saved for the old shell - a 360px column beside a
// full-width timeline - would put today's timeline in a 360px box.
const LS_LEFT_W = 'mv3_left_w2';
const LS_TL_H   = 'mv3_timeline_h2';
const LS_OPEN   = 'mv3_open_col';

// The column carries the timeline now, so it takes most of the window by default; the
// preview is a vertical and is happy with what is left.
const _defLeft = () => Math.round(window.innerWidth * 0.6);
const DEF_TL_H   = 290;

const SPINE_W     = 34;    // must match .mv3-col.is-collapsed in css/merge-v3.css
const SASH        = 5;     // must match .mv3-sash in css/merge-v3.css
// Wide enough that the four shelf buttons always fit the Library header, and that the
// timeline under it shows its label column and a few seconds of lane.
const MIN_PANEL   = 380;   // narrowest the OPEN panel may get, beside the spine
const MIN_PREVIEW = 340;   // the 9:16 stage stops being worth looking at below this
const MIN_TL_H    = 120;
const MIN_WORK_H  = 220;   // the pair above the timeline never gets shorter than this

function _num(key, def) {
  let v = null;
  try { v = parseInt(localStorage.getItem(key) || '', 10); } catch (e) {}
  return (v && !isNaN(v)) ? v : def;
}

// ── Left column width ──────────────────────────────────────────────────────
function _clampLeft(px) {
  const lo = SPINE_W + MIN_PANEL;
  const hi = Math.max(lo, window.innerWidth - MIN_PREVIEW - SASH);
  return Math.round(Math.max(lo, Math.min(px, hi)));
}
function _applyLeft(px) {
  const el = document.getElementById('mv3-left');
  if (el) el.style.width = _clampLeft(px) + 'px';
}
function _leftNow() {
  const el = document.getElementById('mv3-left');
  return el ? el.getBoundingClientRect().width : _defLeft();
}

// ── Timeline height ────────────────────────────────────────────────────────
// Against the column it lives in, not the page: the bar above is not room it can take.
function _clampTl(px) {
  const col = document.getElementById('mv3-left');
  const h = col ? col.getBoundingClientRect().height : window.innerHeight;
  const hi = Math.max(MIN_TL_H, h - MIN_WORK_H - SASH);
  return Math.round(Math.max(MIN_TL_H, Math.min(px, hi)));
}
function _applyTl(px) {
  const el = document.getElementById('mv3-timeline');
  if (el) el.style.height = _clampTl(px) + 'px';
}
function _tlNow() {
  const el = document.getElementById('mv3-timeline');
  return el ? el.getBoundingClientRect().height : DEF_TL_H;
}

// ── The lock ────────────────────────────────────────────────────────────────
// While a talking head is being BUILT - a step of the workshop is open (js/merge-v3/workshop.js) -
// the timeline and the Library are not where the work is: the cut is laid from the fragments
// later, and until then a clip dragged in from the Library would be a clip on a timeline nobody is
// editing. So both are locked: blurred (css/merge-v3.css, body.mv3-locked), inert to the pointer
// and the keyboard, and the Library column cannot be opened - the inspector is what is open,
// whichever column was before. The timeline step lifts it (decided with the owner 2026-09-21,
// docs/local-app/PLAN.md "Сцена, setup и таймлайн-зеркало").
let _locked = false;

export function lock(on) {
  const want = !!on;
  if (want === _locked) return;
  _locked = want;
  document.body.classList.toggle('mv3-locked', want);
  for (const id of ['mv3-timeline', 'mv3-library']) {
    const el = document.getElementById(id);
    if (el) el.inert = want;
  }
  if (want) setOpenColumn('inspector');
}

/** Is the lock on? The timeline's own keys ask before they act (js/merge-v3/timeline-b.js). */
export const locked = () => _locked;

// ── Which of the two left panels is open ───────────────────────────────────
// Exactly one, always. There is deliberately no "both closed" state: the pair is
// a switch, and a switch with an off position would just be a third layout to
// keep working.
export function setOpenColumn(which) {
  // Not the Library while the lock is on: it is inert, and a column of greyed shelves in front of
  // the inspector would be the panel the person cannot use in place of the one they can.
  if (which === 'library' && _locked) return;
  document.querySelectorAll('.mv3-col').forEach(c => {
    c.classList.toggle('is-collapsed', c.dataset.col !== which);
  });
  try { localStorage.setItem(LS_OPEN, which); } catch (e) {}
}

// ── Sash dragging ──────────────────────────────────────────────────────────
// `sign` is which way the pointer has to move to make the panel BIGGER: the left
// column grows rightwards (+1), the timeline grows upwards (-1) because it hangs
// off the bottom edge.
function _wireSash(sash, { axis, sign, get, set, save, reset }) {
  if (!sash) return;
  const cls = axis === 'x' ? 'mv3-resize-v' : 'mv3-resize-h';
  sash.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const from = axis === 'x' ? e.clientX : e.clientY;
    const base = get();
    document.body.classList.add(cls);
    const move = (ev) => set(base + ((axis === 'x' ? ev.clientX : ev.clientY) - from) * sign);
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove(cls);
      save();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  // Double click hands the size back to the default, same as the Library sash.
  sash.addEventListener('dblclick', () => { reset(); save(); });
}

// ── The crossing ────────────────────────────────────────────────────────────
// The two sashes meet at one point, and until now that point belonged to neither: you could
// widen the column or shorten the timeline, one after the other, but not move the corner they
// share. This is that corner. It lives on the vertical sash and is kept at the horizontal
// one's height - both sizes are inline styles, so the only way to know where they cross is
// to measure it after every change.
function _placeCross() {
  const cross = document.getElementById('mv3-sash-x');
  const v = document.getElementById('mv3-sash-v');
  const h = document.getElementById('mv3-sash-h');
  if (!cross || !v || !h) return;
  const top = h.getBoundingClientRect().top + h.getBoundingClientRect().height / 2
    - v.getBoundingClientRect().top;
  cross.style.top = Math.round(top) + 'px';
}

function _wireCross() {
  const v = document.getElementById('mv3-sash-v');
  if (!v || document.getElementById('mv3-sash-x')) return;
  const cross = document.createElement('div');
  cross.className = 'mv3-sash-x';
  cross.id = 'mv3-sash-x';
  cross.title = 'Drag to resize the column and the timeline at once · double-click to reset both';
  v.appendChild(cross);
  _placeCross();

  cross.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();                       // not also a drag of the sash underneath
    const x0 = e.clientX, y0 = e.clientY;
    const left0 = _leftNow(), tl0 = _tlNow();
    document.body.classList.add('mv3-resize-xy');
    const move = (ev) => {
      _applyLeft(left0 + (ev.clientX - x0));
      // The timeline hangs off the bottom, so it GROWS as the pointer goes up.
      _applyTl(tl0 - (ev.clientY - y0));
      _placeCross();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('mv3-resize-xy');
      _save();
      _placeCross();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  cross.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    _applyLeft(_defLeft());
    _applyTl(DEF_TL_H);
    _save();
    _placeCross();
  });
}

// Both sizes, written together: the crossing moves both, and saving one of them would
// leave the next reload with half of the arrangement.
function _save() {
  try {
    localStorage.setItem(LS_LEFT_W, String(Math.round(_leftNow())));
    localStorage.setItem(LS_TL_H, String(Math.round(_tlNow())));
  } catch (e) { /* a private window */ }
}

export function initLayout() {
  let open = null;
  try { open = localStorage.getItem(LS_OPEN); } catch (e) {}
  setOpenColumn(open === 'inspector' ? 'inspector' : 'library');

  _applyLeft(_num(LS_LEFT_W, _defLeft()));
  _applyTl(_num(LS_TL_H, DEF_TL_H));

  // A collapsed column is one big button. Clicking the open one does nothing on
  // purpose - collapsing it would leave the left side with no panel at all.
  document.querySelectorAll('.mv3-col').forEach(col => {
    col.addEventListener('click', () => {
      if (col.classList.contains('is-collapsed')) setOpenColumn(col.dataset.col);
    });
  });

  _wireSash(document.getElementById('mv3-sash-v'), {
    axis: 'x', sign: 1,
    get: _leftNow, set: (px) => { _applyLeft(px); _placeCross(); },
    reset: () => { _applyLeft(_defLeft()); _placeCross(); },
    save: () => { try { localStorage.setItem(LS_LEFT_W, String(Math.round(_leftNow()))); } catch (e) {} },
  });

  _wireSash(document.getElementById('mv3-sash-h'), {
    axis: 'y', sign: -1,
    get: _tlNow, set: (px) => { _applyTl(px); _placeCross(); },
    reset: () => { _applyTl(DEF_TL_H); _placeCross(); },
    save: () => { try { localStorage.setItem(LS_TL_H, String(Math.round(_tlNow()))); } catch (e) {} },
  });

  _wireCross();

  // Re-clamp when the window changes, or a size that fitted yesterday's window
  // squeezes today's preview to nothing. The crossing follows whatever that leaves.
  window.addEventListener('resize', () => { _applyLeft(_leftNow()); _applyTl(_tlNow()); _placeCross(); });
}
