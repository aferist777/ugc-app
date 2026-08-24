// Import / Export — the popup behind the gear in Brains.
//
// It sits ABOVE Brains rather than replacing it: Brains is where the keys live and this is a
// different errand, but it is reached from there, so leaving it open underneath keeps the way
// back obvious. .dio-ov carries a z-index above .brain-ov for exactly that reason.
//
// THE DOWNLOAD IS A PLAIN LINK, never fetch(). A fetched archive would have to be held in the
// tab's memory before it could be saved - gigabytes of it - and a connection that dies takes
// the lot with it. Handed to the browser as an ordinary href it goes through the download
// manager, which resumes on its own because the server answers Range requests.
(function () {
'use strict';

const $ = (id) => document.getElementById(id);
const MB = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB'
                 : b >= 1048576 ? (b / 1048576).toFixed(0) + ' MB'
                 : (b / 1024).toFixed(0) + ' KB');

let _groups = [];
let _poll = null;

function _el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function _picked() {
  return _groups.filter(g => $('dio-g-' + g.id) && $('dio-g-' + g.id).checked);
}

// The total is the honest one: it counts what a dependency will drag in even when its own box
// is unticked, because that is what will actually be built.
function _effective() {
  const ids = new Set(_picked().map(g => g.id));
  for (const g of _picked()) for (const n of (g.needs || [])) ids.add(n);
  return _groups.filter(g => ids.has(g.id));
}

function _retotal() {
  const eff = _effective();
  const bytes = eff.reduce((n, g) => n + g.bytes, 0);
  const files = eff.reduce((n, g) => n + g.files, 0);
  $('dio-total').textContent = eff.length
    ? `${eff.length} groups · ${files.toLocaleString()} files · ${MB(bytes)}`
    : 'nothing selected';

  // Say what is being pulled in, rather than quietly adding it to the number above.
  const own = new Set(_picked().map(g => g.id));
  const pulled = _effective().filter(g => !own.has(g.id));
  const warn = $('dio-warn');
  warn.textContent = pulled.length
    ? 'Also included, because the selection needs it: ' + pulled.map(g => g.label).join(', ')
      + '. Projects store the PATH of a picture, never the picture.'
    : '';
  warn.hidden = !pulled.length;
}

function _renderGroups() {
  const host = $('dio-groups');
  host.textContent = '';
  for (const g of _groups) {
    const row = _el('label', 'dio-row');
    const box = _el('input');
    box.type = 'checkbox';
    box.id = 'dio-g-' + g.id;
    // Everything is worth taking except the credentials, which are a deliberate act.
    box.checked = !g.secret;
    box.addEventListener('change', _retotal);
    row.appendChild(box);

    const txt = _el('span', 'dio-lbl');
    txt.appendChild(_el('b', null, g.label));
    const sub = _el('i', null,
      `${g.files.toLocaleString()} files · ${MB(g.bytes)}`
      + (g.needs && g.needs.length ? ' · needs the media library' : ''));
    txt.appendChild(sub);
    row.appendChild(txt);

    if (g.secret) row.appendChild(_el('span', 'dio-tag', 'secrets'));
    else if (g.heavy) row.appendChild(_el('span', 'dio-tag', 'large'));
    host.appendChild(row);
  }
  _retotal();
}

async function _load() {
  $('dio-total').textContent = 'measuring…';
  try {
    const r = await fetch('/api/data/groups').then(x => x.json());
    _groups = r.groups || [];
    _renderGroups();
  } catch (e) {
    $('dio-total').textContent = 'could not read what is here: ' + e.message;
  }
}

function _stopPoll() { if (_poll) { clearInterval(_poll); _poll = null; } }

async function _startExport() {
  const groups = _picked().map(g => g.id);
  if (!groups.length) return;
  const btn = $('dio-export');
  btn.disabled = true;
  $('dio-link').hidden = true;
  $('dio-status').textContent = 'building…';

  let job;
  try {
    job = await fetch('/api/data/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups }),
    }).then(x => x.json());
    if (!job.success) throw new Error(job.error || 'refused');
  } catch (e) {
    $('dio-status').textContent = 'could not start: ' + e.message;
    btn.disabled = false;
    return;
  }

  _stopPoll();
  _poll = setInterval(async () => {
    let s;
    try { s = await fetch(`/api/data/export/${job.jobId}/status`).then(x => x.json()); }
    catch { return; }
    if (s.state === 'building') {
      const pct = s.total ? Math.min(99, Math.round(s.files / s.total * 100)) : 0;
      $('dio-status').textContent = `building… ${pct}% · ${s.files.toLocaleString()} of ${s.total.toLocaleString()} files · ${MB(s.bytes)}`;
      return;
    }
    _stopPoll();
    btn.disabled = false;
    if (s.state === 'failed') { $('dio-status').textContent = 'build failed: ' + (s.error || 'unknown'); return; }
    $('dio-status').textContent = `ready — ${MB(s.bytes)}. The link resumes if the connection drops, and stays valid for a day.`;
    const a = $('dio-link');
    a.href = `/api/data/export/${job.jobId}/download`;
    a.textContent = '⬇ ' + s.name;
    a.hidden = false;
  }, 1000);
}

async function _runImport(file) {
  const st = $('dio-imp-status');
  st.textContent = 'reading the archive…';
  const fd = new FormData();
  fd.append('file', file);
  fd.append('overwrite', $('dio-overwrite').checked ? 'true' : 'false');
  try {
    const r = await fetch('/api/data/import', { method: 'POST', body: fd }).then(x => x.json());
    if (!r.success) throw new Error(r.error || 'refused');
    st.textContent = `done — ${r.jsons} stores merged, ${r.files} files added, ${r.skipped} already here.`
      + (r.overwrite ? '' : ' Nothing was overwritten.');
  } catch (e) {
    st.textContent = 'import failed: ' + e.message;
  }
}

function openDataIO() {
  const ov = $('dio-ov');
  if (!ov) return;
  ov.hidden = false;
  _load();
}

function _close() {
  _stopPoll();
  const ov = $('dio-ov');
  if (ov) ov.hidden = true;
}

function initDataIO() {
  const ov = $('dio-ov');
  if (!ov) return;
  $('dio-close')?.addEventListener('click', _close);
  // The scrim closes; a click that began inside the panel must not fall through it.
  ov.addEventListener('click', (e) => { if (e.target === ov) _close(); });
  // Esc closes THIS one and leaves Brains where it was - it is the top layer, so it answers
  // first and stops the key travelling to whatever is underneath.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ov.hidden) { _close(); e.stopPropagation(); }
  }, true);

  $('dio-export')?.addEventListener('click', _startExport);
  $('dio-import')?.addEventListener('click', () => $('dio-file').click());
  $('dio-file')?.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) _runImport(f);
    e.target.value = '';
  });
}

// Classic script, so the gear in brain.js reaches this through the window rather than an
// import. One name only: opening is the whole of what anyone else needs.
window.openDataIO = openDataIO;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initDataIO);
else initDataIO();
})();
