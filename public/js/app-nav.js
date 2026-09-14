// The top nav strip, shared by the pages built new (Scenarios v3, Library).
//
// Plain links, so cross-page navigation needs no router: this page hosts one tab and
// every other entry is a different URL. Two things are done here rather than in the
// markup:
//
//   • which entry is lit is read from the ADDRESS, not hardcoded. The page answers on
//     /scenarios-v3 today and on /scenarios after the swap, and a hardcoded class would
//     light the wrong one the day that changes.
//   • the balance chip, wherever a page carries #sv3-balance - which is /admin alone now.
//     It is the kie.ai balance, an admin's number; on the work pages it was a reading
//     nobody could act on.
//   • the Admin entry, on a page whose strip leaves it out.

const REFRESH_MS = 60000;

function _lightCurrent(nav) {
  const here = location.pathname.replace(/\/+$/, '') || '/';
  let best = null, bestLen = -1;
  nav.querySelectorAll('a[href]').forEach(a => {
    a.classList.remove('cur');
    // `data-also` lets one entry own more than one address. The libraries are one place
    // with a picker inside them, not several destinations, so the nav says "Library" once
    // and stays lit on every one of them - without it a page whose link was removed from
    // the nav simply lights nothing.
    for (const raw of [a.getAttribute('href') || ''].concat((a.getAttribute('data-also') || '').split(/\s+/))) {
      const p = raw.replace(/\/+$/, '');
      // longest matching prefix wins, so /scenarios-v3 beats /scenarios on its own page
      if (p && (here === p || here.indexOf(p + '/') === 0) && p.length > bestLen) { best = a; bestLen = p.length; }
    }
  });
  if (best) best.classList.add('cur');
}

async function _paintBalance(el) {
  try {
    const d = await fetch('/api/balance').then(r => r.json());
    if (!d || !d.success) return;
    el.textContent = `${d.credits} cr · $${(+d.dollars || 0).toFixed(2)}`;
    // kie.ai, not Replicate: /api/balance reads kie's /api/v1/chat/credit (routes/misc.js)
    // and the dollars are an estimate derived from the credits. The label said Replicate on
    // all four pages that show this chip.
    el.title = 'kie.ai balance';
  } catch (e) { /* a missing balance is not worth a visible error on this page */ }
}

// The Admin entry - settings and API keys - on a page whose strip does not carry one already.
// There is one person and no sign-in, so there is nobody to hide it from.
function _adminLink(nav) {
  if (nav.querySelector('a[href="/admin"]')) return;
  const a = document.createElement('a');
  a.href = '/admin'; a.textContent = 'Admin';
  nav.appendChild(a);
}

export function initNav() {
  const nav = document.querySelector('.sv3-nav');
  if (!nav) return;
  _adminLink(nav);
  _lightCurrent(nav);
  const bal = nav.querySelector('#sv3-balance');
  if (bal) { _paintBalance(bal); setInterval(() => _paintBalance(bal), REFRESH_MS); }
}
