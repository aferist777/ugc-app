// The top nav strip, shared by the pages built new (Scenarios v3, Library).
//
// Plain links, so cross-page navigation needs no router: this page hosts one tab and
// every other entry is a different URL. Two things are done here rather than in the
// markup:
//
//   • which entry is lit is read from the ADDRESS, not hardcoded. The page answers on
//     /scenarios-v3 today and on /scenarios after the swap, and a hardcoded class would
//     light the wrong one the day that changes.
//   • the Admin entry, on a page whose strip leaves it out.

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

// The Admin entry - API keys, Import / Export - on a page whose strip does not carry one already.
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
}
