/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the platforms' screens over the preview.

   Three marks in the preview's header, right of "Preview": TikTok, Shorts, Instagram (Simple Icons, CC0,
   one colour). A press lays that app's screen over the frame - its buttons down the right, the account
   and the description at the bottom, the tabs at the top - drawn by us, white with a shadow, so a caption
   can be placed where the app will not cover it; another mark switches, the same one again takes it off.
   It is the EDITOR's: a DOM drawing over the stage that the mouse passes through (the grips and outlines
   stay on top), never in a render or a screenshot. 9:16 only - in 16:9 the marks are dim. The one shown is
   remembered (localStorage, mirrored into the library by storage-sync).

   THE SIZES ARE AN ORDINARY POST'S (not an ad's), measured on an iPhone (1290x2796) and said in a 1080x1920
   frame: on a tall phone the video fills the
   screen from the top down to the app's bottom bar, 9:16 stretched to that height, so ~54 px of the frame are
   cut off at each side - dimmed here for all three. The same table is the drawing and the check (zones):
   a page of captions under an element is outlined in red (cap-place.js) and counted in the strip (only a
   mark: nothing is refused or moved).
   ═══════════════════════════════════════════════════════════════════════════ */

const LS = 'mv3_pv_platform_v1';
const NS = 'http://www.w3.org/2000/svg';

// Simple Icons 13.21.0 (CC0): tiktok, youtubeshorts, instagram - in a 24x24 box.
const ICON = {
  tiktok: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z',
  shorts: 'm18.931 9.99-1.441-.601 1.717-.913a4.48 4.48 0 0 0 1.874-6.078 4.506 4.506 0 0 0-6.09-1.874L4.792 5.929a4.504 4.504 0 0 0-2.402 4.193 4.521 4.521 0 0 0 2.666 3.904c.036.012 1.442.6 1.442.6l-1.706.901a4.51 4.51 0 0 0-2.369 3.967A4.528 4.528 0 0 0 6.93 24c.725 0 1.437-.174 2.08-.508l10.21-5.406a4.494 4.494 0 0 0 2.39-4.192 4.525 4.525 0 0 0-2.678-3.904ZM9.597 15.19V8.824l6.007 3.184z',
  reels: 'M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077',
};

// ── The table: what each app lays over an ordinary post, x0, y0, x1, y1 in a 1080x1920 frame ──
const STATUS = { g: 'status bar', r: [0, 0, 1080, 100] };
const PROGRESS = { g: 'progress bar', r: [0, 1895, 1080, 1920] };
const EDGES = [{ g: 'edges a tall phone cuts off', r: [0, 0, 54, 1920] }, { g: 'edges a tall phone cuts off', r: [1026, 0, 1080, 1920] }];

export const PLATFORMS = {
  tiktok: {
    name: 'TikTok',
    zones: [STATUS,
      { g: 'tabs', r: [80, 150, 1000, 235] },
      { g: 'buttons', r: [900, 1010, 1010, 1895] },
      { g: 'account', r: [78, 1735, 405, 1788] },
      { g: 'description', r: [78, 1808, 795, 1895] },
      PROGRESS, ...EDGES],
  },
  shorts: {
    name: 'Shorts',
    zones: [STATUS,
      { g: 'top buttons', r: [96, 160, 133, 214] }, { g: 'top buttons', r: [821, 159, 878, 216] }, { g: 'top buttons', r: [945, 163, 970, 212] },
      { g: 'buttons', r: [905, 1115, 1002, 1885] },
      { g: 'account', r: [86, 1668, 166, 1750] }, { g: 'account', r: [176, 1688, 362, 1735] }, { g: 'account', r: [375, 1668, 577, 1752] },
      { g: 'description', r: [86, 1760, 790, 1808] }, { g: 'description', r: [86, 1824, 848, 1887] },
      PROGRESS, ...EDGES],
  },
  reels: {
    name: 'Instagram',
    zones: [STATUS,
      { g: 'top buttons', r: [118, 160, 160, 220] },
      { g: 'buttons', r: [905, 1000, 1005, 1866] },
      { g: 'account', r: [86, 1705, 192, 1812] }, { g: 'account', r: [204, 1712, 575, 1797] }, { g: 'account', r: [592, 1729, 735, 1790] },
      { g: 'description', r: [86, 1830, 580, 1876] },
      PROGRESS, ...EDGES],
  },
};
const ORDER = ['tiktok', 'shorts', 'reels'];
const TITLE = { tiktok: 'TikTok', shorts: 'YouTube Shorts', reels: 'Instagram Reels' };

// ── The drawing: our own, white with a shadow, in the same frame ────────────
// Icons in a 100x100 box, placed by their middle.
const G = {
  heart: '<path d="M50 90C22 68 4 52 4 31A23 23 0 0 1 50 19A23 23 0 0 1 96 31C96 52 78 68 50 90Z"/>',
  bubble: '<path d="M50 8C77 8 96 26 96 48S77 88 50 88C44 88 38 87 33 85L10 94L17 74C8 67 4 58 4 48C4 26 23 8 50 8Z"/>',
  mark: '<path d="M18 4H82V96L50 72L18 96Z"/>',
  share: '<path d="M58 6L98 46L58 86V63C32 63 15 71 3 92C7 58 25 34 58 30Z"/>',
  up: '<path d="M6 42H24V94H6Z M30 42L50 6C59 6 64 13 62 24L58 38H88C95 38 99 45 97 52L87 88C85 92 81 94 76 94H30Z"/>',
  down: '<path transform="matrix(1 0 0 -1 0 100)" d="M6 42H24V94H6Z M30 42L50 6C59 6 64 13 62 24L58 38H88C95 38 99 45 97 52L87 88C85 92 81 94 76 94H30Z"/>',
  send: '<path fill="none" stroke="#fff" stroke-width="9" stroke-linejoin="round" d="M6 44L94 8L62 94L48 58Z M48 58L94 8"/>',
  repost: '<path fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" d="M16 46V30H80 M66 16L80 30L66 44 M84 54V70H20 M34 84L20 70L34 56"/>',
  remix: '<path fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" d="M78 32A36 36 0 1 0 84 58 M70 12L80 32L60 40"/>',
  dots: '<circle cx="14" cy="50" r="10"/><circle cx="50" cy="50" r="10"/><circle cx="86" cy="50" r="10"/>',
  search: '<circle cx="42" cy="42" r="30" fill="none" stroke="#fff" stroke-width="11"/><path stroke="#fff" stroke-width="12" stroke-linecap="round" d="M64 64L92 92"/>',
};
const icon = (name, cx, cy, size) => '<g transform="translate(' + (cx - size / 2) + ' ' + (cy - size / 2) + ') scale(' + (size / 100) + ')">' + G[name] + '</g>';
const text = (x, y, s, size, o) => '<text x="' + x + '" y="' + y + '" font-size="' + size + '"' + (o && o.bold ? ' font-weight="700"' : '')
  + (o && o.mid ? ' text-anchor="middle"' : '') + (o && o.fill ? ' fill="' + o.fill + '"' : '') + '>' + s + '</text>';
const counted = (name, cx, cy, size, label) => icon(name, cx, cy, size) + (label ? text(cx, cy + size / 2 + 34, label, 27, { bold: true, mid: true }) : '');

function _status() {
  return text(118, 70, '9:41', 40, { bold: true })
    + [0, 1, 2, 3].map((i) => '<rect x="' + (842 + i * 13) + '" y="' + (66 - i * 8) + '" width="9" height="' + (10 + i * 8) + '" rx="2"/>').join('')
    + '<path fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" d="M902 56A30 30 0 0 1 942 56 M911 66A16 16 0 0 1 933 66"/><circle cx="922" cy="75" r="4"/>'
    + '<rect x="958" y="50" width="56" height="28" rx="8" fill="none" stroke="#fff" stroke-width="4"/><rect x="963" y="55" width="40" height="18" rx="4"/>'
    + '<rect x="1017" y="59" width="5" height="10" rx="2"/>';
}
function _progress(played) {
  return '<rect x="0" y="1904" width="1080" height="5" fill-opacity=".35"/><rect x="0" y="1904" width="' + played + '" height="5"/>';
}
const _edges = () => '<g filter="none"><rect x="0" y="0" width="54" height="1920" fill="#000" fill-opacity=".45"/>'
  + '<rect x="1026" y="0" width="54" height="1920" fill="#000" fill-opacity=".45"/>'
  + '<path stroke="#fff" stroke-opacity=".5" stroke-width="2" stroke-dasharray="10 10" d="M54 0V1920 M1026 0V1920"/></g>';

const DRAW = {
  tiktok: () => _status()
    + text(122, 207, 'LIVE', 34, { bold: true, mid: true })
    + text(330, 207, 'Friends', 40, { mid: true }) + text(545, 207, 'Following', 40, { mid: true })
    + text(770, 207, 'For You', 42, { bold: true, mid: true }) + '<rect x="732" y="224" width="76" height="6" rx="3"/>'
    + icon('search', 958, 192, 50)
    + '<circle cx="955" cy="1062" r="46" fill="#fff" fill-opacity=".35" stroke="#fff" stroke-width="5"/>'
    + '<circle cx="955" cy="1110" r="18"/><path stroke="#222" stroke-width="5" d="M945 1110H965M955 1100V1120"/>'
    + counted('heart', 955, 1205, 74, '48.2K') + counted('bubble', 955, 1365, 72, '1,024')
    + counted('mark', 955, 1525, 64, '3,210') + counted('share', 955, 1685, 72, '512')
    + '<circle cx="955" cy="1840" r="42" fill="#222" stroke="#fff" stroke-width="6"/><circle cx="955" cy="1840" r="14"/>'
    + text(78, 1778, '@your.account', 40, { bold: true })
    + text(78, 1844, 'The description sits here and can run', 33) + text(78, 1886, 'on to a second line #fyp #ugc ... more', 33)
    + _progress(320),
  shorts: () => _status()
    + '<path fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" d="M126 166L102 187L126 208M102 187H133"/>'
    + icon('search', 849, 187, 50) + icon('dots', 957, 187, 46).replace('translate(', 'rotate(90 957 187) translate(')
    + counted('up', 953, 1150, 62, '12K') + counted('bubble', 953, 1280, 62, '386')
    + counted('mark', 953, 1410, 56, 'Save') + counted('share', 953, 1540, 62, 'Share')
    + counted('remix', 953, 1670, 62, 'Remix')
    + '<rect x="922" y="1800" width="62" height="62" rx="12" fill="#fff" fill-opacity=".35" stroke="#fff" stroke-width="5"/>'
    + '<circle cx="126" cy="1709" r="38" fill="#fff" fill-opacity=".35" stroke="#fff" stroke-width="4"/>'
    + text(176, 1724, '@channel', 34, { bold: true })
    + '<rect x="375" y="1676" width="202" height="68" rx="34"/>' + text(476, 1721, 'Subscribe', 30, { bold: true, mid: true, fill: '#0f0f0f' })
    + text(86, 1797, 'The title of your Short goes on this line', 33)
    + '<rect x="86" y="1826" width="762" height="58" rx="14" fill-opacity=".22"/><path d="M108 1840L132 1855L108 1870Z"/>'
    + text(148, 1865, 'Related video  ·  its title', 28)
    + _progress(300),
  reels: () => _status()
    + '<path fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" d="M154 166L124 190L154 214"/>'
    + counted('heart', 955, 1035, 66, '8,412') + counted('bubble', 955, 1190, 64, '264')
    + counted('repost', 955, 1345, 64, '51') + counted('send', 955, 1500, 62, '120')
    + icon('mark', 955, 1660, 58) + icon('dots', 955, 1830, 52)
    + '<circle cx="139" cy="1758" r="50" fill="#fff" fill-opacity=".35" stroke="#fff" stroke-width="4"/>'
    + text(212, 1750, 'your.account', 34, { bold: true }) + text(212, 1792, '♫ Original audio', 28)
    + '<rect x="594" y="1731" width="139" height="57" rx="14" fill="none" stroke="#fff" stroke-width="3"/>' + text(663, 1770, 'Follow', 30, { bold: true, mid: true })
    + text(86, 1866, 'Your caption sits here... more', 32)
    + _progress(280),
};

// ── State ───────────────────────────────────────────────────────────────────
let _on = (() => { try { const v = localStorage.getItem(LS); return ORDER.includes(v) ? v : ''; } catch (e) { return ''; } })();
let _fmt = '9:16';
let _shown = true;
let _svg = null;
const _subs = [];

/** The platform whose screen is over the frame now ('' none; never in 16:9). */
export const current = () => (_fmt === '9:16' ? _on : '');
/** What it covers: [{ g, r: [x0, y0, x1, y1] }] in a 1080x1920 frame, or [] when none is shown. */
export const zones = () => (current() ? PLATFORMS[current()].zones : []);
export const nameOf = (id) => (PLATFORMS[id] ? PLATFORMS[id].name : '');
export function onChange(cb) { if (typeof cb === 'function') _subs.push(cb); }

function _set(id) {
  _on = ORDER.includes(id) ? id : '';
  try { if (_on) localStorage.setItem(LS, _on); else localStorage.removeItem(LS); } catch (e) { /* a private window */ }
  _paint();
  for (const cb of _subs) { try { cb(current()); } catch (e) { /* a listener's own trouble */ } }
}

// ── The marks in the header ─────────────────────────────────────────────────
let _btns = null;
function _svgIcon(d) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  s.appendChild(p);
  return s;
}

/** The three marks, right of the preview's title. */
export function mountButtons() {
  if (_btns) return;
  const title = document.querySelector('#mv3-preview .mv3-panel-head .mv3-panel-title');
  if (!title) return;
  const box = document.createElement('span');
  box.className = 'mv3-pf';
  _btns = new Map();
  for (const id of ORDER) {
    const b = document.createElement('button');
    b.type = 'button';
    // Quiet toggles in the panel's head; the screen shown - pressed (the selected look)
    b.className = 'mv3-pf-btn u-btn is-s is-icon is-quiet';
    b.dataset.platform = id;
    b.appendChild(_svgIcon(ICON[id]));
    b.addEventListener('click', () => { if (_fmt === '9:16') _set(_on === id ? '' : id); });
    box.appendChild(b);
    _btns.set(id, b);
  }
  title.after(box);
  _paintButtons();
}

function _paintButtons() {
  if (!_btns) return;
  const wide = _fmt !== '9:16';
  for (const [id, b] of _btns) {
    const on = !wide && _on === id;
    b.classList.toggle('is-on', on);
    b.classList.toggle('is-off', wide);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = wide ? TITLE[id] + ' - only for 9:16'
      : on ? TITLE[id] + ' over the frame - press again to take it off'
        : TITLE[id] + ': its buttons, account and description over the frame, to keep captions clear of them (the preview only - never in the video)';
  }
}

// ── The drawing over the frame ──────────────────────────────────────────────
/** Laid over the stage, under the grips' canvas. */
export function attach(stage, before) {
  if (!stage) return;
  if (!_svg) {
    _svg = document.createElementNS(NS, 'svg');
    _svg.setAttribute('class', 'mv3-pf-over');
    _svg.setAttribute('viewBox', '0 0 1080 1920');
    _svg.setAttribute('preserveAspectRatio', 'none');
    _svg.setAttribute('aria-hidden', 'true');
  }
  if (before && before.parentNode === stage) stage.insertBefore(_svg, before);
  else stage.appendChild(_svg);
  _paint();
}

/** Where the frame is on the stage, as fractions of it - the drawing covers exactly that (as captions/layer.js). */
export function place(left, top, width, height) {
  if (!_svg) return;
  const pc = (v) => (v * 100).toFixed(4) + '%';
  Object.assign(_svg.style, { left: pc(left), top: pc(top), width: pc(width), height: pc(height) });
}

/** The project's shape: the screens are 9:16 only. */
export function setFormat(fmt) {
  const f = fmt === '16:9' ? '16:9' : '9:16';
  if (f === _fmt) return;
  _fmt = f;
  _paint();
  for (const cb of _subs) { try { cb(current()); } catch (e) { /* a listener's own trouble */ } }
}

/** Hidden while the stage is lent to something that is not the timeline (the workshop). */
export function show(on) {
  _shown = !!on;
  _paint();
}

let _drawn = null;
function _paint() {
  _paintButtons();
  if (!_svg) return;
  const id = _shown ? current() : '';
  _svg.style.display = id ? '' : 'none';
  if (id === _drawn) return;
  _drawn = id;
  // The screen's words are in the INTERFACE's font - the page's --font, as the stage's own words
  // (preview-b.js `_uiFont`). This drawing is in the page, so CSS gives it the token as it is; not "Inter", which on
  // these pages is the bold caption file of css/caption-fonts.css.
  _svg.innerHTML = id ? '<defs><filter id="mv3-pf-sh" x="-10%" y="-10%" width="120%" height="120%">'
    + '<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity=".6"/></filter></defs>'
    + _edges() + '<g fill="#fff" style="font-family:var(--font)" filter="url(#mv3-pf-sh)" opacity=".92">' + DRAW[id]() + '</g>' : '';
}

// ── The check ───────────────────────────────────────────────────────────────
const _cross = (a, r) => a.x < r[2] && a.x + a.w > r[0] && a.y < r[3] && a.y + a.h > r[1];

/**
 * Which elements of the shown screen a page's lines lie under (rectangles of captions/place.js, in a frame of
 * w x h - a 9:16 frame of any size is scaled to the table's 1080x1920). @returns [{ g, r, hit: [x0, y0, x1, y1] }]
 */
export function crossed(lines, w, h) {
  const zs = zones();
  if (!zs.length || !lines || !lines.length) return [];
  const k = 1080 / (w || 1080), ky = 1920 / (h || 1920);
  const out = [];
  for (const z of zs) {
    for (const l of lines) {
      const a = { x: l.x * k, y: l.y * ky, w: l.w * k, h: l.h * ky };
      if (!_cross(a, z.r)) continue;
      out.push({ g: z.g, r: z.r, hit: [Math.max(a.x, z.r[0]), Math.max(a.y, z.r[1]), Math.min(a.x + a.w, z.r[2]), Math.min(a.y + a.h, z.r[3])] });
    }
  }
  return out;
}
