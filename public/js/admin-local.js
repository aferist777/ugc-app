/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN -> THIS COMPUTER: speech recognition here (phase K1b, the owner 2026-10-03).

   Captions are heard by Groq; when Groq cannot be asked, or a subtitle lane says "this computer", the
   app hears the sound itself (lib/whisper-local.js). This pane says what that needs and lets it be
   fetched or let go of:

     the program      whisper.cpp with OpenBLAS - ships with the app (npm install), nothing to do here
     the model        574 MB - the first local recognition downloads it anyway; here it can be done ahead
     (phase V23, the owner 2026-10-09) no field about the graphics card - another computer has another one

   GET /api/speech/local is read when the pane shows, and every second while something downloads.

   (phase V27, the owner 2026-10-12: "давай добавим строку на всякий случай") and the yt-dlp links are
   read with: its version, whose copy it is, what the last check for a newer nightly build found, and a
   button to check now - the checks run on their own anyway (lib/ytdlp.js). GET /api/ytdlp.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  var body = document.getElementById('loc-body');
  if (!body) return;
  var state = null, timer = null, shown = false, msg = '', msgErr = false, armed = null;
  var yt = null, ytBusy = false, ytTimer = null;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function mb(b) { return Math.round((+b || 0) / 1e6) + ' MB'; }

  function row(title, sub, right) {
    var r = el('div', 'loc-row');
    var l = el('div', 'dio-lbl');
    l.appendChild(el('b', null, title));
    if (sub) l.appendChild(el('i', null, sub));
    r.appendChild(l);
    if (right) r.appendChild(right);
    return r;
  }
  function bar(dl) {
    var w = el('div', 'loc-prog');
    var b = el('div', 'dio-bar'); var i = el('i'); i.style.width = Math.floor(100 * dl.got / Math.max(1, dl.total)) + '%'; b.appendChild(i);
    w.appendChild(b);
    w.appendChild(el('div', 'dio-now', Math.floor(100 * dl.got / Math.max(1, dl.total)) + '% of ' + mb(dl.total)));
    return w;
  }
  function btn(label, fn, go) { var b = el('button', 'lib-btn' + (go ? ' adm-go' : ''), label); b.type = 'button'; b.addEventListener('click', fn); return b; }
  // Two presses for a delete: the first arms it for three seconds.
  function del(what) {
    var b = btn(armed === what ? 'Really delete?' : 'Delete', function () {
      if (armed !== what) { armed = what; paint(); setTimeout(function () { if (armed === what) { armed = null; paint(); } }, 3000); return; }
      armed = null;
      post('/api/speech/local/remove', what);
    });
    if (armed === what) b.classList.add('loc-armed');
    return b;
  }

  function post(url, what) {
    msg = ''; msgErr = false;
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ what: what }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.state) state = d.state;
        if (!d || !d.success) { msg = (d && d.error) || 'It did not work.'; msgErr = true; }
        paint(); schedule();
      })
      .catch(function (e) { msg = e.message; msgErr = true; paint(); });
  }

  // ── yt-dlp ─────────────────────────────────────────────────────────────────
  var COPY = {
    app: 'The copy that ships with the app.',
    library: 'A newer copy, updated into this library\'s cache - the app\'s own is older.',
    machine: 'Found on this computer, not the app\'s own - it is updated where it was installed.',
    env: 'The one YTDLP_PATH points at.',
  };
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function ytLast(s) {
    if (!s.checkedAt) return 'Not checked yet - the app checks 15 seconds after it starts and once a day.';
    var at = 'Checked ' + when(s.checkedAt) + ': ';
    if (s.result === 'updated') return at + 'updated from ' + s.from + ' to ' + s.to + '.';
    if (s.result === 'newest') return at + 'this is the newest nightly build.';
    return at + (s.result === 'skipped' ? '' : 'the check failed - ') + (s.error || 'no reason given') + '.';
  }
  // (Home, the owner 2026-10-22: "hide" puts the First steps away for good, and they come back from here.) The flag is the
  // Home page's own (localStorage, mirrored into the library by js/storage-sync.js): taken off here and in the library.
  var STEPS_HIDDEN = 'ugc_home_steps_hidden_v1';
  function paintHome() {
    var hidden = false;
    try { hidden = JSON.parse(localStorage.getItem(STEPS_HIDDEN) || 'false') === true; } catch (e) { hidden = false; }
    body.appendChild(el('div', 'dio-sec', 'Home'));
    body.appendChild(row('First steps', hidden ? 'Hidden on Home - show them there again.' : 'Shown on Home until you hide them there.',
      hidden ? btn('Show again', function () {
        try { localStorage.removeItem(STEPS_HIDDEN); } catch (e) { /* a private window */ }
        fetch('/api/ui-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ set: {}, del: [STEPS_HIDDEN] }) }).catch(function () {});
        paint();
      }) : el('span', 'loc-state', 'shown')));
  }

  function paintYt() {
    body.appendChild(el('div', 'dio-sec', 'Links (yt-dlp)'));
    if (!yt) { body.appendChild(el('div', 'dio-status', 'reading…')); return; }
    if (yt.probing) { body.appendChild(el('div', 'dio-status', 'Looking for yt-dlp…')); return; }
    if (!yt.available) {
      body.appendChild(row('yt-dlp', 'Missing from this copy of the app - npm install puts it in vendor/yt-dlp. Links cannot be read.',
        el('span', 'loc-state bad', 'missing')));
      return;
    }
    var busy = ytBusy || yt.checking;
    var b = btn(busy ? 'Checking…' : 'Check now', ytCheck);
    b.disabled = busy;
    b.title = 'Ask GitHub for a newer nightly build now. The app does this by itself anyway.';
    body.appendChild(row('yt-dlp ' + yt.version + ' · ' + yt.channel,
      (COPY[yt.copy] || '') + ' Links from YouTube, TikTok, Instagram and the rest are read with it, without a login. ' + ytLast(yt), b));
  }
  function ytLoad() {
    return fetch('/api/ytdlp').then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.success) yt = d; paint(); ytSchedule(); })
      .catch(function () { /* the next look tries again */ });
  }
  // While a check runs on its own (or a probe is slow), the row is read again until it ends.
  function ytSchedule() {
    if (ytTimer) clearTimeout(ytTimer);
    ytTimer = null;
    if (!shown || ytBusy || !yt || !(yt.checking || yt.probing)) return;
    ytTimer = setTimeout(ytLoad, 2000);
  }
  function ytCheck() {
    if (ytBusy) return;
    ytBusy = true; paint();
    fetch('/api/ytdlp/check', { method: 'POST' }).then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.success) yt = d; })
      .catch(function () { /* the row says what the last check found */ })
      .then(function () { ytBusy = false; paint(); ytSchedule(); });
  }

  function paint() {
    body.textContent = '';
    if (!state) { body.appendChild(el('div', 'dio-status', 'reading…')); paintYt(); paintHome(); return; }
    if (!state.platform) {
      body.appendChild(el('div', 'dio-status', 'Recognition on this computer is built for Windows - captions are heard by Groq here.'));
      paintYt(); paintHome();
      return;
    }
    var p = state.program, m = state.model;

    body.appendChild(el('div', 'dio-sec', 'The program'));
    body.appendChild(row('whisper.cpp ' + p.version + ' · OpenBLAS', p.present
      ? 'Ships with the app. Captions use it when Groq cannot be asked, or when a subtitle lane is set to "this computer".'
      : 'Missing from this copy of the app - npm install puts it in vendor/whisper.',
    el('span', 'loc-state ' + (p.present ? 'ok' : 'bad'), p.present ? 'installed' : 'missing')));

    body.appendChild(el('div', 'dio-sec', 'The speech model'));
    var mright;
    if (m.downloading) mright = bar(m.downloading);
    else if (m.present) mright = del('model');
    else if (m.partial) mright = btn('Continue the download (' + mb(m.bytes - m.partial) + ' left)', function () { post('/api/speech/local/download', 'model'); }, true);
    else mright = btn('Download (' + mb(m.bytes) + ')', function () { post('/api/speech/local/download', 'model'); }, true);
    body.appendChild(row(m.name + ' · ' + mb(m.bytes), m.present
      ? 'Downloaded into this library\'s cache - recognition here needs no internet.'
      : (m.error ? 'The last download failed: ' + m.error : 'Not downloaded yet. The first recognition on this computer downloads it anyway; here it can be done ahead of time.'),
    mright));

    // (phase V23, the owner 2026-10-09) No field about the graphics card: another computer has another one. A build for
    // NVIDIA cards already fetched is still used by the server when a card answers (lib/whisper-local.js).
    if (state.busy) body.appendChild(el('div', 'dio-status', 'Captions are being heard on this computer right now.'));
    var s = el('div', 'dio-status' + (msgErr ? ' err' : ''), msg);
    body.appendChild(s);
    paintYt(); paintHome();
  }

  function load() {
    return fetch('/api/speech/local').then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.success) state = d.state; paint(); })
      .catch(function () { /* the next look tries again */ });
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!shown || !state || !(state.model.downloading || state.cuda.downloading)) return;
    timer = setTimeout(function () { load().then(schedule); }, 1000);
  }

  document.addEventListener('adm-pane', function (e) {
    shown = e.detail === 'local';
    if (shown) { load().then(schedule); ytLoad(); }
    else {
      if (timer) { clearTimeout(timer); timer = null; }
      if (ytTimer) { clearTimeout(ytTimer); ytTimer = null; }
    }
  });
})();
