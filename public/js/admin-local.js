/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN -> THIS COMPUTER: speech recognition here.

   Captions are heard by Groq; when Groq cannot be asked, or a subtitle lane says "this computer", the
   app hears the sound itself (lib/whisper-local.js). This pane says what that needs and lets it be
   fetched or let go of:

     the program      whisper.cpp with OpenBLAS - ships with the app (npm install), nothing to do here
     the model        574 MB - the first local recognition downloads it anyway; here it can be done ahead

   GET /api/speech/local is read when the pane shows, and every second while something downloads.

   And the yt-dlp links are
   read with: its version, whose copy it is, what the last check for a newer nightly build found, and a
   button to check now - the checks run on their own anyway (lib/ytdlp.js). GET /api/ytdlp.
   ═══════════════════════════════════════════════════════════════════════════ */
import { t, lang } from './i18n/t.js';

(function () {
  var body = document.getElementById('loc-body');
  if (!body) return;
  var state = null, timer = null, shown = false, msg = '', armed = null;
  var yt = null, ytBusy = false, ytTimer = null;
  var stateFailed = false, ytFailed = false;   // a read that failed, said in place of "reading…" for ever
  // A failure is a popup in the corner (js/notice.js); a part being read or not read is the
  // shared part (js/ui-state.js), brought in when first needed.
  function sayError(words, detail) { import('/js/notice.js').then(function (m) { m.showError(words, detail ? { detail: detail } : {}); }).catch(function () {}); }
  function stateEl(make) {
    var hold = document.createElement('div');
    import('/js/ui-state.js').then(function (m) { if (hold.isConnected) hold.replaceWith(make(m)); }).catch(function () {});
    return hold;
  }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function mb(b) { return t('{n} MB', { n: Math.round((+b || 0) / 1e6) }); }

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
    w.appendChild(el('div', 'dio-now', t('{pct}% of {size}', { pct: Math.floor(100 * dl.got / Math.max(1, dl.total)), size: mb(dl.total) })));
    return w;
  }
  function btn(label, fn, go) { var b = el('button', 'u-btn is-s' + (go ? ' adm-go is-main' : ''), label); b.type = 'button'; b.addEventListener('click', fn); return b; }
  // Two presses for a delete: the first arms it for three seconds.
  function del(what) {
    // one "Really?" (js/really.js's words, 3 s); a delete - the danger button, armed - its red fill
    var b = btn(armed === what ? t('Really?') : t('Delete'), function () {
      if (armed !== what) { armed = what; paint(); setTimeout(function () { if (armed === what) { armed = null; paint(); } }, 3000); return; }
      armed = null;
      post('/api/speech/local/remove', what);
    });
    b.classList.add('is-danger');
    if (armed === what) b.classList.add('is-armed');
    return b;
  }

  function post(url, what) {
    msg = '';
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ what: what }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.state) state = d.state;
        if (!d || !d.success) sayError(t('It did not work.'), (d && d.error) || '');
        paint(); schedule();
      })
      .catch(function (e) { sayError(t('It did not work.'), e.message); paint(); });
  }

  // ── UGC Studio itself ──────────────
  // An installed copy: its version, the channel, when it last asked, "Check now", the download as it goes, "Restart and
  // update" once a new version is laid down (desktop/updater.js; GET /api/app/update, POST /api/app/update/check).
  // A copy run from git: its version, and that its commits are what changes it.
  var appSt = null, appBusy = false, appTimer = null;
  function appLoad() {
    return fetch('/api/app/update').then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.success) appSt = d; paint(); appSchedule(); })
      .catch(function () { paint(); });
  }
  function appSchedule() {
    if (appTimer) clearTimeout(appTimer);
    appTimer = null;
    var u = appSt && appSt.updater;
    if (!shown || !u || !(appBusy || /^(checking|downloading|installing)$/.test(u.phase))) return;
    appTimer = setTimeout(appLoad, 1000);
  }
  function appCheck() {
    if (appBusy) return;
    appBusy = true; paint();
    fetch('/api/app/update/check', { method: 'POST' }).then(function (r) { return r.json(); })
      .then(function (d) { if (!d || !d.success) sayError(t('Updates were not checked'), (d && d.error) || t('no answer')); })
      .catch(function (e) { sayError(t('Updates were not checked'), e.message); })
      .then(function () { setTimeout(function () { appBusy = false; appLoad(); }, 1200); });
  }
  function paintApp() {
    body.appendChild(el('div', 'dio-sec', 'UGC Studio'));
    if (!appSt) return;
    var v = (appSt.program && appSt.program.version) || '';
    var u = appSt.updater;
    if (!u) {
      body.appendChild(row('UGC Studio ' + v, t('Run from the program folder - its commits are what changes it, and the chip "Updated" says so.'),
        el('span', 'loc-state', t('from git'))));
      return;
    }
    var right, sub;
    var ready = appSt.release || (u.phase === 'ready' ? { version: u.target } : null);
    if (u.phase === 'downloading') {
      right = bar({ got: u.done || 0, total: u.total || 0 });
      sub = t('Downloading UGC Studio {version} - the app goes on working.', { version: u.target });
    } else if (u.phase === 'installing') {
      right = el('span', 'loc-state', t('laying it out…'));
      sub = t('UGC Studio {version} is laid out beside this one.', { version: u.target });
    } else if (ready) {
      right = btn(t('Restart and update'), function () { if (window.ugcWindow && window.ugcWindow.restart) window.ugcWindow.restart(); }, true);
      sub = t('UGC Studio {version} is downloaded - restart to use it.', { version: ready.version });
    } else {
      var busy = appBusy || u.phase === 'checking';
      right = btn(busy ? t('Checking…') : t('Check now'), appCheck);
      right.disabled = busy || u.phase === 'off';
      sub = u.phase === 'off' ? u.error
        : u.phase === 'error' ? t('The last check: {why}', { why: u.error })
        : u.checkedAt ? t('Up to date · checked {when}.', { when: when(u.checkedAt) })
        : t('Not checked yet - the app asks a minute after it starts and every six hours.');
    }
    body.appendChild(row('UGC Studio ' + v + ' · ' + (u.channel || 'stable'), sub, right));
  }

  // ── yt-dlp ─────────────────────────────────────────────────────────────────
  var COPY = {
    app: t('The copy that ships with the app.'),
    library: t('A newer copy, updated into this library\'s cache - the app\'s own is older.'),
    machine: t('Found on this computer, not the app\'s own - it is updated where it was installed.'),
    env: t('The one YTDLP_PATH points at.'),
  };
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString(lang() === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function ytLast(s) {
    if (!s.checkedAt) return t('Not checked yet - the app checks 15 seconds after it starts and once a day.');
    var at = t('Checked {when}:', { when: when(s.checkedAt) }) + ' ';
    if (s.result === 'updated') return at + t('updated from {from} to {to}.', { from: s.from, to: s.to });
    if (s.result === 'newest') return at + t('this is the newest nightly build.');
    return at + (s.result === 'skipped' ? '' : t('the check failed - ')) + (s.error || t('no reason given')) + '.';
  }
  // Home's "hide" puts the First steps away for good, and they come back from here. The flag is the
  // Home page's own (localStorage, mirrored into the library by js/storage-sync.js): taken off here and in the library.
  var STEPS_HIDDEN = 'ugc_home_steps_hidden_v1';
  function paintHome() {
    var hidden = false;
    try { hidden = JSON.parse(localStorage.getItem(STEPS_HIDDEN) || 'false') === true; } catch (e) { hidden = false; }
    body.appendChild(el('div', 'dio-sec', t('Home')));
    body.appendChild(row(t('First steps'), hidden ? t('Hidden on Home - show them there again.') : t('Shown on Home until you hide them there.'),
      hidden ? btn(t('Show again'), function () {
        try { localStorage.removeItem(STEPS_HIDDEN); } catch (e) { /* a private window */ }
        fetch('/api/ui-state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ set: {}, del: [STEPS_HIDDEN] }) }).catch(function () {});
        paint();
      }) : el('span', 'loc-state', t('shown'))));
  }
  function paintYt() {
    body.appendChild(el('div', 'dio-sec', t('Links (yt-dlp)')));
    if (!yt) {
      body.appendChild(stateEl(function (m) { return ytFailed ? m.failedEl('yt-dlp', ytLoad, { line: true }) : m.loadingEl(t('reading…'), { line: true }); }));
      return;
    }
    if (yt.probing) { body.appendChild(stateEl(function (m) { return m.loadingEl(t('Looking for yt-dlp…'), { line: true }); })); return; }
    if (!yt.available) {
      body.appendChild(row('yt-dlp', t('Missing from this copy of the app - npm install puts it in vendor/yt-dlp. Links cannot be read.'),
        el('span', 'loc-state bad', t('missing'))));
      return;
    }
    var busy = ytBusy || yt.checking;
    var b = btn(busy ? t('Checking…') : t('Check now'), ytCheck);
    b.disabled = busy;
    b.title = t('Ask GitHub for a newer nightly build now. The app does this by itself anyway.');
    body.appendChild(row('yt-dlp ' + yt.version + ' · ' + yt.channel,
      (COPY[yt.copy] || '') + ' ' + t('Links from YouTube, TikTok, Instagram and the rest are read with it, without a login.') + ' ' + ytLast(yt), b));
  }
  function ytLoad() {
    return fetch('/api/ytdlp').then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.success) { yt = d; ytFailed = false; }
        else { ytFailed = !yt; sayError(t('Could not read yt-dlp'), (d && d.error) || t('no answer')); }
        paint(); ytSchedule();
      })
      .catch(function (e) { ytFailed = !yt; sayError(t('Could not read yt-dlp'), e.message); paint(); });
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
      .then(function (d) { if (d && d.success) yt = d; else sayError(t('yt-dlp was not checked'), (d && d.error) || t('no answer')); })
      .catch(function (e) { sayError(t('yt-dlp was not checked'), e.message); /* the row says what the last check found */ })
      .then(function () { ytBusy = false; paint(); ytSchedule(); });
  }

  function paint() {
    body.textContent = '';
    if (!state) {
      body.appendChild(stateEl(function (m) { return stateFailed ? m.failedEl(t('This computer'), load, { line: true }) : m.loadingEl(t('reading…'), { line: true }); }));
      paintApp(); paintYt(); paintHome();
      return;
    }
    if (!state.platform) {
      body.appendChild(el('div', 'dio-status', t('Recognition on this computer is built for Windows - captions are heard by Groq here.')));
      paintApp(); paintYt(); paintHome();
      return;
    }
    var p = state.program, m = state.model;

    body.appendChild(el('div', 'dio-sec', t('The program')));
    body.appendChild(row('whisper.cpp ' + p.version + ' · OpenBLAS', p.present
      ? t('Ships with the app. Captions use it when Groq cannot be asked, or when a subtitle lane is set to "this computer".')
      : t('Missing from this copy of the app - npm install puts it in vendor/whisper.'),
    el('span', 'loc-state ' + (p.present ? 'ok' : 'bad'), p.present ? t('installed') : t('missing'))));

    body.appendChild(el('div', 'dio-sec', t('The speech model')));
    var mright;
    if (m.downloading) mright = bar(m.downloading);
    else if (m.present) mright = del('model');
    else if (m.partial) mright = btn(t('Continue the download ({size} left)', { size: mb(m.bytes - m.partial) }), function () { post('/api/speech/local/download', 'model'); }, true);
    else mright = btn(t('Download ({size})', { size: mb(m.bytes) }), function () { post('/api/speech/local/download', 'model'); }, true);
    body.appendChild(row(m.name + ' · ' + mb(m.bytes), m.present
      ? t('Downloaded into this library\'s cache - recognition here needs no internet.')
      : (m.error ? t('The last download failed: {why}', { why: m.error }) : t('Not downloaded yet. The first recognition on this computer downloads it anyway; here it can be done ahead of time.')),
    mright));

    if (state.busy) body.appendChild(el('div', 'dio-status', t('Captions are being heard on this computer right now.')));
    var s = el('div', 'dio-status', msg);
    body.appendChild(s);
    paintApp(); paintYt(); paintHome();
  }

  function load() {
    return fetch('/api/speech/local').then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.success) { state = d.state; stateFailed = false; }
        else { stateFailed = !state; sayError(t('Could not read the recognition on this computer'), (d && d.error) || t('no answer')); }
        paint();
      })
      .catch(function (e) { stateFailed = !state; sayError(t('Could not read the recognition on this computer'), e.message); paint(); });
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!shown || !state || !state.model.downloading) return;
    timer = setTimeout(function () { load().then(schedule); }, 1000);
  }

  document.addEventListener('adm-pane', function (e) {
    shown = e.detail === 'local';
    if (shown) { load().then(schedule); ytLoad(); appLoad(); }
    else {
      if (timer) { clearTimeout(timer); timer = null; }
      if (appTimer) { clearTimeout(appTimer); appTimer = null; }
      if (ytTimer) { clearTimeout(ytTimer); ytTimer = null; }
    }
  });
})();
