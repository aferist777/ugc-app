/* scen-ffmpeg-modal.js — ADV_DEFAULTS, FFmpeg advanced-settings modal, ASS subtitle modal, _parseSrt */

// ── Advanced-settings modal (global, one instance shared across sessions) ─────
let _advModalInited = false;
let _advCurSessionKey = null;

function _advSlider(id, valId, fmt) {
  const sl = document.getElementById(id);
  const vl = document.getElementById(valId);
  if (!sl || !vl) return;
  sl.addEventListener('input', () => { vl.textContent = fmt(parseFloat(sl.value)); });
}

function _advSubsToggle() {
  const enabled = document.getElementById('adv-subs-enabled')?.checked;
  const opts    = document.getElementById('adv-subs-opts');
  if (opts) opts.classList.toggle('adv-hidden', !enabled);
}

function _openAdvModal(sessionKey) {
  if (!_advModalInited) {
    _advModalInited = true;
    document.getElementById('adv-modal-close') .addEventListener('click',  _closeAdvModal);
    document.getElementById('adv-modal-cancel').addEventListener('click',  _closeAdvModal);
    document.getElementById('adv-modal-apply') .addEventListener('click',  _applyAdvModal);
    document.getElementById('adv-modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('adv-modal-overlay')) _closeAdvModal();
    });
    _advSlider('adv-crf',        'adv-crf-val',        v => v.toFixed(0));
    _advSlider('adv-brightness', 'adv-brightness-val', v => v.toFixed(2));
    _advSlider('adv-contrast',   'adv-contrast-val',   v => v.toFixed(2));
    _advSlider('adv-saturation', 'adv-saturation-val', v => v.toFixed(2));
    _advSlider('adv-gamma',      'adv-gamma-val',      v => v.toFixed(2));
    _advSlider('adv-subs-size',  'adv-subs-size-val',  v => v.toFixed(0));
    document.getElementById('adv-subs-enabled')?.addEventListener('change', _advSubsToggle);
  }
  _advCurSessionKey = sessionKey;
  const tlData = getTimelineData();
  const adv = { ...ADV_DEFAULTS, ...(tlData[sessionKey]?.advSettings || {}) };
  _populateAdvModal(adv);
  document.getElementById('adv-modal-overlay').classList.add('open');
}

function _closeAdvModal() {
  document.getElementById('adv-modal-overlay').classList.remove('open');
}

function _populateAdvModal(adv) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
  const setVal = (valId, v, fmt) => { const el = document.getElementById(valId); if (el) el.textContent = fmt(v); };

  set('adv-resolution',   adv.resolution);
  set('adv-fps',          String(adv.fps));
  set('adv-crf',          String(adv.crf));          setVal('adv-crf-val',        adv.crf,          v => v.toFixed(0));
  set('adv-preset',       adv.preset);
  set('adv-audio-bitrate', adv.audioBitrate);
  set('adv-brightness',   String(adv.eqBrightness)); setVal('adv-brightness-val', adv.eqBrightness, v => v.toFixed(2));
  set('adv-contrast',     String(adv.eqContrast));   setVal('adv-contrast-val',   adv.eqContrast,   v => v.toFixed(2));
  set('adv-saturation',   String(adv.eqSaturation)); setVal('adv-saturation-val', adv.eqSaturation, v => v.toFixed(2));
  set('adv-gamma',        String(adv.eqGamma));      setVal('adv-gamma-val',      adv.eqGamma,      v => v.toFixed(2));
  setChk('adv-subs-enabled', adv.subsEnabled);
  set('adv-subs-size',    String(adv.subsFontSize)); setVal('adv-subs-size-val',  adv.subsFontSize, v => v.toFixed(0));
  set('adv-subs-pos',     adv.subsPosition);
  set('adv-subs-color',   adv.subsColor);
  set('adv-subs-style',   adv.subsStyle);
  _advSubsToggle();
}

function _readAdvModal() {
  const num  = id => parseFloat(document.getElementById(id)?.value) || 0;
  const str  = id => document.getElementById(id)?.value || '';
  const chk  = id => !!document.getElementById(id)?.checked;
  return {
    resolution:   str('adv-resolution')   || ADV_DEFAULTS.resolution,
    fps:          parseInt(str('adv-fps')) || ADV_DEFAULTS.fps,
    crf:          parseInt(str('adv-crf')) || ADV_DEFAULTS.crf,
    preset:       str('adv-preset')       || ADV_DEFAULTS.preset,
    audioBitrate: str('adv-audio-bitrate')|| ADV_DEFAULTS.audioBitrate,
    eqBrightness: num('adv-brightness'),
    eqContrast:   num('adv-contrast')   || 1,
    eqSaturation: num('adv-saturation') || 1,
    eqGamma:      num('adv-gamma')      || 1,
    subsEnabled:  chk('adv-subs-enabled'),
    subsFontSize: parseInt(str('adv-subs-size')) || ADV_DEFAULTS.subsFontSize,
    subsPosition: str('adv-subs-pos')   || ADV_DEFAULTS.subsPosition,
    subsColor:    str('adv-subs-color') || ADV_DEFAULTS.subsColor,
    subsStyle:    str('adv-subs-style') || ADV_DEFAULTS.subsStyle,
  };
}

function _applyAdvModal() {
  const adv = _readAdvModal();
  const d   = getTimelineData();
  if (!d[_advCurSessionKey]) d[_advCurSessionKey] = {};
  d[_advCurSessionKey].advSettings = adv;
  setTimelineData(d);
  _closeAdvModal();
}

// ── ASS subtitle styling modal ────────────────────────────────────────────────
const ASS_DEFAULTS = {
  fontName:        'Arial',
  fontSize:        60,
  bold:            false,
  italic:          false,
  primaryColor:    '#ffffff',
  outlineColor:    '#000000',
  shadowColor:     '#000000',
  backColor:       '#000000',
  backAlpha:       128,
  borderStyle:     1,
  outline:         2.5,
  shadow:          1,
  blur:            0,
  posAlign:        'bc',       // tl/tc/tr/ul/uc/ur/ml/mc/mr/ll/lc/lr/bl/bc/br (15 positions)
  rotationPreset:  'none',
  animPreset:      'none',
  appearPreset:    'fade_std',
  karaokeStyle:    'none',
  wrapStyle:       0,
  wordsPerLine:    7,
};

// ── Available fonts for subtitle dropdown ─────────────────────────────────────
const ASS_FONTS = [
  { name: 'Impact',            css: 'Impact, fantasy' },
  { name: 'Arial',             css: 'Arial, sans-serif' },
  { name: 'Arial Black',       css: '"Arial Black", sans-serif' },
  { name: 'Helvetica',         css: 'Helvetica, Arial, sans-serif' },
  { name: 'Verdana',           css: 'Verdana, sans-serif' },
  { name: 'Tahoma',            css: 'Tahoma, sans-serif' },
  { name: 'Trebuchet MS',      css: '"Trebuchet MS", sans-serif' },
  { name: 'Comic Sans MS',     css: '"Comic Sans MS", cursive' },
  { name: 'Times New Roman',   css: '"Times New Roman", serif' },
  { name: 'Georgia',           css: 'Georgia, serif' },
  { name: 'Courier New',       css: '"Courier New", monospace' },
  { name: 'Palatino Linotype', css: '"Palatino Linotype", serif' },
];

// position grid definition: key → {col, row} — 3×5 = 15 positions
const _ASS_POS_KEYS = [
  {k:'tl',col:'l',row:'top'},    {k:'tc',col:'c',row:'top'},    {k:'tr',col:'r',row:'top'},
  {k:'ul',col:'l',row:'upper'},  {k:'uc',col:'c',row:'upper'},  {k:'ur',col:'r',row:'upper'},
  {k:'ml',col:'l',row:'middle'}, {k:'mc',col:'c',row:'middle'}, {k:'mr',col:'r',row:'middle'},
  {k:'ll',col:'l',row:'lower'},  {k:'lc',col:'c',row:'lower'},  {k:'lr',col:'r',row:'lower'},
  {k:'bl',col:'l',row:'bottom'}, {k:'bc',col:'c',row:'bottom'}, {k:'br',col:'r',row:'bottom'},
];
const _POS_BAR_CSS = {
  top:    'top:3px;',
  upper:  'top:6px;',
  middle: 'top:calc(50% - 1px);',
  lower:  'bottom:6px;',
  bottom: 'bottom:3px;',
};
const _POS_COL_CSS = {
  l: 'left:2px;right:50%;',
  c: 'left:15%;right:15%;',
  r: 'left:50%;right:2px;',
};

let _assModalInited = false;
let _assCurSessionKey = null;

function _assSlider(id, valId, fmt) {
  const sl = document.getElementById(id);
  const vl = document.getElementById(valId);
  if (!sl || !vl) return;
  sl.addEventListener('input', () => { vl.textContent = fmt(parseFloat(sl.value)); });
}

function _assRadioInit(groupName) {
  document.querySelectorAll(`.ass-radio-opt[data-group="${groupName}"]`).forEach(lbl => {
    lbl.addEventListener('click', () => {
      document.querySelectorAll(`.ass-radio-opt[data-group="${groupName}"]`).forEach(l => l.classList.remove('active'));
      lbl.classList.add('active');
      const inp = lbl.querySelector('input[type=radio]');
      if (inp) inp.checked = true;
    });
  });
}

function _assRadioSet(name, val) {
  document.querySelectorAll(`[name="${name}"]`).forEach(inp => {
    inp.checked = (inp.value === String(val));
    inp.closest('.ass-radio-opt')?.classList.toggle('active', inp.value === String(val));
  });
}

function _openAssModal(sessionKey) {
  if (!_assModalInited) {
    _assModalInited = true;
    document.getElementById('ass-modal-close') .addEventListener('click',  _closeAssModal);
    document.getElementById('ass-modal-cancel').addEventListener('click',  _closeAssModal);
    document.getElementById('ass-modal-apply') .addEventListener('click',  _applyAssModal);
    document.getElementById('ass-modal-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('ass-modal-overlay')) _closeAssModal();
    });
    // Sliders
    _assSlider('ass-font-size',  'ass-font-size-val',  v => v.toFixed(0));
    _assSlider('ass-back-alpha', 'ass-back-alpha-val', v => Math.round(v * 100 / 255) + '%');
    _assSlider('ass-outline',    'ass-outline-val',    v => v.toFixed(1));
    _assSlider('ass-shadow',     'ass-shadow-val',     v => v.toFixed(1));
    _assSlider('ass-blur',       'ass-blur-val',       v => v.toFixed(1));
    // Bold/italic toggle
    ['ass-bold-chk','ass-italic-chk'].forEach(id => {
      const lbl = document.getElementById(id);
      if (!lbl) return;
      lbl.addEventListener('click', () => {
        const chk = lbl.querySelector('input[type=checkbox]');
        if (!chk) return;
        setTimeout(() => lbl.classList.toggle('active', chk.checked), 0);
      });
    });
    // Build position grid
    const grid = document.getElementById('ass-pos-grid');
    if (grid) {
      _ASS_POS_KEYS.forEach(({k, col, row}) => {
        const btn = document.createElement('button');
        btn.className = 'ass-pos-btn';
        btn.dataset.posKey = k;
        const bar = document.createElement('div');
        bar.className = 'ass-pos-bar';
        bar.style.cssText = _POS_BAR_CSS[row] + _POS_COL_CSS[col];
        btn.appendChild(bar);
        btn.addEventListener('click', () => {
          document.querySelectorAll('.ass-pos-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
        grid.appendChild(btn);
      });
    }
    // Radio rows (scoped by data-group)
    _assRadioInit('karaoke');
    _assRadioInit('wrap');
    // Font dropdown
    const fontList = document.getElementById('ass-font-list');
    if (fontList && !fontList.hasChildNodes()) {
      ASS_FONTS.forEach(f => {
        const opt = document.createElement('div');
        opt.className = 'ass-font-opt';
        opt.dataset.font = f.name;
        opt.style.fontFamily = f.css;
        opt.textContent = f.name;
        opt.addEventListener('click', e => {
          e.stopPropagation();
          document.querySelectorAll('.ass-font-opt').forEach(o => o.classList.remove('selected'));
          opt.classList.add('selected');
          document.getElementById('ass-font-name').value = f.name;
          const prev = document.getElementById('ass-font-preview');
          if (prev) { prev.textContent = f.name; prev.style.fontFamily = f.css; }
          fontList.classList.remove('open');
        });
        fontList.appendChild(opt);
      });
    }
    const fontSel = document.getElementById('ass-font-sel');
    if (fontSel) {
      fontSel.addEventListener('click', e => {
        e.stopPropagation();
        fontList?.classList.toggle('open');
      });
    }
    document.addEventListener('click', () => fontList?.classList.remove('open'));
  }
  _assCurSessionKey = sessionKey;
  const tlData = getTimelineData();
  const ass = { ...ASS_DEFAULTS, ...(tlData[sessionKey]?.assSettings || {}) };
  _populateAssModal(ass);
  document.getElementById('ass-modal-overlay').classList.add('open');
}

function _closeAssModal() {
  document.getElementById('ass-modal-overlay').classList.remove('open');
}

function _populateAssModal(ass) {
  const set    = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const setChk = (id, v) => { const el = document.getElementById(id); if (el) { el.checked = !!v; el.closest('.ass-chk')?.classList.toggle('active', !!v); } };
  const setVal = (valId, v, fmt) => { const el = document.getElementById(valId); if (el) el.textContent = fmt(v); };

  // Font name (hidden input + dropdown preview)
  const fn = ass.fontName || 'Arial';
  set('ass-font-name', fn);
  const fontEntry = ASS_FONTS.find(f => f.name === fn);
  const fontCss   = fontEntry ? fontEntry.css : `"${fn}", sans-serif`;
  const prevEl = document.getElementById('ass-font-preview');
  if (prevEl) { prevEl.textContent = fn; prevEl.style.fontFamily = fontCss; }
  document.querySelectorAll('.ass-font-opt').forEach(o => o.classList.toggle('selected', o.dataset.font === fn));
  set('ass-font-size',     String(ass.fontSize));    setVal('ass-font-size-val', ass.fontSize, v => v.toFixed(0));
  setChk('ass-bold',       ass.bold);
  setChk('ass-italic',     ass.italic);
  set('ass-primary-color', ass.primaryColor);
  set('ass-outline-color', ass.outlineColor);
  set('ass-shadow-color',  ass.shadowColor);
  set('ass-back-color',    ass.backColor);
  set('ass-back-alpha',    String(ass.backAlpha));   setVal('ass-back-alpha-val', ass.backAlpha, v => Math.round(v * 100 / 255) + '%');
  set('ass-border-style',  String(ass.borderStyle));
  set('ass-outline',       String(ass.outline));     setVal('ass-outline-val', ass.outline, v => v.toFixed(1));
  set('ass-shadow',        String(ass.shadow));      setVal('ass-shadow-val', ass.shadow, v => v.toFixed(1));
  set('ass-blur',          String(ass.blur));        setVal('ass-blur-val', ass.blur, v => v.toFixed(1));
  // Position grid
  const posKey = ass.posAlign || 'bc';
  document.querySelectorAll('.ass-pos-btn').forEach(b => b.classList.toggle('active', b.dataset.posKey === posKey));
  // Presets
  set('ass-rotation-preset', ass.rotationPreset || 'none');
  set('ass-anim-preset',     ass.animPreset     || 'none');
  set('ass-appear-preset',   ass.appearPreset   || 'none');
  // Radio groups
  _assRadioSet('ass-karaoke', ass.karaokeStyle || 'none');
  _assRadioSet('ass-wrap',    String(ass.wrapStyle ?? 0));
  // Words per line
  set('ass-words-per-line', String(ass.wordsPerLine ?? 7));
}

function _readAssModal() {
  const num    = id => parseFloat(document.getElementById(id)?.value) || 0;
  const str    = id => document.getElementById(id)?.value || '';
  const chk    = id => !!document.getElementById(id)?.checked;
  const radio  = name => document.querySelector(`[name="${name}"]:checked`)?.value || '';
  const posBtn = () => document.querySelector('.ass-pos-btn.active')?.dataset.posKey || 'bc';
  return {
    fontName:       str('ass-font-name')     || ASS_DEFAULTS.fontName,
    fontSize:       parseInt(str('ass-font-size')) || ASS_DEFAULTS.fontSize,
    bold:           chk('ass-bold'),
    italic:         chk('ass-italic'),
    primaryColor:   str('ass-primary-color') || ASS_DEFAULTS.primaryColor,
    outlineColor:   str('ass-outline-color') || ASS_DEFAULTS.outlineColor,
    shadowColor:    str('ass-shadow-color')  || ASS_DEFAULTS.shadowColor,
    backColor:      str('ass-back-color')    || ASS_DEFAULTS.backColor,
    backAlpha:      Math.round(num('ass-back-alpha')),
    borderStyle:    parseInt(str('ass-border-style')) || 1,
    outline:        num('ass-outline'),
    shadow:         num('ass-shadow'),
    blur:           num('ass-blur'),
    posAlign:       posBtn(),
    rotationPreset: str('ass-rotation-preset') || 'none',
    animPreset:     str('ass-anim-preset')     || 'none',
    appearPreset:   str('ass-appear-preset')   || 'none',
    karaokeStyle:   radio('ass-karaoke')       || 'none',
    wrapStyle:      parseInt(radio('ass-wrap') || '0'),
    wordsPerLine:   parseInt(str('ass-words-per-line')) || 7,
  };
}

async function _applyAssModal() {
  const ass = _readAssModal();
  const d   = getTimelineData();
  if (!d[_assCurSessionKey]) d[_assCurSessionKey] = {};
  d[_assCurSessionKey].assSettings = ass;

  // Show building status in the Apply button
  const applyBtn = document.getElementById('ass-modal-apply');
  const origText = applyBtn?.textContent || '✓ Применить';
  if (applyBtn) { applyBtn.textContent = '⏳ Сборка…'; applyBtn.disabled = true; }

  try {
    const sd           = d[_assCurSessionKey];
    const srtSubtitles = sd.srtSubtitles || [];
    const srtWords     = sd.srtWords     || [];
    const resolution   = sd.advSettings?.resolution || '1080x1920';

    if (srtSubtitles.length > 0 || srtWords.length > 0) {
      const r  = await fetch('/api/ffmpeg/build-ass', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ srtSubtitles, srtWords, assSettings: ass, resolution, sessionKey: _assCurSessionKey }),
      });
      const rj = await r.json();
      if (rj.success) {
        d[_assCurSessionKey].prebuiltAssPath = rj.assFilePath;
        if (applyBtn) applyBtn.textContent = '✓ Готово!';
        await new Promise(res => setTimeout(res, 600));
      } else {
        console.warn('[ass] build-ass error:', rj.error);
      }
    }
  } catch (e) {
    console.warn('[ass] build-ass fetch error:', e.message);
  } finally {
    if (applyBtn) { applyBtn.textContent = origText; applyBtn.disabled = false; }
  }

  setTimelineData(d);
  _closeAssModal();
}

// ── Parse SRT content to [{text,start,end}] ───────────────────────────────────
function _parseSrt(srtContent) {
  const blocks = (srtContent || '').trim().split(/\n\n+/);
  const subs = [];
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const timeLine = lines.find(l => l.includes('-->'));
    if (!timeLine) continue;
    const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());
    const parseTime = s => {
      const [h, m, rest] = s.split(':');
      const [sec, ms] = rest.replace(',', '.').split('.');
      return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(sec) + parseInt(ms || 0) / 1000;
    };
    const textLines = lines.slice(lines.indexOf(timeLine) + 1).filter(Boolean);
    const text = textLines.join(' ').trim();
    if (text) subs.push({ text, start: parseTime(startStr), end: parseTime(endStr) });
  }
  return subs;
}

