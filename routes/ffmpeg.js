'use strict';

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const { spawn }  = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const router     = express.Router();

const { ROOT_DIR, UPLOADS_DIR, FINALS_DIR, TEMP_DIR } = require('../lib/config');

// In-memory job registry (cleared on server restart)
const _jobs = {};

function _webToFs(p) {
  if (!p) return null;
  if (p.startsWith('/uploads/')) return path.join(UPLOADS_DIR, p.slice('/uploads/'.length));
  if (p.startsWith('/finals/'))  return path.join(FINALS_DIR,  p.slice('/finals/'.length));
  return path.join(ROOT_DIR, p.replace(/^\//, ''));
}

// ── POST /api/ffmpeg/render ───────────────────────────────────────────────────
// Body: { segmentClips, clips, music, sfx, musicOffset, musicVolume,
//         sfxOffset, sfxVolume, transIn, transOut, outputLabel }
// segmentClips: [{ videoPath, start, end, crop }]  — avatar segments (sequential)
// clips:        [{ videoPath, start, end, crop }]  — biroly overlays (timed)
router.post('/ffmpeg/render', (req, res) => {
  const {
    segmentClips   = [],
    clips          = [],
    music          = 'Нет',
    musicOffset    = 0,
    musicVolume    = 0.5,
    segVolume      = 1.0,
    segTransition  = 'fade',
    segAnimation   = 'none',
    segSfx         = 'Нет',
    segSfxVolume   = 0.8,
    biroTransition = 'fade',
    biroAnimation  = 'none',
    biroSfx        = 'Нет',
    biroSfxVolume  = 0.8,
    outputLabel    = '',
    advSettings    = {},
    subtitles      = [],
    srtSubtitles   = [],
    assSettings    = {},
  } = req.body;

  const jobId = `ff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const bodySnapshot = { segmentClips, clips, music, musicOffset, musicVolume,
                         segVolume, segTransition, segAnimation, segSfx, segSfxVolume,
                         biroTransition, biroAnimation, biroSfx, biroSfxVolume, outputLabel,
                         advSettings, subtitles, srtSubtitles, assSettings };
  _jobs[jobId] = { status: 'running', progressSecs: 0, url: null, error: null, body: bodySnapshot };
  res.json({ success: true, jobId });

  _buildAndRun({ ...bodySnapshot, jobId })
    .then(url => { _jobs[jobId] = { ..._jobs[jobId], status: 'done', progressSecs: 0, url, error: null }; })
    .catch(e  => { _jobs[jobId] = { ..._jobs[jobId], status: 'failed', progressSecs: 0, url: null, error: e.message }; });
});

// ── GET /api/ffmpeg/status/:jobId ─────────────────────────────────────────────
router.get('/ffmpeg/status/:jobId', (req, res) => {
  const j = _jobs[req.params.jobId];
  if (!j) return res.json({ success: false, error: 'job not found' });
  res.json({ success: true, ...j });
});

// ── GET /api/ffmpeg/body/:jobId — return stored request body ──────────────────
router.get('/ffmpeg/body/:jobId', (req, res) => {
  const j = _jobs[req.params.jobId];
  if (!j) return res.json({ success: false, error: 'job not found' });
  res.json({ success: true, body: j.body || {} });
});

// ── PUT /api/ffmpeg/body/:jobId — update stored request body ──────────────────
router.put('/ffmpeg/body/:jobId', (req, res) => {
  const j = _jobs[req.params.jobId];
  if (!j) return res.json({ success: false, error: 'job not found' });
  j.body = req.body;
  res.json({ success: true });
});

// ── Animation filter string (applied after scale/pad) ────────────────────────
function _animFilter(anim, dur, W, H) {
  const frames = Math.max(1, Math.ceil(dur * 30));
  switch (anim) {
    case 'zoom_in':
      return `zoompan=z='min(zoom+0.0005,1.15)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=${W}x${H}:fps=30`;
    case 'zoom_out':
      return `zoompan=z='if(eq(on\\,1)\\,1.15\\,max(zoom-0.0005\\,1.0))':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=${W}x${H}:fps=30`;
    case 'vignette':
      return `vignette=PI/4`;
    case 'sharpen':
      return `unsharp=5:5:1.5:5:5:0`;
    case 'warm':
      return `colorchannelmixer=1.1:0:0:0:0:1:0:0:0:0:0.85:0`;
    case 'cool':
      return `colorchannelmixer=0.85:0:0:0:0:1:0:0:0:0:1.1:0`;
    default:
      return null;
  }
}

// ── Convert #rrggbb + alpha to ASS colour (&HAABBGGRR) ───────────────────────
function _hexToAss(hex, alphaInt = 0) {
  const h = (hex || '#000000').replace('#', '').padEnd(6, '0');
  const r = h.slice(0, 2).toUpperCase();
  const g = h.slice(2, 4).toUpperCase();
  const b = h.slice(4, 6).toUpperCase();
  const a = Math.min(255, Math.max(0, Math.round(alphaInt))).toString(16).padStart(2, '0').toUpperCase();
  return `&H${a}${b}${g}${r}`;
}

// ── Format seconds as ASS timestamp H:MM:SS.cs ───────────────────────────────
function _fmtAssTime(secs) {
  const s  = Math.max(0, secs);
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const sc = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

// ── Build .ass subtitle file content ─────────────────────────────────────────
function _buildAssContent(subtitles, assSettings, W, H) {
  const {
    fontName     = 'Arial',
    fontSize     = 60,
    bold         = false,
    italic       = false,
    primaryColor = '#ffffff',
    outlineColor = '#000000',
    shadowColor  = '#000000',
    backColor    = '#000000',
    backAlpha    = 128,
    borderStyle  = 1,
    outline      = 2.5,
    shadow       = 1,
    blur         = 0,
    alignment    = 2,
    marginV      = 60,
    marginL      = 20,
    marginR      = 20,
    fadeIn       = 200,
    fadeOut      = 150,
    slideFrom    = 'none',
    slideDist    = 60,
  } = assSettings;

  const primaryAss = _hexToAss(primaryColor, 0);
  const outlineAss = _hexToAss(outlineColor, 0);
  const shadowAss  = _hexToAss(shadowColor, 0);
  const backAss    = _hexToAss(backColor, backAlpha);
  const boldInt    = bold   ? -1 : 0;
  const italicInt  = italic ? -1 : 0;

  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'Collisions: Normal',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'Timer: 100.0000',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontName},${fontSize},${primaryAss},&H000000FF,${outlineAss},${backAss},${boldInt},${italicInt},0,0,100,100,0,0,${borderStyle},${parseFloat(outline).toFixed(1)},${parseFloat(shadow).toFixed(1)},${alignment},${marginL},${marginR},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  for (const sub of subtitles) {
    if (!sub.text || sub.end <= sub.start) continue;
    const t0 = _fmtAssTime(sub.start);
    const t1 = _fmtAssTime(sub.end);

    let overrides = '';
    if (fadeIn > 0 || fadeOut > 0) overrides += `\\fad(${Math.round(fadeIn)},${Math.round(fadeOut)})`;
    if (blur > 0) overrides += `\\blur${parseFloat(blur).toFixed(1)}`;
    if (slideFrom !== 'none') {
      const cx  = Math.round(W / 2);
      const cy  = Math.round(H - marginV);
      const dist = Math.round(slideDist);
      const sy  = slideFrom === 'bottom' ? cy + dist : cy - dist;
      const dur = Math.max(Math.round(fadeIn), 100);
      overrides += `\\an2\\move(${cx},${sy},${cx},${cy},0,${dur})`;
    }

    const tagBlock    = overrides ? `{${overrides}}` : '';
    const escapedText = sub.text.replace(/\n/g, '\\N');
    lines.push(`Dialogue: 0,${t0},${t1},Default,,0,0,0,,${tagBlock}${escapedText}`);
  }

  return lines.join('\n');
}

// ── Escape a filesystem path for FFmpeg filter_complex value ─────────────────
function _escapeFilterPath(p) {
  // Replace backslashes with forward slashes, then escape colons
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

// ── Escape text for FFmpeg drawtext (inside single-quoted value) ──────────────
function _escapeDrawtext(s) {
  return (s || '')
    .replace(/\\/g,  '\\\\')  // backslash → \\
    .replace(/'/g,   "\\'")   // single quote → \'
    .replace(/\n/g,  ' ')     // newline → space
    .replace(/\r/g,  '')
    .slice(0, 300);
}

// ── Convert #rrggbb to FFmpeg 0xRRGGBB ────────────────────────────────────────
function _hexToFfColor(hex) {
  return '0x' + (hex || '#ffffff').replace('#', '');
}

// ── Core render ───────────────────────────────────────────────────────────────
async function _buildAndRun({ segmentClips, clips, music, musicOffset, musicVolume,
                               segVolume, segTransition, segAnimation, segSfx, segSfxVolume,
                               biroTransition, biroAnimation, biroSfx, biroSfxVolume,
                               outputLabel, advSettings = {}, subtitles = [],
                               srtSubtitles = [], assSettings = {}, jobId }) {
  const {
    resolution   = '1080x1920',
    fps          = 30,
    crf          = 23,
    preset       = 'fast',
    audioBitrate = '192k',
    eqBrightness = 0,
    eqContrast   = 1,
    eqSaturation = 1,
    eqGamma      = 1,
    subsEnabled  = false,
    subsFontSize = 48,
    subsPosition = 'bottom',
    subsColor    = '#ffffff',
    subsStyle    = 'outline',
  } = advSettings;

  const [W, H] = resolution.split('x').map(Number).map(n => (n > 0 ? n : 1080));
  const FPS = parseInt(fps) || 30;
  const args = [];
  let inputIdx = 0;
  const segs  = [];   // { idx, dur }
  const biros = [];   // { idx, start, end, dur }

  // ── Segment clip inputs ───────────────────────────────────────────────────
  for (const sc of segmentClips) {
    const fp = _webToFs(sc.videoPath);
    if (!fp) throw new Error(`Неверный путь: ${sc.videoPath}`);
    if (!fs.existsSync(fp)) throw new Error(`Файл не найден: ${sc.videoPath}`);
    const dur  = parseFloat(sc.end) - parseFloat(sc.start);
    if (dur <= 0) continue;
    const trim = parseFloat(sc.crop) || 0;
    args.push('-ss', String(trim), '-t', String(dur.toFixed(6)), '-i', fp);
    segs.push({ idx: inputIdx++, dur });
  }

  if (segs.length === 0) throw new Error('Нет сегментов видео для рендера');

  // ── Biroly overlay inputs ─────────────────────────────────────────────────
  // -an: discard audio — many biro files have no audio; avoids [idx:a] stream errors
  for (const bc of clips) {
    const fp = _webToFs(bc.videoPath);
    if (!fp || !fs.existsSync(fp)) continue;
    const dur   = parseFloat(bc.end) - parseFloat(bc.start);
    if (dur <= 0) continue;
    const trim  = parseFloat(bc.crop) || 0;
    const start = parseFloat(bc.start);
    args.push('-an', '-ss', String(trim), '-t', String(dur.toFixed(6)), '-i', fp);
    biros.push({ idx: inputIdx++, start, end: parseFloat(bc.end), dur });
  }

  // ── Audio inputs ──────────────────────────────────────────────────────────
  let musicIdx = -1, segSfxIdx = -1, biroSfxIdx = -1;
  const _validA = s => s && s !== 'Нет' && s !== 'Рандом';
  if (_validA(music)) {
    const isLocal = music.startsWith('/');
    const fp  = isLocal ? _webToFs(music) : null;
    const src = fp || music;
    if (!isLocal || fs.existsSync(fp)) { args.push('-i', src); musicIdx = inputIdx++; }
  }
  if (_validA(segSfx)) {
    const fp = _webToFs(segSfx);
    if (fp && fs.existsSync(fp)) { args.push('-i', fp); segSfxIdx = inputIdx++; }
  }
  if (_validA(biroSfx)) {
    const fp = _webToFs(biroSfx);
    if (fp && fs.existsSync(fp)) { args.push('-i', fp); biroSfxIdx = inputIdx++; }
  }

  // ── filter_complex ────────────────────────────────────────────────────────
  const F = [];
  const FD = 0.35; // fade duration per clip (seconds)

  // Build paired-transition filter string for a clip of given duration
  function _pairedTrans(trans, dur, prefix) {
    if (!trans || trans === 'none') return '';
    const d  = Math.min(FD, dur / 3).toFixed(3);
    const st = Math.max(0, dur - parseFloat(d)).toFixed(3);
    if (trans === 'blur') {
      // gblur sigma ramps: in = high→0, out = 0→high (using enable expr)
      return `,gblur=sigma=20:enable='between(t,0,${d})'` +
             `,gblur=sigma=20:enable='between(t,${st},${(dur).toFixed(3)})'`;
    }
    // fade filter color: fade=none → black, fadewhite → white, fadegrays → gray
    const color = trans === 'fadewhite' ? ':color=white' : trans === 'fadegrays' ? ':color=gray' : '';
    return `,fade=in:st=0:d=${d}${color},fade=out:st=${st}:d=${d}${color}`;
  }

  // Scale + animate + paired-transition each segment, 30fps
  for (const s of segs) {
    const animF  = _animFilter(segAnimation, s.dur, W, H);
    const transF = _pairedTrans(segTransition, s.dur, `seg${s.idx}`);
    F.push(
      `[${s.idx}:v]setpts=PTS-STARTPTS,format=yuv420p,setsar=1,` +
      `scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${FPS}` +
      (animF ? `,${animF}` : '') + transF + `[sv${s.idx}]`
    );
  }

  // ── Build main video stream (simple concat, paired fades handle transitions) ─
  let mainV;
  if (segs.length === 1) {
    mainV = `sv${segs[0].idx}`;
  } else {
    F.push(segs.map(s => `[sv${s.idx}]`).join('') + `concat=n=${segs.length}:v=1:a=0[mainV]`);
    mainV = 'mainV';
  }

  // ── Biroly overlays (full-screen, paired transitions) ────────────────────
  let curV = mainV;
  for (const b of biros) {
    const animF  = _animFilter(biroAnimation, b.dur, W, H);
    const transF = _pairedTrans(biroTransition, b.dur, `biro${b.idx}`);
    // Step 1: setpts=PTS-STARTPTS resets to t=0 (needed because -ss trim shifts native PTS).
    // Step 2: scale/pad/fps/anim/transitions all operate with t=0-based frames (fade st=0 is correct).
    // Step 3: setpts=PTS+start/TB LAST — shifts frames to output position without disturbing transitions.
    // eof_action=pass: after biro ends main video continues.
    F.push(
      `[${b.idx}:v]setpts=PTS-STARTPTS,format=yuv420p,setsar=1,` +
      `scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${FPS}` +
      (animF ? `,${animF}` : '') + transF +
      `,setpts=PTS+${b.start.toFixed(6)}/TB` +
      `[bv${b.idx}]`
    );
    const tag = `ov${b.idx}`;
    F.push(`[${curV}][bv${b.idx}]overlay=0:0:eof_action=pass:repeatlast=0[${tag}]`);
    curV = tag;
  }
  let finalV = curV;

  // ── Build audio stream ────────────────────────────────────────────────────
  const aMix = [];

  // Normalise each audio stream first (reset PTS + apply volume + format)
  const _sv = parseFloat(segVolume) || 1.0;
  for (const s of segs) {
    F.push(
      `[${s.idx}:a]asetpts=PTS-STARTPTS,volume=${_sv},` +
      `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[sa${s.idx}]`
    );
  }

  if (segs.length === 1) {
    F.push(`[sa${segs[0].idx}]anull[segA]`);
  } else {
    F.push(segs.map(s => `[sa${s.idx}]`).join('') + `concat=n=${segs.length}:v=0:a=1[segA]`);
  }
  aMix.push('[segA]');

  if (musicIdx >= 0) {
    const ms = Math.round(musicOffset * 1000);
    F.push(
      `[${musicIdx}:a]adelay=${ms}|${ms},volume=${musicVolume},` +
      `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[ma]`
    );
    aMix.push('[ma]');
  }

  // ── Segment SFX: placed at each junction between speaking-head segments ──────
  if (segSfxIdx >= 0) {
    const segPoints = [];
    let outputCursor = segs[0].dur;
    for (let i = 1; i < segs.length; i++) {
      segPoints.push(outputCursor);
      outputCursor += segs[i].dur;
    }
    const segSfxDur = await _getFileDuration(_webToFs(segSfx));
    await _placeSfx(F, aMix, segSfxIdx, segSfxDur, segSfxVolume, segPoints, 'ssfx');
  }

  // ── Biro SFX: placed at each biroly start and end ─────────────────────────
  if (biroSfxIdx >= 0) {
    const biroPoints = [];
    for (const b of biros) {
      if (b.start > 0) biroPoints.push(b.start);
      biroPoints.push(b.end);
    }
    const biroSfxDur = await _getFileDuration(_webToFs(biroSfx));
    await _placeSfx(F, aMix, biroSfxIdx, biroSfxDur, biroSfxVolume, biroPoints, 'bsfx');
  }

  let finalA;
  if (aMix.length === 1) {
    F.push(`${aMix[0]}anull[finalA]`);
    finalA = 'finalA';
  } else {
    // normalize=0: don't divide by input count — each stream's volume= controls its level
    F.push(`${aMix.join('')}amix=inputs=${aMix.length}:duration=first:dropout_transition=0:normalize=0[finalA]`);
    finalA = 'finalA';
  }

  // ── Color correction (eq filter) — only when non-default ────────────────────
  const useEq = eqBrightness !== 0 || eqContrast !== 1 || eqSaturation !== 1 || eqGamma !== 1;
  if (useEq) {
    const b = parseFloat(eqBrightness).toFixed(3);
    const c = parseFloat(eqContrast).toFixed(3);
    const s = parseFloat(eqSaturation).toFixed(3);
    const g = parseFloat(eqGamma).toFixed(3);
    F.push(`[${finalV}]eq=brightness=${b}:contrast=${c}:saturation=${s}:gamma=${g}[finalV_eq]`);
    finalV = 'finalV_eq';
  }

  // ── SRT subtitles via libass (from STT generation) ───────────────────────
  let assFilePath = null;
  const activeSrtSubs = Array.isArray(srtSubtitles)
    ? srtSubtitles.filter(s => s.text && s.end > s.start)
    : [];

  if (activeSrtSubs.length) {
    const assContent = _buildAssContent(activeSrtSubs, assSettings, W, H);
    assFilePath = path.join(TEMP_DIR, `ass_${jobId}.ass`);
    fs.writeFileSync(assFilePath, assContent, 'utf8');
    const escapedPath = _escapeFilterPath(assFilePath);
    F.push(`[${finalV}]ass=filename='${escapedPath}'[finalV_ass]`);
    finalV = 'finalV_ass';
  }

  // ── Scenario-line subtitles (drawtext, chained) ───────────────────────────
  const activeSubs = (subsEnabled && Array.isArray(subtitles) && subtitles.length)
    ? subtitles.filter(s => s.text && s.end > s.start)
    : [];

  if (activeSubs.length) {
    const fontColor = _hexToFfColor(subsColor);
    const yExpr     = subsPosition === 'top'    ? '60'
                    : subsPosition === 'center'  ? '(h-text_h)/2'
                    : 'h-text_h-90';   // bottom

    // Determine font file (Windows first, then Linux fallback)
    const winFont   = 'C:/Windows/Fonts/arial.ttf';
    const linFont   = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf';
    const fontArg   = fs.existsSync(winFont.replace(/\//g, '\\')) ? `fontfile='${winFont}':` :
                      fs.existsSync(linFont)                        ? `fontfile='${linFont}':` : '';

    const boxArgs  = subsStyle === 'box'
      ? ':box=1:boxcolor=black@0.5:boxborderw=12'
      : '';
    const lineArgs = subsStyle === 'outline' ? `:borderw=3:bordercolor=black@0.85`
                   : subsStyle === 'shadow'  ? `:shadowx=2:shadowy=2:shadowcolor=black@0.8`
                   : '';

    const dtChain = activeSubs.map(sub => {
      const txt = _escapeDrawtext(sub.text);
      const t0  = sub.start.toFixed(3);
      const t1  = sub.end.toFixed(3);
      return `drawtext=${fontArg}text='${txt}':fontsize=${subsFontSize}:fontcolor=${fontColor}` +
             `:x=(w-text_w)/2:y=${yExpr}${boxArgs}${lineArgs}` +
             `:enable='between(t,${t0},${t1})'`;
    }).join(',');

    F.push(`[${finalV}]${dtChain}[finalV_sub]`);
    finalV = 'finalV_sub';
  }

  // ── Assemble output args ──────────────────────────────────────────────────
  const safeLabel = outputLabel.replace(/[^a-z0-9_\-]/gi, '').slice(0, 24) || 'render';
  const outName   = `local_${Date.now()}_${safeLabel}.mp4`;
  const outPath   = path.join(FINALS_DIR, outName);

  args.push('-filter_complex', F.join(';'));
  args.push('-map', `[${finalV}]`);
  args.push('-map', `[${finalA}]`);
  args.push('-c:v', 'libx264', '-preset', String(preset), '-crf', String(parseInt(crf) || 23));
  args.push('-c:a', 'aac', '-b:a', String(audioBitrate) || '192k');
  args.push('-movflags', '+faststart');
  args.push('-y', outPath);

  await _execFfmpeg(args, jobId);
  if (assFilePath) { try { fs.unlinkSync(assFilePath); } catch {} }
  return `/finals/${outName}`;
}

// ── Place SFX copies centred on each point ────────────────────────────────────
// prefix: unique tag prefix to avoid filter name collisions ('ssfx' or 'bsfx')
async function _placeSfx(F, aMix, inputIdx, sfxDur, volume, points, prefix) {
  if (!points.length) return;
  const N = points.length;
  if (N === 1) {
    const ms = Math.round(Math.max(0, points[0] - sfxDur / 2) * 1000);
    F.push(`[${inputIdx}:a]adelay=${ms}|${ms},volume=${volume},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[${prefix}0]`);
    aMix.push(`[${prefix}0]`);
  } else {
    F.push(`[${inputIdx}:a]asplit=${N}${points.map((_, i) => `[${prefix}s${i}]`).join('')}`);
    points.forEach((pt, i) => {
      const ms = Math.round(Math.max(0, pt - sfxDur / 2) * 1000);
      F.push(`[${prefix}s${i}]adelay=${ms}|${ms},volume=${volume},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[${prefix}${i}]`);
      aMix.push(`[${prefix}${i}]`);
    });
  }
}

// ── Probe file duration via FFmpeg stderr ─────────────────────────────────────
function _getFileDuration(fp) {
  return new Promise(resolve => {
    const proc = spawn(ffmpegPath, ['-i', fp], { stdio: ['ignore', 'ignore', 'pipe'] });
    let s = '';
    proc.stderr.on('data', c => { s += c.toString(); });
    proc.on('close', () => {
      const m = s.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
      resolve(m ? parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]) : 0);
    });
    proc.on('error', () => resolve(0));
  });
}

// ── Spawn FFmpeg and track progress ──────────────────────────────────────────
function _execFfmpeg(args, jobId) {
  return new Promise((resolve, reject) => {
    console.log(`[ffmpeg] start job=${jobId}`);
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    proc.stderr.on('data', chunk => {
      const s = chunk.toString();
      stderr += s;
      // Parse "time=HH:MM:SS.xx" for progress
      const m = s.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && _jobs[jobId]) {
        _jobs[jobId].progressSecs =
          parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
      }
    });

    proc.on('close', code => {
      if (code === 0) {
        console.log(`[ffmpeg] done job=${jobId}`);
        resolve();
      } else {
        reject(new Error(`FFmpeg ошибка (код ${code}): ${stderr.slice(-600)}`));
      }
    });

    proc.on('error', err => reject(err));
  });
}

module.exports = router;
