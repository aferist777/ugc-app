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

// Who is signed in, appended to the strip: their nickname, an Admin entry when they have the
// role (and the page does not already carry one), and Sign out. Fetched rather than baked into
// each page, so the same markup serves everybody and the role decides.
async function _whoAmI(nav) {
  let me = null;
  try { me = (await fetch('/api/me').then(r => r.json())).user; } catch { return; }
  if (!me) return;
  const who = document.createElement('span');
  who.className = 'sv3-who';
  who.textContent = me.nickname;
  who.title = 'signed in as ' + me.login;
  nav.appendChild(who);
  if (me.role === 'admin' && !nav.querySelector('a[href="/admin"]')) {
    const a = document.createElement('a');
    a.href = '/admin'; a.textContent = 'Admin';
    nav.appendChild(a);
  }
  const out = document.createElement('a');
  out.href = '/logout'; out.textContent = 'Sign out'; out.className = 'sv3-out';
  nav.appendChild(out);
}

export function initNav() {
  const nav = document.querySelector('.sv3-nav');
  if (!nav) return;
  _lightCurrent(nav);
  _whoAmI(nav);
  const bal = nav.querySelector('#sv3-balance');
  if (bal) { _paintBalance(bal); setInterval(() => _paintBalance(bal), REFRESH_MS); }
}
