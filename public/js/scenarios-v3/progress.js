// Scenarios v3 — generation progress overlay, shared by every paid path.
//
// House style for media generation: the target sits behind a blur, a spinner and
// a label on top, a progress bar, and a countdown that learns from how long the
// same kind of job took before. Whoever opens it locks their own controls.
//
// The countdown is an EMA per label kept in ui-state, so the second run of a
// given job already shows a believable estimate instead of a bare spinner.

const EMA_KEY = 'sv3_gen_ema_v1';
const EMA_ALPHA = 0.35;
const FALLBACK_MS = 45000;

function _emaAll() {
  try { return JSON.parse(localStorage.getItem(EMA_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function _emaGet(label) {
  const v = +(_emaAll()[label] || 0);
  return v > 0 ? v : FALLBACK_MS;
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
export function startProgress(host, { label, total = 1, startedAt = 0 } = {}) {
  if (!host) return { tick() {}, step() {}, finish() {}, fail() {}, detach() {} };

  const est = _emaGet(label);
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

  // Eases toward 95% over the estimate, so it never sits at 100% while waiting.
  const paint = () => {
    if (closed) return;
    const elapsed = Date.now() - t0;
    const share = total > 1 ? done / total : 0;
    const timed = Math.min(0.95, elapsed / Math.max(1, est));
    const pct = Math.max(share, timed) * 100;
    elBar.style.width = pct.toFixed(1) + '%';
    const left = Math.round((est - elapsed) / 1000);
    elEta.textContent = total > 1
      ? `${done}/${total} · ${left > 0 ? '~' + left + 's' : 'finishing…'}`
      : (left > 0 ? '~' + left + 's' : 'finishing…');
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
      }, { once: true });
      closed = true;
    },
  };
}

// Freeze a whole subtree while a job runs: nothing inside can be clicked, and
// the caller decides what stays live (the progress overlay opts back in via CSS).
export function freeze(el) {
  if (!el) return () => {};
  el.classList.add('sv3-frozen');
  return () => el.classList.remove('sv3-frozen');
}

// Disable a set of controls for the duration of a job, restoring exactly the
// ones that were enabled to begin with.
export function lockControls(nodes) {
  const touched = [];
  nodes.filter(Boolean).forEach(n => { if (!n.disabled) { n.disabled = true; touched.push(n); } });
  return () => touched.forEach(n => { n.disabled = false; });
}
