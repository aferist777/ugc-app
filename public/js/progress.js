// GENERATION PROGRESS — the app's house style for anything slow enough to wait through.
//
// The target sits behind a blur, a spinner and a label on top, a progress bar, and a countdown
// that learns from how long the same kind of job took before. Whoever opens it locks their own
// controls. Styles live in css/gen-progress.css - a page that uses this must load it.
//
// The countdown is an EMA kept in ui-state, so the second run of a given job already shows a
// believable estimate instead of a bare spinner.
//
// It lives in js/ rather than in one page's folder because three of them import it - Character,
// the Library (the scenario generator) and Merge - and a page reaching sideways into another
// page's folder to get it.

const EMA_KEY = 'sv3_gen_ema_v1';
const EMA_ALPHA = 0.35;
const FALLBACK_MS = 45000;

function _emaAll() {
  try { return JSON.parse(localStorage.getItem(EMA_KEY) || '{}') || {}; } catch (e) { return {}; }
}
// `hint` is what the CALLER knows about this kind of job before any of them has been
// timed. Without it the first run of a slow job counts down from 45s, reaches zero and
// sits on "finishing…" for minutes — which reads as a job that died, not one still going.
function _emaGet(label, hint) {
  const v = +(_emaAll()[label] || 0);
  if (v > 0) return v;
  return (+hint > 0) ? +hint : FALLBACK_MS;
}
function _emaPut(label, ms) {
  if (!(ms > 0)) return;
  const all = _emaAll();
  const prev = +(all[label] || 0);
  all[label] = prev > 0 ? Math.round(prev * (1 - EMA_ALPHA) + ms * EMA_ALPHA) : Math.round(ms);
  try { localStorage.setItem(EMA_KEY, JSON.stringify(all)); } catch (e) {}
}

// host: the element the overlay covers. Its existing content is blurred in place
// rather than covered by a second copy of the image — that way the blur matches
// whatever the host was actually showing, at its real size.
// `startedAt` lets an overlay be RE-attached to a job that is already running —
// its bar and countdown then reflect the real elapsed time instead of restarting
// from zero. Used when a popup is closed mid-generation and opened again.
// A way out, offered only once waiting has stopped being normal.
//
// The thresholds are the LEARNED estimate, not a number in minutes. This overlay already knows
// how long this kind of job usually takes - it keeps an EMA per label - so "longer than usual"
// is a thing it can say honestly, and it recalibrates as the models get quicker or slower. A
// fixed ten minutes would be wrong on both sides: an eternity for a job that normally takes
// forty seconds, and hasty for one that takes eight minutes.
const CANCEL_AT = 1.4;      // past this, waiting is unusual: offer the way out
const STUCK_AT  = 3;        // past this, it is not going to arrive on its own
const OVER_NOTE  = 'Longer than usual - it may still be rendering.';
// Deliberately not "check for banned words". Now that a refusal is read correctly it comes back
// within seconds with its own reason, so a job still going at three times its estimate is stuck
// rather than rejected - and saying otherwise would send the user editing text that is fine.
const STUCK_NOTE = 'Well past normal. A refusal would have been reported by now, so this looks '
  + 'stuck rather than rejected - canceling and rendering again is safe.';

export function startProgress(host, { label, total = 1, startedAt = 0, estimateMs = 0, onCancel = null } = {}) {
  if (!host) return { tick() {}, step() {}, finish() {}, fail() {}, detach() {} };

  const est = _emaGet(label, estimateMs);
  const t0 = startedAt || Date.now();
  let done = 0;
  let closed = false;

  // The overlay is absolutely positioned, so the host must be a positioning
  // context — otherwise inset:0 escapes to the nearest positioned ancestor and
  // the overlay covers the whole screen.
  const hadStatic = getComputedStyle(host).position === 'static';
  if (hadStatic) host.style.position = 'relative';
  host.classList.add('sv3-blur');

  const ov = document.createElement('div');
  ov.className = 'sv3-gen-ov';
  const card = document.createElement('div');
  card.className = 'sv3-gen-card';
  card.innerHTML = `
    <div class="sv3-gen-spin"></div>
    <div class="sv3-gen-label"></div>
    <div class="sv3-gen-bar"><i></i></div>
    <div class="sv3-gen-eta"></div>`;
  ov.appendChild(card);
  host.appendChild(ov);

  const elLabel = card.querySelector('.sv3-gen-label');
  const elBar   = card.querySelector('.sv3-gen-bar > i');
  const elEta   = card.querySelector('.sv3-gen-eta');
  elLabel.textContent = label || 'Working…';

  // Built only when the caller has something for it to do, and hidden until the wait is
  // actually unusual - a cancel button offered at second three invites canceling a healthy job.
  let elNote = null, elCancel = null;
  if (onCancel) {
    elNote = document.createElement('div');
    elNote.className = 'sv3-gen-note';
    elCancel = document.createElement('button');
    elCancel.type = 'button';
    elCancel.className = 'sv3-gen-cancel u-btn is-s';
    elCancel.textContent = 'Cancel';
    elCancel.hidden = true;
    elCancel.addEventListener('click', (e) => {
      e.stopPropagation();
      elCancel.disabled = true;
      elCancel.textContent = 'Canceling…';
      try { onCancel(); } catch (err) { console.error('[sv3] cancel', err); }
    });
    card.appendChild(elNote);
    card.appendChild(elCancel);
  }

  // Eases toward 95% over the estimate, so it never sits at 100% while waiting.
  const paint = () => {
    if (closed) return;
    const elapsed = Date.now() - t0;
    const share = total > 1 ? done / total : 0;
    const timed = Math.min(0.95, elapsed / Math.max(1, est));
    const pct = Math.max(share, timed) * 100;
    elBar.style.width = pct.toFixed(1) + '%';
    const left = Math.round((est - elapsed) / 1000);
    // Past the estimate the countdown stops pretending and starts counting UP. A frozen
    // "finishing…" is indistinguishable from a job that has quietly died, and a slow
    // model will sit there for minutes.
    const tail = left > 0 ? '~' + left + 's'
      : elapsed > est * CANCEL_AT ? `still working · ${Math.round(elapsed / 1000)}s`
      : 'finishing…';
    elEta.textContent = total > 1 ? `${done}/${total} · ${tail}` : tail;
    // The same moment the countdown admits it is over its estimate is the moment a way out
    // becomes reasonable. One threshold, one story.
    if (elCancel) {
      const over = elapsed > est * CANCEL_AT;
      elCancel.hidden = !over;
      elNote.textContent = !over ? '' : (elapsed > est * STUCK_AT ? STUCK_NOTE : OVER_NOTE);
    }
  };
  paint();
  const timer = setInterval(paint, 500);

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    try { ov.remove(); } catch (e) {}
    host.classList.remove('sv3-blur');
    if (hadStatic) host.style.position = '';
  };

  return {
    // one unit of a multi-task job completed
    step() { done = Math.min(total, done + 1); paint(); },
    tick(text) { if (!closed && text) elLabel.textContent = text; },
    finish() { _emaPut(label, Date.now() - t0); close(); },
    // Give up the overlay WITHOUT recording a timing: the job is still running, only
    // its host is going away. Skipping the EMA matters — a detach is not a duration.
    detach() { close(); },
    fail(msg) {
      if (closed) return;
      clearInterval(timer);
      card.querySelector('.sv3-gen-spin').style.display = 'none';
      elLabel.textContent = msg || 'Generation failed';
      elLabel.classList.add('err');
      elEta.textContent = 'click to dismiss';
      ov.style.cursor = 'pointer';
      // dismissing must also lift the blur and the positioning tweak
      ov.addEventListener('click', () => {
        try { ov.remove(); } catch (e) {}
        host.classList.remove('sv3-blur');
        if (hadStatic) host.style.position = '';
        // Pages usually show the SAME failure a second time, in their own error block, and
        // dismissing the overlay left that one sitting there - one press, half the error
        // gone. Announced rather than called back, so this stays ignorant of who listens.
        try {
          host.dispatchEvent(new CustomEvent('sv3-progress-dismissed', { bubbles: true }));
        } catch (e) {}
      }, { once: true });
      closed = true;
    },
  };
}

// The same countdown, laid out as a single row instead of an overlay — for a strip like a
// popup footer, where a blurred host and a stacked card would not fit. It shares the EMA
// store with startProgress, so a job timed here teaches the overlay version too and the
// other way round.
// `key` separates WHAT IS BEING TIMED from what is written on the row. The label is a sentence
// for a human ("Finding topics in 82k of transcript"); the key is what makes two runs comparable
// ("l2-topics|80k"). Left out, they are the same thing - which is right when the label is fixed.
// `startedAt` re-attaches the row to a job already running, as startProgress does: the bar and the
// countdown start from its real age, and finish() times the whole job, not the part watched.
// `onCancel`, when given, puts a ✕ at the right end of the row (phase G1, the Library's generator):
// pressing it calls onCancel once, and the row says "canceling…" until its owner closes it. Rows
// without it are as they always were.
export function startInlineProgress(host, { label, key, estimateMs = 0, startedAt = 0, onCancel = null } = {}) {
  if (!host) return { finish() {}, fail() {}, detach() {}, say() {} };
  const emaKey = key || label;
  const est = _emaGet(emaKey, estimateMs);
  const t0 = startedAt || Date.now();
  let closed = false;

  const row = document.createElement('div');
  row.className = 'sv3-inline-prog';
  row.innerHTML = `
    <span class="sv3-inline-spin"></span>
    <span class="sv3-inline-label"></span>
    <span class="sv3-inline-bar"><i></i></span>
    <span class="sv3-inline-eta"></span>`;
  row.querySelector('.sv3-inline-label').textContent = label || 'Working…';
  if (typeof onCancel === 'function') {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'sv3-inline-x u-btn is-s is-icon is-quiet is-del u-x';
    x.title = 'Cancel - what was already sent is paid for';
    x.setAttribute('aria-label', 'Cancel');
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      if (closed || x.disabled) return;
      x.disabled = true;
      row.querySelector('.sv3-inline-label').textContent = 'canceling…';
      try { onCancel(); } catch (err) { /* the owner says what happened */ }
    });
    row.appendChild(x);
  }
  host.appendChild(row);

  const bar = row.querySelector('.sv3-inline-bar > i');
  const eta = row.querySelector('.sv3-inline-eta');
  const paint = () => {
    if (closed) return;
    const elapsed = Date.now() - t0;
    bar.style.width = (Math.min(0.95, elapsed / Math.max(1, est)) * 100).toFixed(1) + '%';
    const left = Math.round((est - elapsed) / 1000);
    // Past the estimate it counts UP rather than freezing on "finishing" — a stuck label is
    // indistinguishable from a job that died.
    eta.textContent = left > 0 ? '~' + left + 's'
      : elapsed > est * 1.4 ? `still working · ${Math.round(elapsed / 1000)}s`
      : 'finishing…';
  };
  paint();
  const timer = setInterval(paint, 500);
  const close = () => { if (closed) return; closed = true; clearInterval(timer); try { row.remove(); } catch (e) {} };

  return {
    finish() { _emaPut(emaKey, Date.now() - t0); close(); },
    detach() { close(); },      // the job runs on; only its row goes away
    // Re-word the row mid-job (a per-item counter) without disturbing the estimate,
    // which is of the WHOLE job and keyed by the label passed at the start.
    say(text) { if (!closed) row.querySelector('.sv3-inline-label').textContent = text; },
    fail(msg) {
      if (closed) return;
      clearInterval(timer);
      row.querySelector('.sv3-inline-spin').style.display = 'none';
      row.querySelector('.sv3-inline-label').textContent = msg || 'Failed';
      row.querySelector('.sv3-inline-label').classList.add('err');
      eta.textContent = '';
      // Nothing left to cancel: a cross that stayed would look live and do nothing.
      const x = row.querySelector('.sv3-inline-x');
      if (x) x.remove();
      closed = true;
    },
  };
}

// Disable a set of controls for the duration of a job, restoring exactly the
// ones that were enabled to begin with.
export function lockControls(nodes) {
  const touched = [];
  nodes.filter(Boolean).forEach(n => { if (!n.disabled) { n.disabled = true; touched.push(n); } });
  return () => touched.forEach(n => { n.disabled = false; });
}
