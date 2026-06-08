/* ═══════════════════════════════════════════════════════════════════════════
   mergev2-compositor.js — browser preview engine for Merge v2.

   A small canvas compositor: ONE master clock drives a pool of <video> elements
   keyed by clip; each animation frame the active source(s) are composited onto
   #mv2-canvas in the SAME z-order FFmpeg uses:
       main spine  →  halfer band (rotated, top/bottom)  →  birol/hook full-frame
   The preview is an APPROXIMATION — the FFmpeg export is authoritative.

   Audio: only the active MAIN segment is audible (volume = segVolume); inserts
   are muted (FFmpeg mutes insert audio too). Music track arrives in Phase 4.

   Speed (insert playbackRate) and crop/cropAlign are honored. Reverse is NOT
   previewed — the clip plays forward with a "⟲ reverse not previewed" badge.

   API (window.MV2Compositor is an INSTANCE):
     mount(canvas) · load(model) · play() · pause() · toggle() · seek(t)
     setOnTick(cb)  cb(currentSec, totalSec, playing)
     destroy()
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  const DRIFT_TOL = 0.15; // seconds — only hard-seek a video if off by more than this

  function Compositor() {
    this.canvas = null; this.ctx = null;
    this.model = null;
    this.pool = new Map();      // uid -> <video>
    this.clockT = 0;
    this.playing = false;
    this.rafId = null;
    this.baseWall = 0; this.baseClock = 0;
    this.onTick = null;
    this._activeUids = new Set();
    this.musicPool = new Map();   // music clip id -> <audio> (multi-instance)
  }

  Compositor.prototype.mount = function (canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  };

  Compositor.prototype.setOnTick = function (cb) { this.onTick = cb; };

  // ── Clip helpers ────────────────────────────────────────────────────────────
  function _uid(c) { return c.kind + ':' + (c.kind === 'main' ? c.idx : c.key); }

  Compositor.prototype._allClips = function () {
    const m = this.model;
    if (!m) return [];
    return [].concat(m.main || [], m.halfers || [], m.birols || [], m.hooks || []);
  };

  Compositor.prototype._mainClipAt = function (t) {
    if (!this.model) return null;
    const m = this.model.main || [];
    for (let i = 0; i < m.length; i++) if (t >= m[i].start && t < m[i].end) return m[i];
    if (m.length && t >= m[m.length - 1].end) return m[m.length - 1]; // hold last frame
    return null;
  };

  // Active inserts/halfers strictly within their window; main uses hold-last.
  Compositor.prototype._activeClips = function (t) {
    const out = [];
    const mainClip = this._mainClipAt(t);
    if (mainClip) out.push(mainClip);
    (this.model.halfers || []).forEach(c => { if (t >= c.start && t < c.end) out.push(c); });
    (this.model.birols  || []).forEach(c => { if (t >= c.start && t < c.end) out.push(c); });
    (this.model.hooks   || []).forEach(c => { if (t >= c.start && t < c.end) out.push(c); });
    return { mainClip, list: out };
  };

  // ── Load a resolved model ───────────────────────────────────────────────────
  Compositor.prototype.load = function (model) {
    this.pause();
    this._destroyPool();
    this.model = model;
    this._activeUids = new Set();
    const total = model ? model.totalDur : 0;
    if (this.clockT > total) this.clockT = 0;
    // Music elements — one <audio> per music clip (multi-instance).
    {
      const clips = (model && model.musicClips) || [];
      const live = new Set();
      clips.forEach(mc => {
        if (!mc || !mc.url) return;
        const id = String(mc.key);
        live.add(id);
        let el = this.musicPool.get(id);
        if (!el) { el = document.createElement('audio'); el.preload = 'auto'; this.musicPool.set(id, el); }
        if (el.dataset.url !== mc.url) { el.src = mc.url; el.dataset.url = mc.url; }
      });
      // Drop audio elements for clips that no longer exist.
      this.musicPool.forEach((el, id) => {
        if (!live.has(id)) { try { el.pause(); el.removeAttribute('src'); } catch {} this.musicPool.delete(id); }
      });
    }
    this._fitCanvas();
    this._syncActive(false);
    this._drawFrame();
    this._emitTick();
  };

  Compositor.prototype._musicSync = function () {
    const clips = (this.model && this.model.musicClips) || [];
    const playingOk = this.playing && this.model && this.clockT < this.model.totalDur;
    this.musicPool.forEach((el, id) => {
      const mc = clips.find(c => String(c.key) === id);
      const local = mc ? (this.clockT - mc.start) : -1;
      const within = !!mc && playingOk && local >= 0 && this.clockT < mc.end;
      if (!within) { if (!el.paused) el.pause(); return; }
      el.volume = Math.max(0, Math.min(1, mc.volume != null ? mc.volume : 0.5));
      const sp = (mc.speed && mc.speed > 0) ? mc.speed : 1;
      try { el.preservesPitch = true; if ('mozPreservesPitch' in el) el.mozPreservesPitch = true; } catch {}
      try { if (el.playbackRate !== sp) el.playbackRate = sp; } catch {}
      const want = local * sp;   // source position (source plays from 0 at clip.start)
      if (Math.abs(el.currentTime - want) > 0.3 * sp) { try { el.currentTime = want; } catch {} }
      if (el.paused) { const p = el.play(); if (p && p.catch) p.catch(() => {}); }
    });
  };

  Compositor.prototype._fitCanvas = function () {
    const res = (this.model && this.model.resolution) || { w: 1080, h: 1920 };
    const maxH = 480;
    const scale = Math.min(1, maxH / res.h);
    this.canvas.width  = Math.max(1, Math.round(res.w * scale));
    this.canvas.height = Math.max(1, Math.round(res.h * scale));
  };

  // Route preview video through the server's ~480p proxy so slow connections
  // stream a small file instead of the full-res 1080x1920 source. Leaves data:/
  // blob:/remote URLs untouched. The final FFmpeg render still uses the full-res
  // path (server-side), so quality is only reduced for the in-browser preview.
  function _previewSrc(url) {
    if (!url || typeof url !== 'string') return url;
    if (/^(data:|blob:|https?:)/i.test(url)) return url;
    return '/api/ffmpeg/preview-proxy?src=' + encodeURIComponent(url);
  }

  // ── Source pool ─────────────────────────────────────────────────────────────
  Compositor.prototype._getVideo = function (clip) {
    const uid = _uid(clip);
    let v = this.pool.get(uid);
    if (!v) {
      if (clip.voiceOnly) {
        // No video yet (voice-only fragment): use an <audio> source so the voice
        // plays; the draw step skips it (no videoWidth) → canvas stays black, and
        // subtitles still overlay. Upgrades to <video> automatically once synced.
        v = document.createElement('audio');
        v.preload = 'auto';
        if (clip.audioPath) v.src = clip.audioPath;
      } else {
        v = document.createElement('video');
        v.preload = 'auto';
        v.muted = true;
        v.playsInline = true;
        v.crossOrigin = 'anonymous';
        v.src = _previewSrc(clip.videoPath);
        // If the proxy can't be produced, fall back to the full-res source once.
        v.addEventListener('error', function _fb() {
          v.removeEventListener('error', _fb);
          if (clip.videoPath && String(v.src).indexOf('/api/ffmpeg/preview-proxy') >= 0) {
            try { v.src = clip.videoPath; v.load(); } catch {}
          }
        }, { once: true });
      }
      v.load();
      this.pool.set(uid, v);
    }
    return v;
  };

  Compositor.prototype._destroyPool = function () {
    this.pool.forEach(v => { try { v.pause(); v.removeAttribute('src'); v.load(); } catch {} });
    this.pool.clear();
  };

  // Keep videos for active clips playing/seeked; pause+mute the rest.
  Compositor.prototype._syncActive = function (shouldPlay) {
    if (!this.model) return;
    const { mainClip, list } = this._activeClips(this.clockT);
    const activeUids = new Set(list.map(_uid));

    // Pause + mute everything not currently active.
    this.pool.forEach((v, uid) => {
      if (!activeUids.has(uid)) { v.muted = true; if (!v.paused) v.pause(); }
    });

    const segVol = (this.model.segVolume != null) ? this.model.segVolume : 1.0;

    list.forEach(clip => {
      const v = this._getVideo(clip);
      const isMain = clip.kind === 'main';
      const audible = isMain || clip.audioOn;  // inserts (birols/hooks) are silent unless audio is toggled on
      v.muted = !audible;
      if (audible) v.volume = isMain ? Math.max(0, Math.min(1, segVol)) : Math.max(0, Math.min(1, clip.volume != null ? clip.volume : 1));
      const speed = clip.speed || 1;
      // Per-fragment speed applies to main (talking head) too: source position advances
      // `speed`× faster than the timeline. Edge-trim adds an in-point (trimIn): main
      // fragments play from trimIn in the source (inserts have no trimIn → 0).
      const want = (clip.trimIn || 0) + Math.max(0, this.clockT - clip.start) * speed;

      try { v.playbackRate = speed; } catch {}

      if (!shouldPlay) {
        if (Math.abs(v.currentTime - want) > 0.04) { try { v.currentTime = want; } catch {} }
        if (!v.paused) v.pause();
      } else {
        if (Math.abs(v.currentTime - want) > DRIFT_TOL) { try { v.currentTime = want; } catch {} }
        if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
      }
    });

    // Preload the next main clip for a seamless cut.
    if (mainClip) {
      const order = this.model.main;
      const pos = order.indexOf(mainClip);
      if (pos >= 0 && pos + 1 < order.length) this._getVideo(order[pos + 1]);
    }

    this._activeUids = activeUids;
  };

  // ── Drawing ─────────────────────────────────────────────────────────────────
  Compositor.prototype._drawFrame = function () {
    const ctx = this.ctx, cw = this.canvas.width, ch = this.canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    if (!this.model) return;

    const t = this.clockT;
    let topReversed = false;

    // 1) Main spine (crop 0, cover-fit)
    const mainClip = this._mainClipAt(t);
    if (mainClip) {
      const v = this.pool.get(_uid(mainClip));
      if (v && v.readyState >= 2 && v.videoWidth) {
        _drawClipFx(ctx, v, cw, ch, mainClip, t);
        topReversed = !!mainClip.reversed;
      }
    }

    // 2) Halfer bands (rotated 90°, top/bottom)
    (this.model.halfers || []).forEach(c => {
      if (t < c.start || t >= c.end) return;
      const v = this.pool.get(_uid(c));
      if (v && v.readyState >= 2 && v.videoWidth) {
        _drawHalfer(ctx, v, cw, ch, c.halferAlign || 'top');
        if (c.reversed) topReversed = true;
      }
    });

    // 3) Birols + hooks full-frame (later start wins → drawn last)
    const inserts = [].concat(this.model.birols || [], this.model.hooks || [])
      .filter(c => t >= c.start && t < c.end)
      .sort((a, b) => a.start - b.start);
    inserts.forEach(c => {
      const v = this.pool.get(_uid(c));
      if (v && v.readyState >= 2 && v.videoWidth) {
        _drawClipFx(ctx, v, cw, ch, c, t);
        topReversed = !!c.reversed; // topmost layer determines the badge
      }
    });

    // 4) Subtitles — mirror the final libass render as closely as canvas allows:
    //    wordsPerLine grouping, karaoke word-sweep, shadow + box + position.
    if (this.model.subsEnabled) {
      const sub = _activeSub(this.model, t);
      if (sub && sub.text) {
        const outH = (this.model.resolution && this.model.resolution.h) || 1920;
        _drawSubtitle(ctx, cw, ch, sub, this.model.assSettings || {}, outH, t);
      }
    }

    if (topReversed) _drawBadge(ctx, cw, '⟲ reverse not previewed');
  };

  // Group a flat word array into lines of N words — mirrors routes/ffmpeg.js
  // _groupWords so the preview shows the same line breaks as the burned-in .ass.
  function _groupWordsClient(words, n) {
    if (!words || !words.length) return [];
    const per = (n > 0) ? n : words.length;
    const out = [];
    for (let i = 0; i < words.length; i += per) {
      const chunk = words.slice(i, i + per);
      const text  = chunk.map(w => w.text).join(' ');
      const start = chunk[0].start, end = chunk[chunk.length - 1].end;
      if (text && end > start) out.push({ text, start, end, words: chunk });
    }
    return out;
  }
  // Subtitle visible at time t: prefer word-grouped lines (matches final render's
  // wordsPerLine + karaoke) when word timings exist; else fall back to SRT blocks.
  function _activeSub(model, t) {
    const ass = model.assSettings || {};
    const wpl = parseInt(ass.wordsPerLine, 10) || 0;
    const words = model.srtWords || [];
    if (words.length && wpl > 0) {
      return _groupWordsClient(words, wpl).find(g => t >= g.start && t < g.end) || null;
    }
    const s = (model.subtitles || []).find(x => t >= x.start && t < x.end);
    return s ? { text: s.text, words: null, start: s.start, end: s.end } : null;
  }
  function _rgba(hex, a) {
    hex = String(hex || '#000000').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16) || 0, g = parseInt(hex.slice(2, 4), 16) || 0, b = parseInt(hex.slice(4, 6), 16) || 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (a == null ? 1 : a) + ')';
  }

  // Approximate libass: font/size/color/outline + shadow, background box,
  // wordsPerLine grouping, karaoke word-sweep, and the 15-cell position grid.
  function _drawSubtitle(ctx, cw, ch, sub, ass, outH, t) {
    ass = ass || {};
    const scale = ch / (outH || 1920);
    const fs = Math.max(9, Math.round((ass.fontSize || 64) * scale));
    const weight = ass.bold ? '700' : '400';
    const italic = ass.italic ? 'italic ' : '';
    const fam = ass.fontName ? ('"' + ass.fontName + '", sans-serif') : 'sans-serif';
    ctx.save();
    ctx.font = italic + weight + ' ' + fs + 'px ' + fam;
    ctx.lineJoin = 'round';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    const pa = ass.posAlign || 'bc';
    const rowc = pa[0] || 'b';            // t/u/m/l/b
    const colc = pa[1] || 'c';            // l/c/r

    const primary   = ass.primaryColor || '#fff';
    const secondary = '#ff0000';          // libass SecondaryColour (\kf future words) is hardcoded red server-side
    const outlineW  = Math.max(0, (ass.outline != null ? ass.outline : 2) * scale);
    const shadowOff = Math.max(0, (ass.shadow != null ? ass.shadow : 0) * scale);
    const karaoke   = ass.karaokeStyle && ass.karaokeStyle !== 'none' && sub.words && sub.words.length;
    const borderStyle = parseInt(ass.borderStyle, 10) || 1;
    const boxOn     = borderStyle >= 3;   // 3/4 = opaque background box
    const boxAlpha  = 1 - (Math.max(0, Math.min(255, ass.backAlpha != null ? ass.backAlpha : 128)) / 255);

    // Tokens (with per-word timing for karaoke, else plain split)
    const tokens = karaoke
      ? sub.words.map(w => ({ text: w.text, start: w.start, end: w.end }))
      : String(sub.text).split(/\s+/).filter(Boolean).map(text => ({ text, start: null }));

    // Word-wrap into lines (arrays of tokens) at 92% width
    const maxW = cw * 0.92;
    const spaceW = ctx.measureText(' ').width;
    const lines = []; let cur = [], curW = 0;
    tokens.forEach(tok => {
      const wW = ctx.measureText(tok.text).width;
      const add = (cur.length ? spaceW : 0) + wW;
      if (curW + add > maxW && cur.length) { lines.push(cur); cur = [tok]; curW = wW; }
      else { cur.push(tok); curW += add; }
    });
    if (cur.length) lines.push(cur);
    if (!lines.length) { ctx.restore(); return; }

    const lineH  = fs * 1.2;
    const totalH = lines.length * lineH;
    const padV   = Math.max(6, 60 * scale);     // ASS marginV = 60 output px
    const padX   = cw * 0.04;

    // Vertical placement matching the server's _POS_MAP rows
    let blockTop;
    switch (rowc) {
      case 't': blockTop = padV; break;                       // top
      case 'u': blockTop = ch * 0.25; break;                  // upper (\pos H*0.25)
      case 'm': blockTop = (ch - totalH) / 2; break;          // middle
      case 'l': blockTop = ch * 0.72 - totalH; break;         // lower (\pos H*0.72)
      case 'b':
      default:  blockTop = ch - padV - totalH; break;         // bottom
    }
    blockTop = Math.max(padV * 0.3, Math.min(blockTop, ch - totalH - padV * 0.3));

    const lineWidth = (toks) => toks.reduce((s, tk, i) => s + (i ? spaceW : 0) + ctx.measureText(tk.text).width, 0);

    // Background box behind the block (borderStyle 3/4)
    if (boxOn && boxAlpha > 0) {
      const widest = Math.max.apply(null, lines.map(lineWidth));
      const bx = colc === 'l' ? padX : colc === 'r' ? cw - padX - widest : (cw - widest) / 2;
      const bp = fs * 0.18;
      ctx.fillStyle = _rgba(ass.backColor || '#000', boxAlpha);
      ctx.fillRect(bx - bp, blockTop - bp, widest + bp * 2, totalH + bp * 2);
    }

    lines.forEach((toks, li) => {
      const y  = blockTop + li * lineH;
      const lw = lineWidth(toks);
      let x = colc === 'l' ? padX : colc === 'r' ? cw - padX - lw : (cw - lw) / 2;
      toks.forEach((tk, i) => {
        if (i) x += spaceW;
        const wW = ctx.measureText(tk.text).width;
        const color = (karaoke && tk.start != null) ? (t >= tk.start ? primary : secondary) : primary;
        if (shadowOff > 0) { ctx.fillStyle = _rgba(ass.shadowColor || '#000', 0.85); ctx.fillText(tk.text, x + shadowOff, y + shadowOff); }
        if (outlineW > 0)  { ctx.lineWidth = outlineW * 2; ctx.strokeStyle = ass.outlineColor || '#000'; ctx.strokeText(tk.text, x, y); }
        ctx.fillStyle = color; ctx.fillText(tk.text, x, y);
        x += wW;
      });
    });
    ctx.restore();
  }

  // crop = fraction trimmed from the TOP; cover-fit, align horizontally, extra zoom.
  function _drawCoverScaled(ctx, v, cw, ch, crop, cropAlign, zoom) {
    const vw = v.videoWidth, vh = v.videoHeight;
    const sy = vh * Math.max(0, Math.min(0.95, crop));
    const sh = vh - sy;
    const sw = vw;
    const scale = Math.max(cw / sw, ch / sh) * (zoom || 1);
    const dw = sw * scale, dh = sh * scale;
    const dy = (ch - dh) / 2;
    let dx;
    if (cropAlign === 'left') dx = 0;
    else if (cropAlign === 'right') dx = cw - dw;
    else dx = (cw - dw) / 2;
    // When zoomed, recenter so the crop stays centered on its alignment anchor.
    if (zoom && zoom !== 1) { dx = (cw - dw) / 2 + (cropAlign === 'left' ? (dw - cw) / 2 : cropAlign === 'right' ? (cw - dw) / 2 : 0); }
    try { ctx.drawImage(v, 0, sy, sw, sh, dx, dy, dw, dh); } catch {}
  }

  // CSS-filter string approximating an FFmpeg color/texture filter.
  function _cssFilter(name) {
    switch (name) {
      case 'bw':        return 'grayscale(1)';
      case 'sepia':     return 'sepia(0.85)';
      case 'warm':      return 'saturate(1.2) sepia(0.22)';
      case 'cool':      return 'saturate(1.15) hue-rotate(-12deg) brightness(1.02)';
      case 'cinematic': return 'contrast(1.1) saturate(1.18)';
      case 'vhs':       return 'saturate(1.3) contrast(1.08)';
      case 'sharpen':   return 'contrast(1.12)';
      case 'glitch':    return 'saturate(1.4) contrast(1.1)';
      default:          return ''; // none / vignette (overlay-based)
    }
  }

  function _drawVignette(ctx, cw, ch) {
    const g = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch); ctx.restore();
  }

  // Draw a clip honoring its effective animation (zoom) + transition (edges) +
  // filter. Approximate — the FFmpeg export is authoritative.
  function _drawClipFx(ctx, v, cw, ch, clip, t) {
    const dur = clip.dur != null ? clip.dur : (clip.end - clip.start);
    const localT = t - clip.start;
    const prog = dur > 0 ? Math.max(0, Math.min(1, localT / dur)) : 0;

    // Animation (Ken Burns zoom)
    let zoom = 1;
    if (clip.animation === 'zoom_in')  zoom = 1 + 0.15 * prog;
    else if (clip.animation === 'zoom_out') zoom = 1.15 - 0.15 * prog;

    // Transition at the ~0.35s edges
    const TD = 0.35;
    const inP  = dur > 0 ? Math.min(1, localT / TD) : 1;
    const outP = dur > 0 ? Math.min(1, (dur - localT) / TD) : 1;
    const edge = Math.max(0, Math.min(inP, outP)); // 1 mid, →0 at edges
    let blurPx = 0, overlayColor = null, overlayAlpha = 0;
    switch (clip.transition) {
      case 'fade':         overlayColor = '#000'; overlayAlpha = 1 - edge; break;
      case 'fadewhite':
      case 'flash-white':  overlayColor = '#fff'; overlayAlpha = 1 - edge; break;
      case 'blur':         blurPx = (1 - edge) * 12; break;
      case 'zoom-punch-in':  zoom *= 1 + (1 - inP) * 0.25; break;
      case 'zoom-punch-out': zoom *= 1 + (1 - outP) * 0.25; break;
      case 'whip-pan-h':
      case 'whip-pan-v':
      case 'glitch':       blurPx = (1 - edge) * 10; break;
      default: break; // none
    }

    const cssF = _cssFilter(clip.filter);
    const filterStr = ((cssF ? cssF + ' ' : '') + (blurPx > 0.25 ? 'blur(' + blurPx.toFixed(1) + 'px)' : '')).trim();

    ctx.save();
    if (filterStr) ctx.filter = filterStr;
    _drawCoverScaled(ctx, v, cw, ch, clip.crop || 0, clip.cropAlign || 'center', zoom);
    ctx.restore();

    if (clip.filter === 'vignette') _drawVignette(ctx, cw, ch);
    if (overlayColor && overlayAlpha > 0.01) {
      ctx.save(); ctx.globalAlpha = Math.min(1, overlayAlpha); ctx.fillStyle = overlayColor;
      ctx.fillRect(0, 0, cw, ch); ctx.restore();
    }
  }

  // Halfer: source rotated 90° CW, stretched to fill a W × (2H/5) band top/bottom.
  // (Feathered edge is added in Phase 4; here it is a hard band.)
  function _drawHalfer(ctx, v, cw, ch, align) {
    const bandH = ch * 2 / 5;
    const bandY = align === 'bottom' ? ch - bandH : 0;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, bandY, cw, bandH); ctx.clip();
    ctx.translate(cw / 2, bandY + bandH / 2);
    ctx.rotate(Math.PI / 2); // 90° clockwise
    // After rotation, local width→screen height and local height→screen width,
    // so draw a (bandH × cw) box to fill a (cw × bandH) band.
    try { ctx.drawImage(v, -bandH / 2, -cw / 2, bandH, cw); } catch {}
    ctx.restore();
  }

  function _drawBadge(ctx, cw, text) {
    ctx.save();
    ctx.font = '11px sans-serif';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(170,40,40,0.85)';
    ctx.fillRect(cw - w - 6, 6, w, 18);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cw - w, 15);
    ctx.restore();
  }

  // ── Transport ───────────────────────────────────────────────────────────────
  Compositor.prototype.play = function () {
    if (!this.model || this.playing) return;
    if (this.clockT >= this.model.totalDur) this.clockT = 0;
    this.playing = true;
    this.baseWall = performance.now();
    this.baseClock = this.clockT;
    this._syncActive(true);
    this._musicSync();
    this._loop();
    this._emitTick();
  };

  Compositor.prototype.pause = function () {
    if (!this.playing) { this._cancelRaf(); return; }
    this.playing = false;
    this._cancelRaf();
    this.pool.forEach(v => { if (!v.paused) v.pause(); });
    this.musicPool.forEach(el => { if (!el.paused) el.pause(); });
    this._emitTick();
  };

  Compositor.prototype.toggle = function () { this.playing ? this.pause() : this.play(); };

  Compositor.prototype.seek = function (t) {
    if (!this.model) return;
    this.clockT = Math.max(0, Math.min(t, this.model.totalDur));
    if (this.playing) {
      this.baseWall = performance.now();
      this.baseClock = this.clockT;
      this._syncActive(true);
      this._musicSync();
    } else {
      this._syncActive(false);
      // Draw once the relevant videos have their requested frame ready.
      const { list } = this._activeClips(this.clockT);
      let pending = 0;
      const draw = () => this._drawFrame();
      list.forEach(c => {
        const v = this.pool.get(_uid(c));
        if (v && v.readyState < 2) { pending++; v.addEventListener('seeked', draw, { once: true }); }
        else if (v) { v.addEventListener('seeked', draw, { once: true }); }
      });
      this._drawFrame();
      if (!pending) this._drawFrame();
    }
    this._emitTick();
  };

  Compositor.prototype._loop = function () {
    const tick = () => {
      if (!this.playing) return;
      const now = performance.now();
      this.clockT = this.baseClock + (now - this.baseWall) / 1000;
      if (this.clockT >= this.model.totalDur) {
        this.clockT = this.model.totalDur;
        this._drawFrame();
        this._emitTick();
        this.pause();
        return;
      }
      // Re-evaluate the active set (handles cuts + inserts entering/leaving).
      const uids = new Set(this._activeClips(this.clockT).list.map(_uid));
      let changed = uids.size !== this._activeUids.size;
      if (!changed) { for (const u of uids) if (!this._activeUids.has(u)) { changed = true; break; } }
      if (changed) this._syncActive(true);

      this._musicSync();
      this._drawFrame();
      this._emitTick();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  };

  Compositor.prototype._cancelRaf = function () {
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  };

  Compositor.prototype._emitTick = function () {
    if (this.onTick) this.onTick(this.clockT, this.model ? this.model.totalDur : 0, this.playing);
  };

  Compositor.prototype.destroy = function () {
    this.pause();
    this._destroyPool();
    this.musicPool.forEach(el => { try { el.pause(); el.removeAttribute('src'); } catch {} });
    this.musicPool.clear();
    this.model = null;
  };

  window.MV2Compositor = new Compositor();
})();
