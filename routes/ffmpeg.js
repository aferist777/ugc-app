'use strict';

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const { spawn }  = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const router     = express.Router();

const { ROOT_DIR, UPLOADS_DIR, FINALS_DIR, TEMP_DIR, DATA_DIR } = require('../lib/config');

// Directory for persisted pre-built .ass files
const ASS_DIR = path.join(DATA_DIR, 'ass_cache');
if (!fs.existsSync(ASS_DIR)) fs.mkdirSync(ASS_DIR, { recursive: true });

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
    segVolume            = 1.0,
    segTransition        = 'fade',
    segTransitionParams  = {},
    segAnimation         = 'none',
    segAnimParams        = {},
    segFilter            = 'none',
    segFilterParams      = {},
    segSfx               = 'Нет',
    segSfxVolume         = 0.8,
    biroTransition       = 'fade',
    biroTransitionParams = {},
    biroAnimation        = 'none',
    biroAnimParams       = {},
    biroFilter           = 'none',
    biroFilterParams     = {},
    biroSfx              = 'Нет',
    biroSfxVolume        = 0.8,
    outputLabel          = '',
    advSettings          = {},
    subtitles            = [],
    srtSubtitles         = [],
    srtWords             = [],
    assSettings          = {},
    prebuiltAssPath      = null,
  } = req.body;

  const jobId = `ff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const bodySnapshot = { segmentClips, clips, music, musicOffset, musicVolume,
                         segVolume,
                         segTransition, segTransitionParams,
                         segAnimation,  segAnimParams,
                         segFilter,     segFilterParams,
                         segSfx, segSfxVolume,
                         biroTransition, biroTransitionParams,
                         biroAnimation,  biroAnimParams,
                         biroFilter,     biroFilterParams,
                         biroSfx, biroSfxVolume,
                         outputLabel, advSettings, subtitles, srtSubtitles, srtWords, assSettings,
                         prebuiltAssPath };
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
  const { proc: _, ...safe } = j;   // don't send proc handle over the wire
  res.json({ success: true, ...safe });
});

// ── DELETE /api/ffmpeg/cancel/:jobId ─────────────────────────────────────────
router.delete('/ffmpeg/cancel/:jobId', (req, res) => {
  const j = _jobs[req.params.jobId];
  if (!j) return res.json({ success: false, error: 'job not found' });
  if (j.proc) {
    try { j.proc.kill('SIGTERM'); } catch {}
    j.proc = null;
  }
  j.status = 'cancelled';
  res.json({ success: true });
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

// ── Animation filter (zoom only, motion-based) ──────────────────────────────
// Returns FFmpeg filter chain (no leading comma) or null. Caller chains it.
//   anim:   'zoom_in' | 'zoom_out'
//   params: { maxZoom: 1.05–1.50, easing: linear|ease-in|ease-out|ease-in-out, focal: tl|tc|tr|ml|mc|mr|bl|bc|br }
function _animFilter(anim, dur, W, H, params = {}) {
  if (anim !== 'zoom_in' && anim !== 'zoom_out') return null;
  const frames  = Math.max(1, Math.ceil(dur * 30));
  const maxZoom = parseFloat(params.maxZoom) || 1.15;
  const easing  = params.easing || 'linear';
  const focal   = params.focal  || 'mc';
  const POST    = ',format=yuv420p,setsar=1';

  // Progress expression P (0 → 1). Commas inside expressions need \\ escaping
  // because zoompan z=' ' is delimited by ':' but parsed by FFmpeg's expr engine
  // which is itself comma-aware via filter args. Escape to be safe.
  const PROG = {
    'linear':      `(on/${frames})`,
    'ease-in':     `(pow(on/${frames}\\,2))`,
    'ease-out':    `(1-pow(1-on/${frames}\\,2))`,
    'ease-in-out': `(0.5-0.5*cos(PI*on/${frames}))`,
  };
  const P = PROG[easing] || PROG.linear;

  // Zoom expression: zoom_in goes 1→max, zoom_out goes max→1
  const zExpr = anim === 'zoom_in'
    ? `1+(${maxZoom.toFixed(4)}-1)*${P}`
    : `${maxZoom.toFixed(4)}-(${maxZoom.toFixed(4)}-1)*${P}`;

  // Focal point → crop offset (in zoompan space, iw/ih are input dims)
  const FMAP = {
    tl: { x: '0',                  y: '0' },
    tc: { x: '(iw-iw/zoom)/2',     y: '0' },
    tr: { x: 'iw-iw/zoom',         y: '0' },
    ml: { x: '0',                  y: '(ih-ih/zoom)/2' },
    mc: { x: '(iw-iw/zoom)/2',     y: '(ih-ih/zoom)/2' },
    mr: { x: 'iw-iw/zoom',         y: '(ih-ih/zoom)/2' },
    bl: { x: '0',                  y: 'ih-ih/zoom' },
    bc: { x: '(iw-iw/zoom)/2',     y: 'ih-ih/zoom' },
    br: { x: 'iw-iw/zoom',         y: 'ih-ih/zoom' },
  };
  const f = FMAP[focal] || FMAP.mc;
  // Render zoompan at 2× resolution then scale down to halve sub-pixel jitter
  // (the cause of "shake" during zoom). Costs ~30% extra time on zoom step.
  return `zoompan=z='${zExpr}':x='${f.x}':y='${f.y}':d=1:s=${2*W}x${2*H}:fps=30,scale=${W}:${H}:flags=lanczos${POST}`;
}

// ── Filter (color / texture effects, no motion) ─────────────────────────────
// Returns filter chain (no leading comma) or null.
//   filt:   'vignette' | 'sharpen' | 'warm' | 'cool'
function _filterFilter(filt, params = {}) {
  const POST = ',format=yuv420p,setsar=1';
  switch (filt) {
    case 'vignette': {
      const strength = parseFloat(params.strength) || 0.78;
      const shape    = parseFloat(params.shape)    || 1.0;
      return `vignette=angle=${strength.toFixed(3)}:aspect=${shape.toFixed(3)}${POST}`;
    }
    case 'sharpen': {
      const amount = parseFloat(params.amount) || 1.0;
      let   size   = parseInt(params.size, 10) || 5;
      // unsharp requires odd kernel size 3..23
      if (size % 2 === 0) size += 1;
      size = Math.max(3, Math.min(23, size));
      const chroma = !!params.chroma;
      const chromaPart = chroma
        ? `:chroma_msize_x=${size}:chroma_msize_y=${size}:chroma_amount=${amount.toFixed(2)}`
        : '';
      return `unsharp=luma_msize_x=${size}:luma_msize_y=${size}:luma_amount=${amount.toFixed(2)}${chromaPart}${POST}`;
    }
    case 'warm': {
      const i = parseFloat(params.intensity) || 0.15;
      // gamma_r < 1 → boost red; gamma_b > 1 → reduce blue
      return `eq=gamma_r=${(1.0 - i).toFixed(3)}:gamma_b=${(1.0 + i).toFixed(3)}${POST}`;
    }
    case 'cool': {
      const i = parseFloat(params.intensity) || 0.15;
      // gamma_r > 1 → reduce red; gamma_b < 1 → boost blue
      return `eq=gamma_r=${(1.0 + i).toFixed(3)}:gamma_b=${(1.0 - i).toFixed(3)}${POST}`;
    }
    case 'glitch': {
      const intensity  = parseFloat(params.intensity) || 0.4;
      const glitchType = params.glitchType || 'continuous';
      const noiseLvl   = Math.round(10 + intensity * 50);   // 15..60
      const shift      = Math.max(1, Math.round(intensity * 8));  // 1..8 px
      let enableExpr = '';
      if (glitchType === 'bursts') {
        const rate    = parseFloat(params.burstRate) || 0.8;
        const period  = (1 / Math.max(0.1, rate)).toFixed(3);
        const burst   = '0.08';   // 80ms flash
        // Fires for `burst` seconds every `period` seconds
        enableExpr = `:enable='lt(mod(t\\,${period})\\,${burst})'`;
      }
      // rgbashift works in RGB (no green YUV-edge artifacts like chromashift)
      // edge=smear replicates edge pixels instead of filling with default
      return `noise=alls=${noiseLvl}:allf=t+u${enableExpr},rgbashift=rh=${shift}:bh=${-shift}:edge=smear${enableExpr}${POST}`;
    }
    case 'bw': {
      const strength = parseFloat(params.strength); // 0..1; default below
      const s        = isNaN(strength) ? 1.0 : Math.max(0, Math.min(1, strength));
      const contrast = parseFloat(params.contrast) || 1.0;
      // hue saturation: 0 = full grayscale, 1 = full color
      // For strength → saturation: s=1 → sat=0; s=0 → sat=1
      return `hue=s=${(1 - s).toFixed(3)},eq=contrast=${contrast.toFixed(3)}${POST}`;
    }
    case 'vhs': {
      const i = parseFloat(params.intensity) || 0.5;
      // Combine: subtle noise + rgbashift + slight desaturation + warm-ish gamma
      const noiseLvl = Math.round(i * 18);             // 0..18
      const shift    = Math.max(1, Math.round(i * 4)); // 1..4
      const sat      = (1.0 - i * 0.25).toFixed(3);    // 0.75..1.0
      const gammaR   = (1.0 + i * 0.10).toFixed(3);    // slight warm
      // rgbashift in RGB space + edge=smear → no green YUV artifacts on edges
      return `noise=alls=${noiseLvl}:allf=t+u,rgbashift=rh=${shift}:bh=${-shift}:edge=smear,eq=saturation=${sat}:gamma_r=${gammaR}${POST}`;
    }
    case 'cinematic': {
      const s = parseFloat(params.strength) || 0.5;
      // Teal-orange grade via colorbalance:
      //   shadows → blue/teal (rs<0, bs>0)
      //   highlights → orange (rh>0, bh<0)
      const shift = (s * 0.30).toFixed(3);
      return `colorbalance=rs=-${shift}:bs=${shift}:rh=${shift}:bh=-${shift}${POST}`;
    }
    case 'sepia': {
      const s  = parseFloat(params.strength); // 0..1
      const k  = isNaN(s) ? 1.0 : Math.max(0, Math.min(1, s));
      // Blend identity matrix with full-sepia matrix by k
      // identity: rr=1 rg=0 rb=0 / gr=0 gg=1 gb=0 / br=0 bg=0 bb=1
      // sepia:    rr=.393 rg=.769 rb=.189 / gr=.349 gg=.686 gb=.168 / br=.272 bg=.534 bb=.131
      const rr = (1   - 0.607 * k).toFixed(4);
      const rg = (0.769 * k).toFixed(4);
      const rb = (0.189 * k).toFixed(4);
      const gr = (0.349 * k).toFixed(4);
      const gg = (1   - 0.314 * k).toFixed(4);
      const gb = (0.168 * k).toFixed(4);
      const br = (0.272 * k).toFixed(4);
      const bg = (0.534 * k).toFixed(4);
      const bb = (1   - 0.869 * k).toFixed(4);
      return `colorchannelmixer=${rr}:${rg}:${rb}:0:${gr}:${gg}:${gb}:0:${br}:${bg}:${bb}:0${POST}`;
    }
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

// ── Position alignment map ────────────────────────────────────────────────────
// 15-key (3×5) → ASS \an value + row type (for \pos override where needed)
const _POS_MAP = {
  tl:{an:7,row:'top'},    tc:{an:8,row:'top'},    tr:{an:9,row:'top'},
  ul:{an:7,row:'upper'},  uc:{an:8,row:'upper'},  ur:{an:9,row:'upper'},
  ml:{an:4,row:'middle'}, mc:{an:5,row:'middle'}, mr:{an:6,row:'middle'},
  ll:{an:1,row:'lower'},  lc:{an:2,row:'lower'},  lr:{an:3,row:'lower'},
  bl:{an:1,row:'bottom'}, bc:{an:2,row:'bottom'}, br:{an:3,row:'bottom'},
};

// ── Group raw word array into subtitle lines ──────────────────────────────────
function _groupWords(words, wordsPerLine) {
  if (!words || !words.length) return [];
  const n = (wordsPerLine > 0) ? wordsPerLine : words.length;
  const subs = [];
  for (let i = 0; i < words.length; i += n) {
    const chunk = words.slice(i, i + n);
    const text  = chunk.map(w => w.text).join(' ');
    const start = chunk[0].start;
    const end   = chunk[chunk.length - 1].end;
    if (text && end > start) subs.push({ text, start, end, words: chunk });
  }
  return subs;
}

// ── Build .ass subtitle file content ─────────────────────────────────────────
function _buildAssContent(subtitlesIn, assSettings, W, H, srtWords) {
  const {
    fontName        = 'Arial',
    fontSize        = 60,
    bold            = false,
    italic          = false,
    primaryColor    = '#ffffff',
    outlineColor    = '#000000',
    shadowColor     = '#000000',
    backColor       = '#000000',
    backAlpha       = 128,
    borderStyle     = 1,
    outline         = 2.5,
    shadow          = 1,
    blur            = 0,
    posAlign        = 'bc',
    rotationPreset  = 'none',
    animPreset      = 'none',
    appearPreset    = 'fade_std',
    karaokeStyle    = 'none',
    wrapStyle       = 0,
    wordsPerLine    = 7,
  } = assSettings;

  // Re-group if we have raw words
  const subtitles = (srtWords && srtWords.length && wordsPerLine > 0)
    ? _groupWords(srtWords, wordsPerLine)
    : subtitlesIn;

  const primaryAss = _hexToAss(primaryColor, 0);
  const outlineAss = _hexToAss(outlineColor, 0);
  const shadowAss  = _hexToAss(shadowColor, 0);
  const backAss    = _hexToAss(backColor, backAlpha);
  const boldInt    = bold   ? -1 : 0;
  const italicInt  = italic ? -1 : 0;

  // Resolve position
  const pos        = _POS_MAP[posAlign] || _POS_MAP['bc'];
  const anValue    = pos.an;
  const marginV    = 60;
  const marginL    = 20;
  const marginR    = 20;

  // Compute \pos for upper/lower rows (top/middle/bottom use standard ASS alignments)
  const colKey = posAlign ? posAlign.slice(1) : 'c';
  const cx = colKey === 'l' ? Math.round(W * 0.12) : colKey === 'r' ? Math.round(W * 0.88) : Math.round(W / 2);
  let needPos = false, posY = 0;
  if (pos.row === 'upper') { needPos = true; posY = Math.round(H * 0.25); }
  if (pos.row === 'lower') { needPos = true; posY = Math.round(H * 0.72); }
  // middle row → ASS \an 4/5/6 (native center row, no \pos needed)

  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'Collisions: Normal',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    `WrapStyle: ${wrapStyle}`,
    'Timer: 100.0000',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontName},${fontSize},${primaryAss},&H000000FF,${outlineAss},${backAss},${boldInt},${italicInt},0,0,100,100,0,0,${borderStyle},${parseFloat(outline).toFixed(1)},${parseFloat(shadow).toFixed(1)},${anValue},${marginL},${marginR},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  for (const sub of subtitles) {
    if (!sub.text || sub.end <= sub.start) continue;
    const t0  = _fmtAssTime(sub.start);
    const t1  = _fmtAssTime(sub.end);
    const dur = sub.end - sub.start;   // seconds

    let ov = '';

    // ── Position override for upper/lower rows ──────────────────────────────
    if (needPos) ov += `\\an${anValue}\\pos(${cx},${posY})`;

    // ── 3D Rotation preset ──────────────────────────────────────────────────
    if (rotationPreset === 'tilt_left')   ov += '\\frz8';
    else if (rotationPreset === 'tilt_right')  ov += '\\frz-8';
    else if (rotationPreset === 'tilt_strong') ov += '\\frz20';
    else if (rotationPreset === 'perspective') ov += '\\fry25\\frx5';
    else if (rotationPreset === 'flip3d')      ov += '\\frx180';

    // ── Blur ────────────────────────────────────────────────────────────────
    if (blur > 0) ov += `\\blur${parseFloat(blur).toFixed(1)}`;

    // ── Appearance preset (\fad / \move / \fscx) ───────────────────────────
    if (appearPreset === 'fade_std') {
      ov += '\\fad(200,150)';
    } else if (appearPreset === 'fade_soft') {
      ov += '\\fad(400,300)';
    } else if (appearPreset === 'pop_in') {
      ov += `\\fscx0\\fscy0\\t(0,150,\\fscx100\\fscy100)\\fad(0,150)`;
    } else if (appearPreset === 'slide_up') {
      const cy1 = needPos ? posY      : Math.round(H - marginV);
      const cy0 = cy1 + 80;
      ov += `\\an${anValue}\\move(${cx},${cy0},${cx},${cy1},0,250)\\fad(150,150)`;
    }

    // ── Animation preset via \t() ───────────────────────────────────────────
    if (animPreset === 'pulse') {
      ov += '\\t(0,400,\\fscx110\\fscy110)\\t(400,800,\\fscx100\\fscy100)';
    } else if (animPreset === 'grow_in') {
      ov += '\\fscx70\\fscy70\\t(0,300,\\fscx100\\fscy100)';
    } else if (animPreset === 'glow') {
      ov += `\\t(0,500,\\blur8)\\t(500,1000,\\blur${parseFloat(blur).toFixed(1) || '0'})`;
    } else if (animPreset === 'color_shift') {
      const sec2  = _hexToAss('#ffff00', 0);
      ov += `\\t(0,500,1c${sec2})\\t(500,1000,1c${primaryAss})`;
    } else if (animPreset === 'fade_combo') {
      ov += '\\alpha&HFF&\\t(0,250,\\alpha&H00&\\fscx100\\fscy100)\\fscx80\\fscy80';
    } else if (animPreset === 'wobble') {
      ov += '\\t(0,100,\\frz5)\\t(100,200,\\frz-5)\\t(200,300,\\frz3)\\t(300,400,\\frz0)';
    } else if (animPreset === 'outline_flash') {
      const flashOut = _hexToAss('#ffffff', 0);
      ov += `\\t(0,100,3c${flashOut})\\t(100,250,3c${outlineAss})`;
    } else if (animPreset === 'slow_zoom') {
      const ms = Math.round(dur * 1000);
      ov += `\\fscx95\\fscy95\\t(0,${ms},\\fscx105\\fscy105)`;
    }

    // ── Karaoke style (word-level timing) ───────────────────────────────────
    const words    = sub.words || [];
    const useKarao = karaokeStyle !== 'none' && words.length > 0;

    let text;
    if (useKarao) {
      const kTag = karaokeStyle === 'kf' ? 'kf' : karaokeStyle === 'ko' ? 'ko' : 'k';
      text = words.map(w => {
        const cs = Math.round((w.end - w.start) * 100);
        return `{\\${kTag}${cs}}${w.text}`;
      }).join(' ');
    } else {
      text = sub.text.replace(/\n/g, '\\N');
    }

    const tagBlock = ov ? `{${ov}}` : '';
    lines.push(`Dialogue: 0,${t0},${t1},Default,,0,0,0,,${tagBlock}${text}`);
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
                               segVolume,
                               segTransition, segTransitionParams = {},
                               segAnimation,  segAnimParams = {},
                               segFilter = 'none', segFilterParams = {},
                               segSfx, segSfxVolume,
                               biroTransition, biroTransitionParams = {},
                               biroAnimation,  biroAnimParams = {},
                               biroFilter = 'none', biroFilterParams = {},
                               biroSfx, biroSfxVolume,
                               outputLabel, advSettings = {}, subtitles = [],
                               srtSubtitles = [], srtWords = [], assSettings = {},
                               prebuiltAssPath = null, jobId }) {
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
    segs.push({ idx: inputIdx++, dur, reversed: !!sc.reversed });
  }

  if (segs.length === 0) throw new Error('Нет сегментов видео для рендера');

  // ── Biroly overlay inputs ─────────────────────────────────────────────────
  // -an: discard audio — many biro files have no audio; avoids [idx:a] stream errors
  for (const bc of clips) {
    const fp = _webToFs(bc.videoPath);
    if (!fp || !fs.existsSync(fp)) continue;
    const timelineDur = parseFloat(bc.end) - parseFloat(bc.start);
    if (timelineDur <= 0) continue;
    const trim  = parseFloat(bc.crop)  || 0;
    const speed = parseFloat(bc.speed) || 1;
    const start = parseFloat(bc.start);
    // Read (timelineDur * speed) seconds from source so setpts can compress/expand it to timelineDur.
    // -stream_loop -1 loops the file if it's shorter than sourceDur (e.g. a 2s clip filling 6s).
    const sourceDur = timelineDur * speed;
    args.push('-stream_loop', '-1', '-an', '-ss', String(trim), '-t', String(sourceDur.toFixed(6)), '-i', fp);
    biros.push({ idx: inputIdx++, start, end: parseFloat(bc.end), dur: timelineDur, speed, cropAlign: bc.cropAlign || 'center', reversed: !!bc.reversed });
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

  // Build N=5 stacked filters that approximate a smooth ramp (in + out).
  //   D:        transition duration (sec)   •   st: out-segment start time
  //   maxValue: filter intensity at the boundary (drops to maxValue/N at the inner step)
  //   makeFilter(value, t0, t1) returns a single filter string starting with ','.
  function _stackedRamp(D, st, maxValue, makeFilter) {
    const N = 5;
    const stepDur = D / N;
    let out = '';
    // In ramp: at boundary fully strong, fades inward
    for (let i = 0; i < N; i++) {
      const v  = maxValue * (1 - i / N);
      const t0 = (i * stepDur).toFixed(3);
      const t1 = ((i + 1) * stepDur).toFixed(3);
      out += makeFilter(v, t0, t1);
    }
    // Out ramp: mirrored — gradually intensifies toward end of clip
    for (let i = 0; i < N; i++) {
      const v  = maxValue * ((i + 1) / N);
      const t0 = (st + i * stepDur).toFixed(3);
      const t1 = (st + (i + 1) * stepDur).toFixed(3);
      out += makeFilter(v, t0, t1);
    }
    return out;
  }

  // Build paired-transition filter string for a clip of given duration.
  //   trans:  one of TRANS_OPTS values  •  dur: clip duration in seconds
  //   params: { duration?, intensity?, direction?, zoomFactor?, easing? }
  // Returns string with leading comma (or '' for none).
  function _pairedTrans(trans, dur, params = {}) {
    if (!trans || trans === 'none') return '';
    const D  = parseFloat(params.duration) || FD;
    const d  = Math.min(D, dur / 3).toFixed(3);
    const st = Math.max(0, dur - parseFloat(d)).toFixed(3);

    switch (trans) {
      case 'fade':
      case 'fadewhite':
      case 'fadegrays': {
        const color = trans === 'fadewhite' ? ':color=white'
                    : trans === 'fadegrays' ? ':color=gray'  : '';
        return `,fade=in:st=0:d=${d}${color},fade=out:st=${st}:d=${d}${color}`;
      }
      case 'blur': {
        const sigmaMax = parseFloat(params.intensity) || 20;
        return _stackedRamp(parseFloat(d), parseFloat(st), sigmaMax,
          (v, t0, t1) => `,gblur=sigma=${v.toFixed(2)}:enable='between(t\\,${t0}\\,${t1})'`);
      }
      case 'flash-white': {
        // Bright white flash at edges (fade through white)
        return `,fade=in:st=0:d=${d}:color=white,fade=out:st=${st}:d=${d}:color=white`;
      }
      case 'whip-pan-h': {
        // Asymmetric horizontal motion blur — stacked 5 steps for smooth ramp
        return _stackedRamp(parseFloat(d), parseFloat(st), 30,
          (v, t0, t1) => `,gblur=sigma=${v.toFixed(2)}:sigmaV=5:enable='between(t\\,${t0}\\,${t1})'`);
      }
      case 'whip-pan-v': {
        // Vertical motion blur — stacked 5 steps
        return _stackedRamp(parseFloat(d), parseFloat(st), 30,
          (v, t0, t1) => `,gblur=sigma=5:sigmaV=${v.toFixed(2)}:enable='between(t\\,${t0}\\,${t1})'`);
      }
      case 'zoom-punch-in':
      case 'zoom-punch-out': {
        // zoompan supports `on` (output frame counter) but NOT `t` in z expr.
        // Convert seconds → frames at 30fps.
        const zf       = parseFloat(params.zoomFactor) || 1.2;
        const dFrames  = Math.max(1, Math.round(parseFloat(d) * FPS));
        const stFrames = Math.max(0, Math.round(parseFloat(st) * FPS));
        const zfStr    = zf.toFixed(3);
        let zExpr;
        if (trans === 'zoom-punch-in') {
          // At on<dFrames: zoom from zf → 1; rest: 1
          zExpr = `if(lt(on\\,${dFrames})\\,${zfStr}-(${zfStr}-1)*on/${dFrames}\\,1)`;
        } else {
          // At on>stFrames: zoom from 1 → zf; rest: 1
          zExpr = `if(gt(on\\,${stFrames})\\,1+(${zfStr}-1)*(on-${stFrames})/${dFrames}\\,1)`;
        }
        // 2× resolution + lanczos downscale → eliminates sub-pixel shake
        return `,zoompan=z='${zExpr}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${2*W}x${2*H}:fps=${FPS},scale=${W}:${H}:flags=lanczos,format=yuv420p,setsar=1`;
      }
      case 'glitch': {
        const intensity = parseFloat(params.intensity) || 0.6;
        // noise=alls 0..100 — map intensity 0.3..1.0 → ~26..50
        const lvlMax = Math.round(20 + intensity * 30);
        return _stackedRamp(parseFloat(d), parseFloat(st), lvlMax,
          (v, t0, t1) => `,noise=alls=${Math.round(v)}:allf=t+u:enable='between(t\\,${t0}\\,${t1})'`);
      }
      default:
        return '';
    }
  }

  // Scale + animate + filter + paired-transition each segment, 30fps
  for (const s of segs) {
    const animF    = _animFilter(segAnimation, s.dur, W, H, segAnimParams);
    const filterF  = _filterFilter(segFilter, segFilterParams);
    const transF   = _pairedTrans(segTransition, s.dur, segTransitionParams);
    const revPrefix = s.reversed ? 'reverse,' : '';
    F.push(
      `[${s.idx}:v]${revPrefix}setpts=PTS-STARTPTS,format=yuv420p,setsar=1,` +
      `scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${FPS}` +
      (animF   ? `,${animF}`   : '') +
      (filterF ? `,${filterF}` : '') +
      transF + `[sv${s.idx}]`
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
    const animF   = _animFilter(biroAnimation, b.dur, W, H, biroAnimParams);
    const filterF = _filterFilter(biroFilter, biroFilterParams);
    const transF  = _pairedTrans(biroTransition, b.dur, biroTransitionParams);
    // setpts=(1/speed)*(PTS-STARTPTS): reset to t=0 AND apply playback speed.
    //   speed>1 → (1/speed)<1 → PTS shrink → faster; speed<1 → slower.
    // Source input was trimmed to (timelineDur*speed) so this always fills timelineDur exactly.
    // reverse filter (when enabled) reverses the trimmed segment before speed/crop are applied.
    const spdFactor  = (1 / (b.speed || 1)).toFixed(8);
    const spdFilter  = `setpts=${spdFactor}*(PTS-STARTPTS)`;
    const revPrefix  = b.reversed ? 'reverse,' : '';
    F.push(
      `[${b.idx}:v]${revPrefix}${spdFilter},format=yuv420p,setsar=1,` +
      `scale=${W}:${H}:force_original_aspect_ratio=increase:force_divisible_by=2,` +
      `crop=${W}:${H}:${b.cropAlign === 'left' ? '0' : b.cropAlign === 'right' ? 'iw-ow' : '(iw-ow)/2'}:0,setsar=1,fps=${FPS}` +
      (animF   ? `,${animF}`   : '') +
      (filterF ? `,${filterF}` : '') +
      transF +
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
    const revAPrefix = s.reversed ? 'areverse,' : '';
    F.push(
      `[${s.idx}:a]${revAPrefix}asetpts=PTS-STARTPTS,volume=${_sv},` +
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
    // aresample=async=1 compensates for any audio/video PTS drift caused by encoder delay or float rounding
    F.push(`${aMix[0]}aresample=async=1[finalA]`);
    finalA = 'finalA';
  } else {
    // normalize=0: don't divide by input count — each stream's volume= controls its level
    F.push(`${aMix.join('')}amix=inputs=${aMix.length}:duration=first:dropout_transition=0:normalize=0,aresample=async=1[finalA]`);
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
  let assFileTemp = false;   // true = we created it and should delete after render

  if (prebuiltAssPath && fs.existsSync(prebuiltAssPath)) {
    // Use the pre-built .ass file created when user clicked "Применить"
    assFilePath  = prebuiltAssPath;
    assFileTemp  = false;
    console.log(`[ass] using pre-built: ${path.basename(prebuiltAssPath)}`);
  } else {
    // Build on-the-fly (fallback: user never opened the modal or no pre-built)
    const activeSrtSubs = Array.isArray(srtSubtitles)
      ? srtSubtitles.filter(s => s.text && s.end > s.start)
      : [];
    const hasSrtContent = activeSrtSubs.length > 0 || (Array.isArray(srtWords) && srtWords.length > 0);
    if (hasSrtContent) {
      const assContent = _buildAssContent(activeSrtSubs, assSettings, W, H, srtWords);
      assFilePath  = path.join(TEMP_DIR, `ass_${jobId}.ass`);
      assFileTemp  = true;
      fs.writeFileSync(assFilePath, assContent, 'utf8');
    }
  }

  if (assFilePath) {
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
  // Sanitize for filesystem: strip Windows-unsafe chars but keep Cyrillic/em-dashes
  // so the filename mirrors the project title (date — time — scenario — model).
  const safeLabel = String(outputLabel || '')
    .replace(/[\\\/:*?"<>|]/g, '-')   // Windows-unsafe → hyphen (turns 21:38 into 21-38)
    .replace(/\s+/g, ' ')             // collapse whitespace
    .trim()
    .slice(0, 100) || 'render';
  const outName   = `local_${Date.now()}_${safeLabel}.mp4`;
  const outPath   = path.join(FINALS_DIR, outName);

  // Hard-cap output to total segment duration so music/sfx never extends the render
  const totalDuration = segs.reduce((acc, s) => acc + s.dur, 0);

  args.push('-filter_complex', F.join(';'));
  args.push('-map', `[${finalV}]`);
  args.push('-map', `[${finalA}]`);
  args.push('-t', totalDuration.toFixed(3));
  args.push('-c:v', 'libx264', '-preset', String(preset), '-crf', String(parseInt(crf) || 23));
  args.push('-c:a', 'aac', '-b:a', String(audioBitrate) || '192k');
  args.push('-movflags', '+faststart');
  args.push('-y', outPath);

  await _execFfmpeg(args, jobId);
  if (assFilePath && assFileTemp) { try { fs.unlinkSync(assFilePath); } catch {} }
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
    if (_jobs[jobId]) _jobs[jobId].proc = proc;
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
      if (_jobs[jobId]) _jobs[jobId].proc = null;
      if (_jobs[jobId]?.status === 'cancelled') {
        reject(new Error('cancelled'));
      } else if (code === 0) {
        console.log(`[ffmpeg] done job=${jobId}`);
        resolve();
      } else {
        reject(new Error(`FFmpeg ошибка (код ${code}): ${stderr.slice(-600)}`));
      }
    });

    proc.on('error', err => reject(err));
  });
}

// ── POST /api/ffmpeg/build-ass ────────────────────────────────────────────────
// Pre-builds a .ass subtitle file and stores it so the next render uses it.
// Body: { srtSubtitles, srtWords, assSettings, resolution, sessionKey }
router.post('/ffmpeg/build-ass', (req, res) => {
  const {
    srtSubtitles = [],
    srtWords     = [],
    assSettings  = {},
    resolution   = '1080x1920',
    sessionKey   = 'default',
  } = req.body;

  const [W, H] = resolution.split('x').map(Number).map(n => (n > 0 ? n : 1080));
  const activeSubs = Array.isArray(srtSubtitles)
    ? srtSubtitles.filter(s => s.text && s.end > s.start)
    : [];
  const hasContent = activeSubs.length > 0 || (Array.isArray(srtWords) && srtWords.length > 0);

  if (!hasContent) {
    return res.json({ success: false, error: 'Нет данных субтитров для сборки' });
  }

  try {
    const assContent = _buildAssContent(activeSubs, assSettings, W, H, srtWords);
    // sanitise sessionKey for use as filename
    const safeName   = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const fname      = `ass_${safeName}.ass`;
    const fpath      = path.join(ASS_DIR, fname);
    fs.writeFileSync(fpath, assContent, 'utf8');
    console.log(`[ass] built ${fname} (${assContent.length} bytes)`);
    res.json({ success: true, assFilePath: fpath });
  } catch (e) {
    console.error('[ass] build error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
