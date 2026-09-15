// Import / Export — the second tab on /admin.
//
// The library is measured the first time the tab is shown, not when the page loads: counting
// every file takes a moment on a large library, and most visits to /admin are about the keys.
// It is measured again after an import, which is the one thing here that changes the answer.
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
let _measured = false;

function _el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// A group's name without the explanation in brackets: 'Media library', 'Hooks'.
const _short = (id) => ((_groups.find(g => g.id === id) || {}).label || id).replace(/\s*\(.*$/, '');

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
      + (g.needs && g.needs.length ? ' · needs ' + g.needs.map(_short).join(' and ') : ''));
    txt.appendChild(sub);
    row.appendChild(txt);

    if (g.secret) row.appendChild(_el('span', 'dio-tag', 'secrets'));
    else if (g.heavy) row.appendChild(_el('span', 'dio-tag', 'large'));
    host.appendChild(row);
  }
  _retotal();
}

async function _load() {
  _measured = true;
  $('dio-total').textContent = 'measuring…';
  try {
    const r = await fetch('/api/data/groups').then(x => x.json());
    _groups = r.groups || [];
    _renderGroups();
  } catch (e) {
    _measured = false;
    $('dio-total').textContent = 'could not read what is here: ' + e.message;
  }
}

function _stopPoll() { if (_poll) { clearInterval(_poll); _poll = null; } }

// Durations read as a person would say them: seconds under a minute, minutes and seconds under
// an hour, hours and minutes above. "3661s" is a number; "1h 1m" is an answer.
function _dur(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + String(s % 60).padStart(2, '0') + 's';
  return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
}

// A row per volume: what it is called, how big, and a link once it exists. Built as the build
// progresses so the first volume can be downloading while the last is still being written.
function _renderParts(jobId, parts) {
  const host = $('dio-parts');
  host.innerHTML = '';
  for (const p of parts) {
    const row = document.createElement('div');
    row.className = 'dio-part';

    const n = document.createElement('span');
    n.className = 'dio-part-n';
    n.textContent = p.index + '/' + parts.length;
    row.appendChild(n);

    if (p.state === 'ready') {
      const a = document.createElement('a');
      a.className = 'lib-btn dio-dl';
      a.download = '';
      // A PLAIN LINK, never fetch(): a fetched volume would sit in memory before it could be
      // saved. Handed over as an href it goes through the browser's own download manager,
      // which is also what makes a dropped connection resumable.
      a.href = `/api/data/export/${jobId}/part/${p.index}/download`;
      a.textContent = '⬇ ' + p.name;
      row.appendChild(a);
      const sz = document.createElement('span');
      sz.className = 'dio-part-sz';
      sz.textContent = MB(p.bytes);
      row.appendChild(sz);
    } else {
      const t = document.createElement('span');
      t.className = 'dio-part-w';
      const pct = p.total ? Math.round(p.files / p.total * 100) : 0;
      t.textContent = p.state === 'building'
        ? `building… ${pct}% of ${MB(p.plannedBytes)}`
        : `queued · ${MB(p.plannedBytes)}`;
      row.appendChild(t);
    }
    host.appendChild(row);
  }
}

async function _startExport() {
  const groups = _picked().map(g => g.id);
  if (!groups.length) return;
  const btn = $('dio-export');
  btn.disabled = true;
  $('dio-parts').innerHTML = '';
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
    _renderParts(job.jobId, s.parts || []);
    if (s.state === 'building') {
      // Per cent by bytes, to agree with the estimate standing next to it.
      const pct = s.totalBytes ? Math.min(99, Math.round(s.bytes / s.totalBytes * 100)) : 0;
      const done = s.parts.filter(p => p.state === 'ready').length;
      $('dio-status').textContent =
        `building volume ${Math.min(done + 1, s.parts.length)} of ${s.parts.length}… ${pct}% · `
        + `${s.files.toLocaleString()} of ${s.total.toLocaleString()} files · `
        + `${MB(s.bytes)} of ${MB(s.totalBytes)} · ${_dur(s.elapsedMs)} elapsed`
        + (s.etaMs == null ? ' · estimating…' : ` · about ${_dur(s.etaMs)} left`);
      return;
    }
    _stopPoll();
    btn.disabled = false;
    if (s.state === 'failed') { $('dio-status').textContent = 'build failed: ' + (s.error || 'unknown'); return; }
    $('dio-status').textContent = `ready in ${_dur(s.elapsedMs)} — ${s.parts.length} volume(s), `
      + `${MB(s.bytes)} in all. Each one downloads and resumes on its own; bring them in together. Kept for a day.`;
  }, 1000);
}

// XMLHttpRequest, not fetch: fetch has no way to report how much of a request body has gone
// out, and a gigabyte moving with no feedback is indistinguishable from a hang.
function _upload(file, overwrite, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('overwrite', overwrite ? 'true' : 'false');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/data/import');
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    });
    // The upload finishes long before the answer does - the server still has to unpack it - so
    // the bar is pinned at full and the row says what is happening instead of looking stuck.
    xhr.upload.addEventListener('load', () => onProgress(file.size, file.size, true));
    xhr.addEventListener('load', () => {
      let d = null;
      try { d = JSON.parse(xhr.responseText); } catch {}
      if (!d) return reject(new Error('HTTP ' + xhr.status));
      if (!d.success) return reject(new Error(d.error || 'refused'));
      resolve(d);
    });
    xhr.addEventListener('error', () => reject(new Error('connection lost')));
    xhr.addEventListener('abort', () => reject(new Error('cancelled')));
    xhr.send(fd);
  });
}

function _logRow(mark, name, text, kind) {
  const row = document.createElement('div');
  row.className = 'dio-part' + (kind ? ' ' + kind : '');
  const m = document.createElement('span');
  m.className = 'dio-part-n';
  m.textContent = mark;
  const n = document.createElement('span');
  n.className = 'dio-part-w';
  n.textContent = name;
  const t = document.createElement('span');
  t.className = 'dio-part-sz';
  t.textContent = text;
  row.append(m, n, t);
  return row;
}

// Volumes go up one at a time. Two gigabyte uploads in parallel share the same pipe and both
// finish later than either would alone, and the server unpacks them serially regardless.
async function _runImport(files) {
  const st  = $('dio-imp-status');
  const log = $('dio-imp-log');
  const prog = $('dio-imp-prog');
  const barAll = $('dio-bar-all');
  const barOne = $('dio-bar-one');
  const now = $('dio-now');

  // part01 before part02: the names carry the order, and an alphabetical sort is the order.
  const list = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const totalBytes = list.reduce((n, f) => n + f.size, 0);
  let doneBytes = 0;
  let staged = 0, failed = 0;
  const overwrite = $('dio-overwrite').checked;

  log.innerHTML = '';
  prog.hidden = false;
  barAll.style.width = '0%';

  // First every volume goes up and is unpacked beside the library; nothing in the library changes
  // yet (routes/data-io.js says why).
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    st.textContent = `volume ${i + 1} of ${list.length}`;
    now.textContent = f.name;
    barOne.style.width = '0%';

    const row = _logRow('⟳', f.name, 'uploading…');
    log.appendChild(row);

    try {
      const r = await _upload(f, overwrite, (loaded, total, finished) => {
        barOne.style.width = Math.round(loaded / total * 100) + '%';
        barAll.style.width = Math.round((doneBytes + loaded) / totalBytes * 100) + '%';
        if (finished) row.lastChild.textContent = 'unpacking…';
      });
      staged++;
      row.className = 'dio-part ok';
      row.firstChild.textContent = '✓';
      // "Left out" is what has no place in a library: from a server-version archive, its
      // thumbnail cache and the folders the desktop app does not keep.
      row.lastChild.textContent = `part ${r.part} of ${r.parts} · ${r.files} files, ${r.stores} stores`
        + (r.leftOut ? ` · ${r.leftOut} left out` : '')
        + (r.fromServer ? ' · server version, paths translated' : '')
        + (r.fromLayout5 ? ' · older library, sorted into folders when merged' : '');
    } catch (e) {
      failed++;
      row.className = 'dio-part bad';
      row.firstChild.textContent = '✕';
      row.lastChild.textContent = e.message;
      // One bad volume does not stop the rest: the others are still merged.
    }

    doneBytes += f.size;
    barAll.style.width = Math.round(doneBytes / totalBytes * 100) + '%';
  }

  now.textContent = '';
  barOne.style.width = '0%';
  if (!staged) {
    st.textContent = `nothing came in - ${failed} volume(s) failed.`;
    return;
  }

  // Then what came up is merged into the library in one go.
  st.textContent = 'merging into the library…';
  const row = _logRow('⟳', 'merge', 'working…');
  log.appendChild(row);
  let d = null;
  try {
    const res = await fetch('/api/data/import/finish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overwrite }),
    });
    d = await res.json();
  } catch (e) {
    d = { success: false, error: e.message, sets: [] };
  }
  const sets = (d && d.sets) || [];
  const sum = (k) => sets.reduce((n, s) => n + (Number(s[k]) || 0), 0);
  const partial = sets.filter((s) => s.have < s.parts);
  row.className = 'dio-part ' + (d && d.success ? 'ok' : 'bad');
  row.firstChild.textContent = d && d.success ? '✓' : '✕';
  row.lastChild.textContent = d && d.success
    ? `${sum('projects')} projects added (${sum('projectsHere')} already here) · ${sum('timelines')} timelines · ${sum('categories')} categories`
    : (d && d.error) || 'the merge failed';
  st.textContent = `done — ${sum('files')} files added, ${sum('skipped')} already here, ${sum('stores')} stores merged`
    + (sum('setAside') ? `, ${sum('setAside')} files nothing used left out` : '')
    + (failed ? `, ${failed} volume(s) failed` : '')
    + (partial.length ? `. ${partial.map((s) => `${s.have} of ${s.parts} volumes`).join(', ')} came in - import the rest to complete the set` : '')
    + (overwrite ? '.' : '. Nothing was overwritten.');
  // What an export would take out has just changed.
  _load();
}

function initDataIO() {
  if (!$('dio-groups')) return;
  // The strip on /admin announces every pane it shows.
  document.addEventListener('adm-pane', (e) => { if (e.detail === 'data' && !_measured) _load(); });
  $('dio-export')?.addEventListener('click', _startExport);
  $('dio-import')?.addEventListener('click', () => $('dio-file').click());
  $('dio-file')?.addEventListener('change', (e) => {
    const files = e.target.files;
    if (files && files.length) _runImport(files);
    e.target.value = '';
  });
}

initDataIO();
})();
