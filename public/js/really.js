/* ═══════════════════════════════════════════════════════════════════════════
   "REALLY?" - ONE FORM OF THE SECOND PRESS.

   A button that deletes, or spends money again, asks with itself: the first press ARMS it, the second does it. Armed it
   says "Really?" (a short addition after a dot when it says how much goes: "Really? · 2 keys"); a delete arms as the
   shared part's red fill (`.u-btn.is-danger.is-armed`), a paid press as a light step (`.u-btn.is-armed`) with its own
   words ("$0.42 · go?"). It lets go by itself after 3 s, on Escape (a layer of js/layers.js, not modal - the page's keys
   go on working), and, given a `host`, when the pointer leaves it.

     twoPress(btn, { go, paid, text, extra, ms, host, armed, rest })
       go(e)       the second press
       paid        a paid press: the light step, not the red fill
       text        the armed words (default "Really?")
       extra()     -> Promise<words> said after " · " once known ('' - nothing)
       ms          how long it stays armed (default 3000; 0 - until pressed again or let go)
       host        an element whose pointerleave lets go (a tile, a row)
       armed(b)    after arming;  rest(b) - after letting go (put the button's look back when it is not plain text)
     -> { letGo(), isArmed() }
   Pages whose button is drawn again from their own state (the project bar, highlights, Alerts, setup) keep their state
   and take only REALLY and MS from here.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from './layers.js';

export const REALLY = 'Really?';
export const MS = 3000;

export function twoPress(btn, o) {
  const opt = o || {};
  let timer = 0, layer = null, armed = false, seq = 0, saved = null;
  const letGo = () => {
    if (!armed) return;
    armed = false;
    seq++;
    clearTimeout(timer);
    timer = 0;
    if (layer) { Layers.close(layer); layer = null; }
    btn.classList.remove('is-armed');
    if (!opt.paid && saved && !saved.danger) btn.classList.remove('is-danger');
    if (saved) { btn.innerHTML = saved.html; if (saved.x) btn.classList.add('u-x'); }
    saved = null;
    if (typeof opt.rest === 'function') opt.rest(btn);
  };
  const arm = () => {
    armed = true;
    saved = { html: btn.innerHTML, danger: btn.classList.contains('is-danger'), x: btn.classList.contains('u-x') };
    btn.classList.remove('u-x');
    btn.classList.add('is-armed');
    if (!opt.paid) btn.classList.add('is-danger');
    btn.textContent = opt.text || REALLY;
    const ms = opt.ms === undefined ? MS : opt.ms;
    if (ms) timer = setTimeout(letGo, ms);
    layer = Layers.open(btn, { modal: false, onEsc: letGo, name: 'really' });
    if (typeof opt.armed === 'function') opt.armed(btn);
    if (typeof opt.extra === 'function') {
      const mine = ++seq;
      Promise.resolve().then(opt.extra).then((words) => {
        if (!armed || mine !== seq || !words) return;
        btn.textContent = (opt.text || REALLY) + ' · ' + words;
        if (ms) { clearTimeout(timer); timer = setTimeout(letGo, ms + 1000); }
      }).catch(() => {});
    }
  };
  btn.addEventListener('click', (e) => {
    if (btn.disabled) return;
    if (!armed) { e.preventDefault(); e.stopPropagation(); arm(); return; }
    letGo();
    if (typeof opt.go === 'function') opt.go(e);
  });
  if (opt.host) opt.host.addEventListener('pointerleave', letGo);
  return { letGo, isArmed: () => armed };
}
