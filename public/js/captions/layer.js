/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — the preview draws them with the render's own libass (phase K4, 2026-10-03).

   JASSUB is libass compiled to WebAssembly (tools/fetch-jassub.js lays it out in vendor/jassub/). The
   preview's captions used to be a canvas imitation of libass that had to be taught every effect twice;
   now the page builds the SAME .ass the render burns (ass.js) and libass draws it, in the SAME font
   files (fonts.js, handed over as files - `queryFonts: false`, or Electron would lend it the system's
   fonts and the screen would stop matching the file).

   JASSUB draws on a canvas of its own, handed to its worker (transferControlToOffscreen) - so this
   layer is a second canvas laid exactly over the FRAME inside the preview's stage, clicks passing
   through it, and the preview tells it the time (manualRender) whenever it paints. Until the worker is
   up, or if it cannot start, the preview's own painter (js/merge-v3/subs-b.js) draws instead.
   ═══════════════════════════════════════════════════════════════════════════ */

import { buildAss } from './ass.js';
import { captionLanes, renderFrame } from './style.js';
import { fontFiles } from './fonts.js';

const BASE = '/vendor/jassub/';
const abs = (u) => new URL(u, location.href).href;
const EMPTY = (w, h) => '[Script Info]\nScriptType: v4.00+\nPlayResX: ' + w + '\nPlayResY: ' + h + '\n\n[V4+ Styles]\n'
  + 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
  + 'Style: Default,Liberation Sans,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n\n[Events]\n'
  + 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';

let _jas = null;
let _canvas = null;
let _state = 'off';            // off | starting | ready | failed
let _ass = '';
let _frame = renderFrame('9:16');
let _at = 0;
let _shown = true;
let _onReady = null;

/** Drawing with libass right now? When not, the caller draws the captions itself. */
export const ready = () => _state === 'ready' && _shown;

/**
 * Lay the layer over a stage and start the worker. `onReady` is called once it can draw - the preview
 * repaints then, so the first frame is libass's rather than the painter's.
 */
export function attach(stage, onReady) {
  if (!stage) return;
  // Mounted again (the stage was emptied): the same canvas goes back - it belongs to the worker now.
  if (_canvas) { if (!_canvas.isConnected) stage.appendChild(_canvas); return; }
  _onReady = typeof onReady === 'function' ? onReady : null;
  _canvas = document.createElement('canvas');
  _canvas.className = 'mv3-cap-layer';
  // Above the picture, under nothing that is clicked: the grips and the crop live on the canvas below.
  Object.assign(_canvas.style, { position: 'absolute', pointerEvents: 'none', left: '0', top: '0', width: '0', height: '0' });
  stage.appendChild(_canvas);
  _start();
}

async function _start() {
  _state = 'starting';
  try {
    const { default: JASSUB } = await import(BASE + 'jassub.js');
    const wasm = abs(BASE + 'wasm/jassub-worker-modern.wasm');
    _jas = new JASSUB({
      canvas: _canvas,
      subContent: _ass || EMPTY(_frame.w, _frame.h),
      workerUrl: abs(BASE + 'worker/worker.js'),
      wasmUrl: wasm, modernWasmUrl: wasm,
      fonts: fontFiles().map(abs),
      queryFonts: false,
      // What a font lacks (Liberation Sans and Russo One have no ₽) is drawn in PT Sans, which has it -
      // the render's libass borrows it from Windows (Arial) for the same letters.
      defaultFont: 'pt sans',
      // The preview is small; libass draws at the canvas's own pixels and no more.
      prescaleHeightLimit: 1920,
    });
    await _jas.ready;
    _state = 'ready';
    if (_ass) await _jas.renderer.setTrack(_ass);
    _draw(true);
    if (_onReady) _onReady();
  } catch (e) {
    _state = 'failed';
    console.warn('[captions] libass in the page did not start - the painter draws them:', (e && e.message) || e);
    if (_canvas) _canvas.style.display = 'none';
  }
}

/** Where the frame is on the stage, as fractions of it - the layer covers exactly that. */
export function place(left, top, width, height) {
  if (!_canvas) return;
  const pc = (v) => (v * 100).toFixed(4) + '%';
  Object.assign(_canvas.style, { left: pc(left), top: pc(top), width: pc(width), height: pc(height) });
}

/** Hidden while the stage shows something that is not the timeline (the workshop borrows it). */
export function show(on) {
  _shown = !!on;
  if (_canvas) _canvas.style.visibility = (_shown && _state !== 'failed') ? 'visible' : 'hidden';
}

/** The project's captions, built into an .ass the way the render builds them. */
export function setTimeline(tl) {
  const fmt = (tl && tl.format) || '9:16';
  _frame = renderFrame(fmt);
  const ass = buildAss(captionLanes(tl), _frame.w, _frame.h) || EMPTY(_frame.w, _frame.h);
  if (ass === _ass) return;
  _ass = ass;
  if (_state !== 'ready') return;
  _jas.renderer.setTrack(ass).then(() => _draw(true)).catch(() => {});
}

/** The frame at this moment of the film. */
export function render(at) {
  _at = Math.max(0, +at || 0);
  if (_state === 'ready' && _shown) _draw(false);
}

function _draw(repaint) {
  if (!_jas) return;
  try {
    _jas.manualRender({ mediaTime: _at, width: _frame.w, height: _frame.h, expectedDisplayTime: performance.now() }, !!repaint);
  } catch (e) { /* the next paint asks again */ }
}
