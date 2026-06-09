/* app-chime.js — short synthesized "glass chime" for completion notifications.

   Loaded on every page. Exposes window.AppChime():
     AppChime()            → play the ~0.5s glass chime (no-op if muted)
     AppChime.setMuted(b)  → persist mute preference (localStorage)
     AppChime.isMuted()    → current mute state
     AppChime.test()       → play even if muted (for a settings "test" button)

   No audio asset is shipped: the bell is synthesized with the Web Audio API
   (a few detuned sine partials under a fast exponential decay). A one-time
   user-gesture listener unlocks/resumes the AudioContext so chimes fired later
   (when a background generation finishes) are actually audible. */
(function () {
  'use strict';

  var LS_MUTE = 'app_chime_muted_v1';
  var _ctx = null;
  var _unlocked = false;
  var _lastPlayMs = 0; // debounce: never two chimes within 350ms

  function _muted() {
    try { return localStorage.getItem(LS_MUTE) === '1'; } catch (e) { return false; }
  }

  function _getCtx() {
    if (_ctx) return _ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { _ctx = new AC(); } catch (e) { return null; }
    return _ctx;
  }

  // Resume the context on the first real user gesture so later (gesture-less)
  // completion chimes can play. Browsers start the context "suspended".
  function _unlock() {
    if (_unlocked) return;
    var ctx = _getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    _unlocked = true;
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, _unlock, { once: false, passive: true });
  });

  // Synthesize one bell strike: a small stack of detuned sine partials sharing
  // an exponential-decay envelope (~0.5s). Pleasant, glassy, non-jarring.
  function _strike(force) {
    if (!force && _muted()) return;
    var now = Date.now();
    if (now - _lastPlayMs < 350) return; // debounce bursts
    _lastPlayMs = now;

    var ctx = _getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }

    var t0 = ctx.currentTime;
    var dur = 0.5;

    // Master envelope
    var master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.22, t0 + 0.008); // fast attack
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); // smooth decay
    master.connect(ctx.destination);

    // A bright triad (E6-ish bell) + a faint higher shimmer partial.
    var partials = [
      { f: 1318.5, g: 1.0,  d: 0.0 },   // E6
      { f: 1760.0, g: 0.55, d: 0.0 },   // A6
      { f: 2637.0, g: 0.28, d: 4.0 },   // E7 shimmer (slightly detuned)
    ];
    partials.forEach(function (p) {
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(p.f + p.d, t0);
      var g = ctx.createGain();
      g.gain.setValueAtTime(p.g, t0);
      // higher partials decay a touch faster for a natural bell timbre
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * (p.f > 2000 ? 0.6 : 1));
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    });
  }

  function AppChime() { try { _strike(false); } catch (e) {} }
  AppChime.setMuted = function (b) { try { localStorage.setItem(LS_MUTE, b ? '1' : '0'); } catch (e) {} };
  AppChime.isMuted = function () { return _muted(); };
  AppChime.test    = function () { try { _strike(true); } catch (e) {} };

  window.AppChime = AppChime;
})();
