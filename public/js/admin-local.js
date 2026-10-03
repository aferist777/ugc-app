/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN -> THIS COMPUTER: speech recognition here (phase K1b, the owner 2026-10-03).

   Captions are heard by Groq; when Groq cannot be asked, or a subtitle lane says "this computer", the
   app hears the sound itself (lib/whisper-local.js). This pane says what that needs and lets it be
   fetched or let go of:

     the program      whisper.cpp with OpenBLAS - ships with the app (npm install), nothing to do here
     the model        574 MB - the first local recognition downloads it anyway; here it can be done ahead
     the NVIDIA build 674 MB (about 1.1 GB on disk) - only by this button (the owner's decision), and only
                      when the computer has an NVIDIA card: twelve times faster than the processor

   GET /api/speech/local is read when the pane shows, and every second while something downloads.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  var body = document.getElementById('loc-body');
  if (!body) return;
  var state = null, timer = null, shown = false, msg = '', msgErr = false, armed = null;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function mb(b) { return Math.round((+b || 0) / 1e6) + ' MB'; }
  function gb(b) { return ((+b || 0) / 1e9).toFixed(1) + ' GB'; }

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

  function paint() {
    body.textContent = '';
    if (!state) { body.appendChild(el('div', 'dio-status', 'reading…')); return; }
    if (!state.platform) {
      body.appendChild(el('div', 'dio-status', 'Recognition on this computer is built for Windows - captions are heard by Groq here.'));
      return;
    }
    var p = state.program, m = state.model, c = state.cuda;

    body.appendChild(el('div', 'dio-sec', 'The program'));
    body.appendChild(row('whisper.cpp ' + p.version + ' · OpenBLAS', p.present
      ? 'Ships with the app. Captions use it when Groq cannot be asked, or when a subtitle lane is set to "this computer".'
      : 'Missing from this copy of the app - npm install puts it in vendor/whisper.',
    el('span', 'loc-state ' + (p.present ? 'ok' : 'bad'), p.present ? 'installed' : 'missing')));

    body.appendChild(el('div', 'dio-sec', 'The speech model'));
    var mright;
    if (m.downloading) mright = bar(m.downloading);
    else if (m.present) mright = del('model');
    else mright = btn('Download (' + mb(m.bytes) + ')', function () { post('/api/speech/local/download', 'model'); }, true);
    body.appendChild(row(m.name + ' · ' + mb(m.bytes), m.present
      ? 'Downloaded into this library\'s cache - recognition here needs no internet.'
      : (m.error ? 'The last download failed: ' + m.error : 'Not downloaded yet. The first recognition on this computer downloads it anyway; here it can be done ahead of time.'),
    mright));

    body.appendChild(el('div', 'dio-sec', 'The graphics card'));
    if (!c.gpu) {
      // An NVIDIA build already on disk keeps its Delete even when no card answers now (review K1b).
      body.appendChild(row('No NVIDIA graphics card', c.present
        ? 'The NVIDIA build is installed (about ' + gb(c.disk) + ') but no card answers now - recognition runs on the processor.'
        : 'Recognition runs on the processor - about 0.7 s for every second of sound.', c.present ? del('cuda') : null));
    } else {
      var cright, csub;
      if (c.downloading) { cright = bar(c.downloading); csub = 'Downloading the NVIDIA build - it is unpacked into this library\'s cache when it arrives.'; }
      else if (c.present) {
        cright = del('cuda');
        csub = c.failed ? 'Installed, but it failed once since the app started - the processor is used until the next start.'
          : 'Installed: recognition runs on the card, about twelve times faster than on the processor.';
      } else {
        cright = btn('Download the NVIDIA build (' + mb(c.bytes) + ')', function () { post('/api/speech/local/download', 'cuda'); }, true);
        csub = (c.error ? 'The last download failed: ' + c.error + ' ' : '') + 'About ' + gb(c.disk) + ' on disk once unpacked. Without it, recognition runs on the processor.';
      }
      body.appendChild(row(c.gpu, csub, cright));
    }
    if (state.busy) body.appendChild(el('div', 'dio-status', 'Captions are being heard on this computer right now.'));
    var s = el('div', 'dio-status' + (msgErr ? ' err' : ''), msg);
    body.appendChild(s);
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
    if (shown) load().then(schedule);
    else if (timer) { clearTimeout(timer); timer = null; }
  });
})();
