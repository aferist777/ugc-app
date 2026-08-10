// Scenarios v3 — the page's own nav strip.
//
// Plain links, so cross-page navigation needs no router: this page hosts one tab and
// every other entry is a different URL. Two things are done here rather than in the
// markup:
//
//   • which entry is lit is read from the ADDRESS, not hardcoded. The page answers on
//     /scenarios-v3 today and on /scenarios after the swap, and a hardcoded class would
//     light the wrong one the day that changes.
//   • the balance chip. The other pages get it from utils.js, a grab-bag that also
//     wants #status-bar and #lightbox to exist; one fetch is cheaper than dragging it in.

const REFRESH_MS = 60000;

function _lightCurrent(nav) {
  const here = location.pathname.replace(/\/+$/, '') || '/';
  let best = null, bestLen = -1;
  nav.querySelectorAll('a[href]').forEach(a => {
    a.classList.remove('cur');
    const p = (a.getAttribute('href') || '').replace(/\/+$/, '');
    // longest matching prefix wins, so /scenarios-v3 beats /scenarios on its own page
    if (p && (here === p || here.indexOf(p + '/') === 0) && p.length > bestLen) { best = a; bestLen = p.length; }
  });
  if (best) best.classList.add('cur');
}

async function _paintBalance(el) {
  try {
    const d = await fetch('/api/balance').then(r => r.json());
    if (!d || !d.success) return;
    el.textContent = `${d.credits} cr · $${(+d.dollars || 0).toFixed(2)}`;
    el.title = 'Replicate balance';
  } catch (e) { /* a missing balance is not worth a visible error on this page */ }
}

export function initNav() {
  const nav = document.querySelector('.sv3-nav');
  if (!nav) return;
  _lightCurrent(nav);
  const bal = nav.querySelector('#sv3-balance');
  if (bal) { _paintBalance(bal); setInterval(() => _paintBalance(bal), REFRESH_MS); }
}
