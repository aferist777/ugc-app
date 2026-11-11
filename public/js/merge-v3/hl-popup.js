/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the HIGHLIGHTS POPUP: which video, what kind of video, how long and how many fragments, their music and the
   style of their captions (phase V33.1; the owner 2026-10-20: "появляется попап для вставки ссылки, добавление файла с пк,
   дропдаун с выбором длительности, дропдаун с выбором количества фрагментов", and (х1), (х4), (х13), (х16)).

   A WINDOW OF ITS OWN (phase V68 P3, the owner 2026-11-01, (хп3), (хп4): "этот попап тоже давай сделаем чтобы можно было менять
   размеры и положение попапа и оно сохраняется; ... в два столбца ... слева 2/3 ... справа 1/3"): js/gen-window.js openFrame -
   POPUP_SIZE (960×670, V63; 1280×800 until then) the first time, moved by its head, stretched by its edges, its size and place
   kept (`geom` 'highlights'), a double press on the head puts it back. Its parts (until V63 two columns, 2/3 and 1/3; since V63
   two steps in one column - below), the foot under them:
   - the video - a link · from the Library · a file, from the Library open first, its list scrolled in a box of its own;
     the fragments - the kind of video as square buttons with the pixel icons the owner chose (P1, merge-v3/hl-kinds.js), under
     them a box of one height with the words: every kind's short line while none is chosen (only at the very first opening -
     (хп35), (хп48): everything under the kinds is blurred and "find moments" waits), the chosen one's longer words after;
     the length and the count as buttons ((хп18); fragmentation has no count); "reset to standard"; music - the moods as
     buttons (hl-music.js).
   - the captions - the tabs presets · animation · fonts (P4), under them what is chosen OF THE OPEN TAB (the owner's
     check: its presets, its animations, its fonts - merge-v3/font-tiles.js; none, each preset's own font, (хп10)) - the set's
     name on top, a small button each with ✕ under it - a press shows the tile in its group, outlined (hl-style.js reveal); the
     tiles under that.
   EVERY KIND REMEMBERS ITS OWN (хп19), (хп46): length, count, moods, presets, animations, fonts - hl-kinds.js; switching the kind
   brings its own back.
   TWO STEPS SINCE V63 (P14, the owner 2026-11-02: "давай сделаем его в два шага быстрый запуск. на первом шаге пользователь выбирает
   the video, the parts, а на втором шаге music и caption зоны") - the same window on Home and in Merge, ONE COLUMN and the
   chats' size (gen-window.js POPUP_SIZE; the owner's check of P14: "сделай так же the parts под the video. просто сам попап будет
   меньше по размеру"): STEP 1 the video with the parts under it, "next →" once a video and a kind are chosen; STEP 2 the music
   with the captions under it, "‹ back" and the press. The crumbs say the step, the first one goes back. Each section is one
   element moved into the step's column, so nothing is painted twice and every picker keeps what it holds. It always opens on
   step 1.
   THE KINDS IN ONE TABLE (phase V69 P12): their words, standards, count buttons (a target), recommended moods, preset groups,
   animations and font groups are public/js/highlights/kinds.js's (through hl-kinds.js); a kind in development (stream, (хп86)) is a
   grey button that is not pressed. THE TITLE ON TOP (хп90): a switch on step 2 by the captions - on / off, auto's "by the video / on /
   off" - each kind remembering its own. AUTO "BY THE VIDEO" (хп93): its music row starts with "by the video", and the press sends,
   for every kind auto may find, that kind's captions, moods and title as it remembers them (hl-kinds.js byVideoSets).
   THE HOST'S PRESS (V63): `start(spec)` given - Home's quick start - the press hands the choice to the host, which MAKES the
   project and starts it (POST /api/highlights/start); with no project there is no `id` (`rec` is GET /api/highlights/offer).

   THREE WAYS IN (х1): a link, a file of this computer - its path handed over by the app's own window (desktop/preload.js
   pathOf; a browser tab cannot), pressed or let go of anywhere on the window -, or a source already in the Library. The
   lengths and counts are the server's (lib/highlights-store.js). The CAPTION STYLE IS A MUST (х16): "find moments" is not
   pressed until one is chosen, and the field says so in red, as a choice not made does in a talking head.

   ONE PRESS, NO "ARE YOU SURE" (х13): the price is on the button - the words (Groq's, by the length when it is known, or
   this computer's for nothing, or kept with the source) and the agent's few cents. The server writes the row and answers
   at once; the window closes and the tiles stand up in the field (highlights.js follows the record).
   ═══════════════════════════════════════════════════════════════════════════ */

import { openFrame, POPUP_SIZE } from '../gen-window.js';
import { stylePicker, animPicker, presetName, pairName, BY_VIDEO, styleFor } from './hl-style.js';
import { moodPicker } from './hl-music.js';
import * as KIND from './hl-kinds.js';
import { fontPicker, fontLabel } from './font-tiles.js';
// (phase V73 block 2, step 2b) Being read, nothing there, could not be read - the shared parts; the reason a popup in the corner.
import { emptyEl, loadingEl, failedEl } from '../ui-state.js';
import { showError } from '../notice.js';

const GEOM = Object.freeze({ key: 'highlights', resize: true, move: true, keepSize: true, keepPos: true });
const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const _api = async (url, opt) => {
  let r = null, d = null;
  try { r = await fetch(url, opt); d = await r.json(); } catch (e) { d = null; }
  if (!r || !d || !d.success) throw new Error((d && d.error) || 'The app did not answer - try again in a moment.');
  return d;
};
const _clock = (s) => {
  s = Math.max(0, Math.round(+s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x;
};
const _usd = (v) => (v == null ? '' : v < 0.01 ? '<1¢' : v < 1 ? Math.round(v * 100) + '¢' : '$' + v.toFixed(2));

let _win = null;                 // { frame, picker, anim }

export function isOpen() { return !!_win; }
export function closePopup() { if (_win) _win.frame.close(); }

/**
 * Open it for project `id` (its record `rec`: the lengths, counts and kinds it offers). `onStarted(alertId)` once the server
 * took the press. `url` (phase TG, block 5c) - a link written in already: a long video of REFERENCES sent "to highlights".
 * `sourceId` (block 6) - a source of the Library chosen already: a video of the media tree's YOUTUBE sent "to highlights".
 * `start(spec)` (phase V63) - the host's press: answers `{ alertId, … }` or throws its refusal; `id` is null then.
 */
export function openPopup(id, rec, { onStarted, url, sourceId, start } = {}) {
  if (_win) return;
  const lengths = (rec && rec.lengths) || { 'up30': { label: 'Up to 30 s' }, '30-60': { label: '30-60 s' }, '60-90': { label: '60-90 s' } };
  const counts = (rec && rec.counts) || [3, 5, 10, 15, 20];
  // (phase V33.6, V33.8, V43) The kinds - the server's: auto, podcast · interview, documentary, fragmentation (its own lengths, no count).
  const kinds = (rec && rec.kinds) || { auto: { label: 'Auto' }, podcast: { label: 'Podcast · interview' }, documentary: { label: 'Documentary' } };
  const isWhole = (k) => !!(kinds[k] && kinds[k].whole);
  const lengthsOf = (k) => (isWhole(k) && kinds[k].lengths) || lengths;
  const st = {
    from: url ? 'link' : 'source', url: '', path: '', fileName: '', sourceId: '', source: null,
    // (after block 8) What is chosen in "from the Library": a downloaded source (`source`) or a video kept as a tile (`remote`).
    pick: null,
    // (V68 P3) '' - no kind chosen yet: the very first opening (хп35), (хп48).
    kind: '', length: '', count: 5, moods: [],
    // (phase V49) The styles chosen - one, or several with Shift (пр25) - and the animations (пр26); `style` the first of them.
    style: '', styles: [], anims: [], fonts: [], title: false, capTab: 'presets', price: null, busy: false, said: '', err: false,
    // (phase V90, the owner's (аэ1), (аэ13)) The agent's clip effects on each fragment at its cut: 'none', 'auto' or how many.
    fx: KIND.FX_STD,
    // (phase V43, (ё18)) The video's sound tracks (a file or a source with more than one) and the one chosen.
    tracks: [], audio: null, tracksFor: '',
    // (V63) 1 - the video and the parts, 2 - the music and the captions.
    step: 1,
  };

  const frame = openFrame({ name: 'highlights', size: POPUP_SIZE, geom: GEOM, foot: true, onClose: () => {
    if (!_win || _win.frame !== frame) return;
    try { _win.picker.stop(); } catch (e) { /* gone */ }
    try { _win.anim.stop(); } catch (e) { /* gone */ }
    _win = null;
  } });
  const box = frame.box;
  frame.body.classList.add('mv3-hlp');
  const cols = _el('div', 'mv3-hlp-cols');
  // (V63) The column of a step, and the four sections that are moved into it: the video with the parts under it (step 1), the
  // music with the captions under it (step 2) - one column since the owner's check of P14 ("сделай так же the parts под the video.
  // просто сам попап будет меньше по размеру").
  const A = _el('div', 'mv3-hlp-left');
  cols.append(A);
  const L = _el('div', 'mv3-hlp-sec');
  const P = _el('div', 'mv3-hlp-sec');
  const M = _el('div', 'mv3-hlp-sec');
  const R = _el('div', 'mv3-hlp-sec');
  // (phase V73 block 4) the foot is the frame's: who hears and what was said at the left, '‹ back', the price and the press at the right
  const foot = frame.foot;
  foot.classList.add('mv3-hlp-foot');
  frame.body.append(cols);

  // ── The video ──
  L.appendChild(_el('div', 'mv3-x-hdr', 'The video'));
  const tabs = _el('div', 'mv3-hlp-tabs u-tabs');
  const panes = {};
  // (V68 P3, the owner: "from the library должен стоять по умолчанию и в порядке стоять справа от a link")
  for (const [k, label] of [['link', 'A link'], ['source', 'From the Library'], ['file', 'A file']]) {
    const b = _el('button', 'mv3-sc-tab u-tab', label);
    b.type = 'button';
    b.dataset.from = k;
    b.addEventListener('click', () => { st.from = k; paint(); price(); readTracks(); if (k === 'source') loadSources(); if (k === 'link') link.focus(); });
    tabs.appendChild(b);
  }
  L.appendChild(tabs);

  const link = _el('input', 'mv3-sc-inp mv3-hlp-url u-in');
  link.type = 'text';
  link.placeholder = 'https://www.youtube.com/watch?v=…  - one video';
  link.addEventListener('input', () => { st.url = link.value.trim(); paint(); });
  if (url) { st.url = String(url).trim(); link.value = st.url; }
  link.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (st.step === 1) next(); else go(); } });
  panes.link = _el('div', 'mv3-hlp-pane');
  panes.link.appendChild(link);

  panes.source = _el('div', 'mv3-hlp-pane mv3-hlp-srcs');

  const fileIn = _el('input');
  fileIn.type = 'file';
  fileIn.accept = 'video/*';
  fileIn.hidden = true;
  fileIn.addEventListener('change', () => takeFile(fileIn.files && fileIn.files[0]));
  const pickBtn = _el('button', 'mv3-c-btn u-btn', 'Choose a video file…');
  pickBtn.type = 'button';
  pickBtn.addEventListener('click', () => fileIn.click());
  const fileSaid = _el('span', 'mv3-hlp-file', 'or let a file go anywhere on this window');
  panes.file = _el('div', 'mv3-hlp-pane mv3-hlp-filepane');
  panes.file.append(pickBtn, fileSaid, fileIn);
  for (const k of Object.keys(panes)) L.appendChild(panes[k]);
  // (phase V43, the owner's (ё18): "давать выбор дорожки если есть выбор") A file with more than one sound track - a dub and the
  // original, say - says so here: the one chosen is heard and is the parts' sound.
  const trackSel = _el('select', 'mv3-hlp-sel u-in is-s');
  trackSel.addEventListener('change', () => { st.audio = +trackSel.value; price(); });
  const trackRow = _el('label', 'mv3-hlp-lab mv3-hlp-track', 'Sound');
  trackRow.title = 'The video has more than one sound track - the one chosen is heard for the words and is the sound of the shorts';
  trackRow.appendChild(trackSel);
  trackRow.hidden = true;
  L.appendChild(trackRow);
  // The tracks of what is chosen now - asked once for each file or source.
  let trackSeq = 0;
  async function readTracks() {
    const q = st.from === 'file' && st.path ? 'path=' + encodeURIComponent(st.path)
      : (st.from === 'source' && st.sourceId ? 'source=' + encodeURIComponent(st.sourceId) : '');
    if (q === st.tracksFor) return;
    st.tracksFor = q;
    st.tracks = []; st.audio = null;
    paint();
    if (!q) return;
    const seq = ++trackSeq;
    try {
      const d = await _api('/api/highlights/tracks?' + q);
      if (seq !== trackSeq || !_win) return;
      st.tracks = d.tracks || [];
      st.audio = st.tracks.length > 1 ? +d.first || 0 : null;
      trackSel.textContent = '';
      for (const t of st.tracks) { const o = _el('option', null, t.label + (t.def ? ' (default)' : '')); o.value = String(t.k); trackSel.appendChild(o); }
      if (st.audio != null) trackSel.value = String(st.audio);
    } catch (e) { st.tracks = []; st.audio = null; }
    paint();
    price();
  }

  // ── The fragments: the kind, its words, the length and the count ──
  const fragHdr = _el('div', 'mv3-x-hdr', 'The fragments');
  P.appendChild(fragHdr);
  const kindRow = _el('div', 'mv3-hlp-kinds');
  const kindBtns = {};
  for (const [k, v] of Object.entries(kinds)) {
    const b = _el('button', 'mv3-hlp-kind');
    b.type = 'button';
    b.dataset.kind = k;
    const ic = _el('span', 'mv3-hlp-kind-ic');
    if (KIND.ICONS[k]) ic.innerHTML = KIND.ICONS[k];
    else ic.textContent = String(v.label || k).slice(0, 1).toUpperCase();
    b.append(ic, _el('span', 'mv3-hlp-kind-nm', v.label || k));
    b.title = (v.label || k) + (KIND.ABOUT[k] ? ' - ' + KIND.ABOUT[k].short : '');
    // (V69 P12, (хп86)) A kind in development: grey, not pressed.
    if (v.inDev) {
      b.disabled = true;
      b.classList.add('is-dev');
      b.appendChild(_el('span', 'mv3-hlp-kind-dev', 'In development'));
      b.title = (v.label || k) + ' - in development';
    }
    b.addEventListener('click', () => { if (!v.inDev && st.kind !== k) setKind(k); });
    kindBtns[k] = b;
    kindRow.appendChild(b);
  }
  // (хп19) The kind's standards back: its length, count, music, captions.
  const reset = _el('button', 'mv3-hlp-reset u-btn is-s is-quiet', 'Reset to standard');
  reset.type = 'button';
  reset.title = 'Back to this kind\'s standard settings - the length, how many, the music and the captions';
  reset.addEventListener('click', () => { if (st.kind) use(KIND.standardOf(st.kind, lengthsOf(st.kind))); });
  kindRow.appendChild(reset);
  P.appendChild(kindRow);
  // (хп35) One height whatever it says: every kind's short line, or the chosen one's words.
  const about = _el('div', 'mv3-hlp-about');
  P.appendChild(about);

  const opts = _el('div', 'mv3-hlp-opts');
  const lenRow = _el('div', 'mv3-hlp-orow');
  lenRow.appendChild(_el('span', 'mv3-hlp-olab', 'Length'));
  const lenChips = _el('div', 'mv3-hlp-chips');
  lenRow.appendChild(lenChips);
  const cntRow = _el('div', 'mv3-hlp-orow');
  cntRow.appendChild(_el('span', 'mv3-hlp-olab', 'How many'));
  const cntChips = _el('div', 'mv3-hlp-chips');
  cntRow.appendChild(cntChips);
  // (V69 P12) Each kind its own count buttons (30 for most, 50 for stream) - the server's.
  const countsOf = (k) => (kinds[k] && Array.isArray(kinds[k].counts) && kinds[k].counts.length ? kinds[k].counts : counts);
  // (phase V90, (аэ13)) The agent's effects: none · auto · 1-5 - on each fragment's main video when it is cut.
  const fxRow = _el('div', 'mv3-hlp-orow');
  fxRow.appendChild(_el('span', 'mv3-hlp-olab', 'Effects'));
  const fxChips = _el('div', 'mv3-hlp-chips');
  fxRow.appendChild(fxChips);
  const fragNote = _el('p', 'mv3-x-note', '');
  opts.append(lenRow, cntRow, fxRow, fragNote);
  P.appendChild(opts);

  // ── (V68 P3) The background music - the moods of Music → highlights ──
  const musicSec = _el('div', 'mv3-hlp-music');
  musicSec.appendChild(_el('div', 'mv3-x-hdr', 'Music'));
  M.appendChild(musicSec);
  const music = moodPicker(musicSec, {
    onChange: (moods) => { st.moods = moods; keep(); },
    // The ticked tracks of before as their moods, once (хп49) - then what the kind chosen remembers.
    onReady: (moodOf) => {
      KIND.settleOldMusic(moodOf);
      if (st.kind) { music.set(st.moods.length ? st.moods : KIND.settingsOf(st.kind, lengthsOf(st.kind), counts).moods); st.moods = music.get(); }
    },
  });

  // ── The captions: presets · animation, what is chosen, the tiles ──
  R.appendChild(_el('div', 'mv3-x-hdr', 'Captions'));
  // (V69 P12, (хп90)) The title on top: on / off - auto's "by the video" too; each kind remembers its own.
  const titleRow = _el('div', 'mv3-hlp-orow mv3-hlp-titlerow');
  titleRow.appendChild(_el('span', 'mv3-hlp-olab', 'Title on top'));
  const titleChips = _el('div', 'mv3-hlp-chips');
  titleRow.appendChild(titleChips);
  R.appendChild(titleRow);
  const capTabs = _el('div', 'mv3-cap-tabs mv3-hlp-captabs u-tabs');
  const tabBtn = (tab, label, title) => {
    const b = _el('button', 'mv3-cap-tab u-tab', label);
    b.type = 'button';
    b.dataset.tab = tab;
    b.title = title;
    b.addEventListener('click', () => { if (!b.disabled) { st.capTab = tab; paint(); } });
    capTabs.appendChild(b);
    return b;
  };
  tabBtn('presets', 'Presets', 'The style of the captions - one, or several with Shift: each page one of them');
  const animTab = tabBtn('anim', 'Animation', 'How a page comes in and goes out - after a style is chosen');
  // (V68 P4) The fonts over the presets' own: one, or several with Shift - each page one of them, as wide as in its preset's font.
  const fontTab = tabBtn('fonts', 'Fonts', 'The letters of the captions over the styles\' own - one, or several with Shift: each page one of them; after a style is chosen');
  R.appendChild(capTabs);
  // (V68 P3, the owner's second round: "писать выбранные, прям под открытой вкладкой") What is chosen, a row a tab.
  const chosen = _el('div', 'mv3-hlp-chosen');
  R.appendChild(chosen);
  const capBox = _el('div', 'mv3-hlp-style mv3-hlp-pane-cap is-missing');
  const animBox = _el('div', 'mv3-hlp-style mv3-hlp-pane-cap mv3-hlp-anim');
  const fontBox = _el('div', 'mv3-hlp-style mv3-hlp-pane-cap mv3-hlp-fonts');
  R.append(capBox, animBox, fontBox);
  const picker = stylePicker(capBox, { kind: '', onPick: (ids) => {
    st.styles = ids;
    st.style = ids[0] || '';
    if (!ids.length && st.capTab !== 'presets') st.capTab = 'presets';
    keep();
    paint();
  } });
  const anim = animPicker(animBox, { onPick: (pairs) => { st.anims = pairs; keep(); paint(); } });
  const fonts = fontPicker(fontBox, {
    note: 'The letters of the captions - one font for every page, or several with Shift: each page one of them. Colors, outline and motion stay the style\'s; a page keeps the width it has in the style\'s own font.',
    onPick: (list) => { st.fonts = list; keep(); paint(); },
  });

  // ── The foot: who hears, and the press ──
  const hear = _el('div', 'mv3-hlp-hear u-status is-line');
  const said = _el('div', 'mv3-hlp-said u-status is-line');
  const priceEl = _el('span', 'mv3-hlp-price u-price');
  const goBtn = _el('button', 'mv3-c-btn mv3-hlp-go u-btn is-main', 'Find moments');
  goBtn.type = 'button';
  goBtn.addEventListener('click', go);
  // (V63) The steps: "next →" on the first, "‹ back" beside the press on the second.
  const nextBtn = _el('button', 'mv3-c-btn mv3-hlp-go u-btn is-main', 'Next →');
  nextBtn.type = 'button';
  nextBtn.addEventListener('click', () => next());
  const backBtn = _el('button', 'mv3-c-btn mv3-hlp-back u-btn', '‹ Back');
  backBtn.type = 'button';
  backBtn.title = 'Back to the video and the parts';
  backBtn.addEventListener('click', () => toStep(1));
  const footL = _el('div', 'mv3-hlp-footl');
  footL.append(hear, said);
  foot.append(footL, backBtn, priceEl, nextBtn, goBtn);

  // A file let go anywhere on the window.
  box.addEventListener('dragover', (e) => { if (Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); box.classList.add('is-drop'); } });
  box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove('is-drop'); });
  box.addEventListener('drop', (e) => {
    box.classList.remove('is-drop');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    st.from = 'file';
    takeFile(f);
  });
  _win = { frame, picker, anim };
  placeStep();

  // ── The kind and what it remembers ──
  // A style kept for a kind that is not auto cannot be "by the video": that kind's own takes its place.
  const stylesFor = (k, ids) => (ids.includes(BY_VIDEO) && k !== 'auto' ? [styleFor(k)] : ids);
  /** Settings `s` ({ length, count, moods, styles, anims }) put on the window for the kind chosen - and kept. */
  function use(s) {
    st.length = lengthsOf(st.kind)[s.length] ? s.length : Object.keys(lengthsOf(st.kind))[0];
    const cs = countsOf(st.kind);
    st.count = cs.includes(+s.count) ? +s.count : (cs.includes(20) ? 20 : cs[0]);
    music.set(s.moods || []);
    st.moods = music.get();
    picker.set(stylesFor(st.kind, s.styles || []));
    st.styles = picker.getAll();
    st.style = st.styles[0] || '';
    anim.set(s.anims || []);
    st.anims = anim.getAll();
    fonts.set(s.fonts || []);
    st.fonts = fonts.getAll();
    fonts.openFirst();
    if (!st.styles.length) st.capTab = 'presets';
    picker.recommend(st.kind);
    picker.openFirst();
    // (V69 P12) The title on top, auto's "by the video" in the moods, the kind's recommended moods, animations and font groups.
    st.title = s.title === true || (st.kind === 'auto' && s.title === BY_VIDEO) ? s.title : false;
    st.fx = KIND.okFx(s.fx) ? s.fx : KIND.FX_STD;
    music.byVideo(st.kind === 'auto');
    if (st.kind === 'auto') { music.set(s.moods || []); st.moods = music.get(); }
    const rec = KIND.recommendedOf(st.kind);
    music.recommend(rec.moods);
    anim.recommend(rec.anims);
    fonts.recommend(rec.fonts);
    keep();
    paint();
    price();
  }
  function setKind(k) {
    st.kind = k;
    use(KIND.settingsOf(k, lengthsOf(k), countsOf(k)));
  }
  function keep() {
    if (!st.kind) return;
    KIND.keep(st.kind, { length: st.length, count: st.count, moods: st.moods, styles: st.styles, anims: st.anims, fonts: st.fonts, title: st.title, fx: st.fx });
  }

  function takeFile(f) {
    if (!f) return;
    const pathOf = window.ugcWindow && window.ugcWindow.pathOf;
    let where = '';
    try { where = typeof pathOf === 'function' ? String(pathOf(f) || '') : ''; } catch (e) { where = ''; }
    if (!where) { say('A file is added in the app\'s own window - it hands the file over. Here, use a link or the Library.', true); return; }
    if (!/^video\//.test(f.type || '') && !/\.(mp4|mov|webm|mkv|m4v|avi)$/i.test(f.name || '')) { say('Not a video file: ' + f.name, true); return; }
    st.path = where;
    st.fileName = f.name || where;
    fileSaid.textContent = st.fileName;
    say('');
    paint();
    price();
    readTracks();
  }

  // ── The Library: REFERENCES -> YouTube -> Videos ──
  // (after block 8; the owner's (Y3): "эти окна показывают именно эту папку, вместе с нескачанными, и выбранное видео
  // скачивается") Downloaded videos (sources of the Library) and videos kept as tiles - one of those is downloaded by the
  // project first, by its link. Videos from elsewhere come by "a link" or "a file".
  let sources = null;
  let sourcesP = null;
  function loadSources() {
    if (!sourcesP) {
      panes.source.textContent = '';
      panes.source.appendChild(loadingEl('reading REFERENCES · YouTube · Videos…', { line: true }));
      sourcesP = _api('/api/references/youtube').then((d) => { sources = d.items || []; paintSources(); })
        // (phase V73 block 2, (б2-19)) Not read: "did not load" with Try again (read again), the reason a popup.
        .catch((e) => {
          sourcesP = null;
          showError('Could not read REFERENCES · YouTube · Videos: ' + e.message);
          panes.source.replaceChildren(failedEl('REFERENCES · YouTube · Videos', () => loadSources(), { line: true }));
        });
    }
    return sourcesP;
  }
  function paintSources() {
    panes.source.textContent = '';
    panes.source.appendChild(_el('div', 'mv3-ins-note', 'REFERENCES · YouTube · Videos'));
    if (!sources.length) { panes.source.appendChild(emptyEl('Nothing there yet - give a link or a file.', { line: true })); return; }
    for (const s of sources) {
      const r = _el('button', 'mv3-hlp-src' + (st.pick === s ? ' is-on' : ''));
      r.type = 'button';
      if (s.thumb) { const im = _el('img', 'mv3-hlp-src-img'); im.src = s.thumb; im.alt = ''; im.loading = 'lazy'; r.appendChild(im); }
      const t = _el('span', 'mv3-hlp-src-t');
      t.appendChild(_el('b', null, s.title || s.id));
      t.appendChild(_el('small', null, _clock(s.seconds) + (s.type === 'remote' ? ' · not downloaded - the project downloads it first'
        : (s.words ? ' · its words are in' : ' · its words are heard first'))));
      r.appendChild(t);
      if (s.busy) { r.disabled = true; r.title = 'It is being read for the scenarios - it can be chosen when that has finished.'; }
      r.addEventListener('click', () => {
        st.pick = s;
        st.sourceId = s.type === 'source' ? s.id : '';
        st.source = s.type === 'source' ? s : null;
        paintSources(); paint(); price(); readTracks();
      });
      panes.source.appendChild(r);
    }
  }

  // ── The price, and who hears ──
  let priceSeq = 0;
  async function price() {
    const seq = ++priceSeq;
    const q0 = st.from === 'source' && st.source ? '?seconds=' + encodeURIComponent(st.source.seconds || 0) + '&source=' + encodeURIComponent(st.sourceId)
      : (st.from === 'source' && st.pick && st.pick.seconds ? '?seconds=' + encodeURIComponent(st.pick.seconds) : '');
    // (V43) fragmentation's agent writes every part of the video - its price is the kind's and the length's.
    const q = q0 + (q0 ? '&' : '?') + 'kind=' + encodeURIComponent(st.kind || 'auto') + '&length=' + encodeURIComponent(st.length)
      + (isWhole(st.kind) ? '' : '&count=' + st.count) + (st.audio != null ? '&audio=' + st.audio : '') + '&fx=' + encodeURIComponent(String(st.fx));
    try {
      const d = await _api('/api/highlights/price' + q);
      if (seq !== priceSeq || !_win) return;
      st.price = d.price;
    } catch (e) { st.price = null; }
    paint();
  }

  function say(text, err) { st.said = text || ''; st.err = !!err; paint(); }

  // ── (V63) The two steps ──
  // A video given: a link, a file handed over, or a video of the Library picked.
  function hasVideo() {
    if (st.from === 'link') return /^https?:\/\/\S+/i.test(st.url);
    if (st.from === 'file') return !!st.path;
    return !!st.pick;
  }
  // What the first step still waits for, in words ('' - nothing).
  function stepWait() {
    if (!hasVideo()) return st.from === 'link' ? 'Give a link to the video first' : st.from === 'file' ? 'Choose a video file first' : 'Choose a video of the Library first';
    return st.kind ? '' : 'Choose the kind of video first';
  }
  function next() {
    const why = stepWait();
    if (why) { say(why + '.', true); return; }
    say('');
    toStep(2);
  }
  // Each section moved into its step's column - the same elements, so every picker keeps what it holds. Step 1 scrolls as one
  // column; step 2 is a column whose captions' tiles fill what the music leaves.
  function placeStep() {
    const two = st.step === 2;
    A.replaceChildren(...(two ? [M, R] : [L, P]));
    A.className = two ? 'mv3-hlp-right' : 'mv3-hlp-left';
    cols.classList.toggle('is-s2', two);
    frame.setCrumbs(two
      ? [{ label: 'Highlights · video & parts', on: () => toStep(1) }, { label: 'Music & captions' }]
      : [{ label: 'Highlights · video & parts' }]);
  }
  function toStep(n) {
    st.step = n === 2 ? 2 : 1;
    placeStep();
    paint();
    if (st.step === 2) picker.openFirst();
  }

  function ready() {
    if (st.busy || !st.kind) return false;
    if (st.price && st.price.hear.by === 'none' && !(st.from === 'source' && st.source && st.source.words)) return false;
    if (!st.style) return false;
    if (st.from === 'link') return /^https?:\/\/\S+/i.test(st.url);
    if (st.from === 'file') return !!st.path;
    return !!st.pick;
  }

  // What is chosen of the open tab (the owner's check of P3, 2026-11-01: "компактнее в один столбец. название набора сверху. и в
  // пресетах показывай пресеты, в анимациях анимации"): the set's name and count on top, its buttons under it; a press shows the
  // tile in its group, ✕ lets it go.
  function chosenSet(label, items, empty, onShow, onDrop) {
    const r = _el('div', 'mv3-hlp-cset');
    r.appendChild(_el('div', 'mv3-hlp-cset-h', label.charAt(0).toUpperCase() + label.slice(1) + (items.length ? ' · ' + items.length : '')));
    const list = _el('div', 'mv3-hlp-chips');
    if (!items.length) list.appendChild(_el('span', 'mv3-hlp-quiet' + (empty.err ? ' is-err' : ''), empty.text));
    for (const [key, name] of items) {
      const c = _el('span', 'mv3-hlp-pick');
      const nm = _el('button', 'mv3-hlp-pick-nm', name);
      nm.type = 'button';
      nm.title = 'Show it among the tiles';
      nm.addEventListener('click', () => onShow(key));
      const x = _el('button', 'mv3-hlp-pick-x u-x', '');
      x.type = 'button';
      x.title = 'Take it away';
      x.addEventListener('click', () => onDrop(key));
      c.append(nm, x);
      list.appendChild(c);
    }
    r.appendChild(list);
    return r;
  }
  function paintChosen() {
    chosen.textContent = '';
    if (st.capTab === 'fonts') {
      chosen.appendChild(chosenSet('fonts', st.fonts.map((f) => [f, fontLabel(f) || f]),
        { text: 'None - each style\'s own font' },
        (f) => fonts.reveal(f),
        (f) => { fonts.set(st.fonts.filter((x) => x !== f)); st.fonts = fonts.getAll(); keep(); paint(); }));
      return;
    }
    if (st.capTab === 'anim') {
      chosen.appendChild(chosenSet('animations', st.anims.map((p) => [p, pairName(p) || p]),
        { text: 'None - pages come and go as the style has them' },
        (p) => anim.reveal(p),
        (p) => { anim.set(st.anims.filter((x) => x !== p)); st.anims = anim.getAll(); keep(); paint(); }));
      return;
    }
    chosen.appendChild(chosenSet('presets', st.styles.map((idp) => [idp, presetName(idp) || idp]),
      { text: 'Choose a style - Shift picks several, each page one of them', err: true },
      (idp) => picker.reveal(idp),
      (idp) => { picker.set(st.styles.filter((x) => x !== idp)); st.styles = picker.getAll(); st.style = st.styles[0] || ''; keep(); paint(); }));
  }

  function paintAbout() {
    about.textContent = '';
    if (!st.kind) {
      about.appendChild(_el('div', 'mv3-hlp-about-h', 'Choose the kind of video - its settings open under it.'));
      for (const [k, v] of Object.entries(kinds)) {
        const l = _el('div', 'mv3-hlp-about-l');
        l.appendChild(_el('b', null, v.label || k));
        l.appendChild(document.createTextNode(' - ' + ((KIND.ABOUT[k] && KIND.ABOUT[k].short) || '') + (v.inDev ? ' (in development)' : '')));
        about.appendChild(l);
      }
      return;
    }
    about.appendChild(_el('p', 'mv3-hlp-about-p', (KIND.ABOUT[st.kind] && KIND.ABOUT[st.kind].long) || (kinds[st.kind].label || st.kind)));
  }

  function paint() {
    if (!_win) return;
    for (const b of tabs.children) b.classList.toggle('is-on', b.dataset.from === st.from);
    // (V43) The sound tracks of what is chosen - only when there is a choice.
    trackRow.hidden = !(st.tracks.length > 1 && st.tracksFor && (st.from === 'file' || st.from === 'source'));
    for (const [k, p] of Object.entries(panes)) p.hidden = k !== st.from;
    // (хп48) No kind yet: everything under the kinds waits for one.
    const locked = !st.kind;
    for (const el of [opts, musicSec, R]) { el.classList.toggle('is-locked', locked); el.inert = locked; }
    reset.disabled = locked;
    for (const [k, b] of Object.entries(kindBtns)) b.classList.toggle('is-on', k === st.kind);
    paintAbout();
    // The length and the count - fragmentation has its own lengths and no count (V43).
    const whole = isWhole(st.kind);
    lenChips.textContent = '';
    for (const [k, v] of Object.entries(lengthsOf(st.kind))) {
      const b = _el('button', 'mv3-hlp-chip u-chip' + (k === st.length ? ' is-on' : ''), v.label || k);
      b.type = 'button';
      b.addEventListener('click', () => { st.length = k; keep(); paint(); price(); });
      lenChips.appendChild(b);
    }
    cntChips.textContent = '';
    for (const n of countsOf(st.kind)) {
      const b = _el('button', 'mv3-hlp-chip u-chip' + (n === st.count ? ' is-on' : ''), String(n));
      b.type = 'button';
      b.addEventListener('click', () => { st.count = n; keep(); paint(); price(); });
      cntChips.appendChild(b);
    }
    cntRow.hidden = whole;
    // (phase V90) The agent's effects on each fragment.
    fxChips.textContent = '';
    for (const v of ['none', 'auto', 1, 2, 3, 4, 5]) {
      const b = _el('button', 'mv3-hlp-chip u-chip' + (st.fx === v ? ' is-on' : ''), String(v));
      b.type = 'button';
      b.title = v === 'none' ? 'No effects - add them later in the inspector'
        : v === 'auto' ? 'The agent reads each fragment and puts on its main video as many clip effects as it finds right - a hook at the start, about one on a key line'
          : 'The agent puts ' + v + (v === 1 ? ' clip effect' : ' clip effects') + ' on each fragment\'s main video, at its moments';
      b.addEventListener('click', () => { st.fx = v; keep(); paint(); price(); });
      fxChips.appendChild(b);
    }
    // (V69 P12, (хп90)) The title on top.
    titleChips.textContent = '';
    for (const [v, label, tip] of (st.kind === 'auto' ? [[BY_VIDEO, 'by the video', 'As the kind auto finds has it']] : []).concat([
      [true, 'on', 'The fragment\'s headline at the top for its first 3 s'], [false, 'off', 'No title - "add title" on a fragment\'s card puts one']])) {
      const b = _el('button', 'mv3-hlp-chip u-chip' + (st.title === v ? ' is-on' : ''), label);
      b.type = 'button';
      b.title = tip;
      b.addEventListener('click', () => { st.title = v; keep(); paint(); });
      titleChips.appendChild(b);
    }
    fragHdr.textContent = whole ? 'The parts' : 'The fragments';
    fragNote.textContent = !st.kind ? '' : whole
      ? 'The whole video, one part after another, each a scene or a topic - as many as it comes to. The intro, ads and the outro are cut out.'
      : 'The agent returns this many - the strongest first, weaker ones last with a lower score; fewer only when the video has no more. A fragment may be made of up to three pieces of the video.';
    // The captions: the animations' tab open once a style is chosen (V49).
    capBox.classList.toggle('is-missing', !st.style && !locked);
    animTab.disabled = !st.styles.length;
    fontTab.disabled = !st.styles.length;
    if (!st.styles.length) st.capTab = 'presets';
    for (const b of capTabs.children) b.classList.toggle('is-on', b.dataset.tab === st.capTab);
    capBox.hidden = st.capTab !== 'presets';
    animBox.hidden = st.capTab !== 'anim';
    fontBox.hidden = st.capTab !== 'fonts';
    fonts.shown(!fontBox.hidden && !locked && st.step === 2);
    paintChosen();
    // Who hears it, and what it costs.
    const p = st.price;
    hear.textContent = '';
    hear.classList.remove('is-err');
    let cost = '';
    if (p) {
      const kept = p.hear.by === 'kept' || (st.from === 'source' && st.source && st.source.words);
      if (kept) hear.textContent = 'Its words are in - not heard again.';
      else if (p.hear.by === 'groq') {
        hear.textContent = 'Words heard by Groq - ' + (p.hear.cost != null ? _usd(p.hear.cost) : '$' + p.hear.perHour.toFixed(2) + ' an hour of video') + '.';
      } else if (p.hear.by === 'local') hear.textContent = 'Words heard on this computer, for nothing - about 40 minutes for an hour of video.';
      else { hear.textContent = p.hear.why || 'Nobody can hear the words.'; hear.classList.add('is-err'); }
      // (phase V90) the agent's effects - a call a fragment.
      const fxCost = p.fx ? (+p.fx.cost || 0) : 0;
      const sum = (kept ? 0 : (p.hear.cost || 0)) + (p.agent.cost || 0) + fxCost;
      cost = kept || p.hear.cost != null || p.hear.by !== 'groq' ? '~' + _usd(sum) : '~' + _usd((p.agent.cost || 0) + fxCost) + ' + the words';
    }
    // (phase V73 block 4) the price stands by the press, in mono - not inside its words
    goBtn.textContent = st.busy ? 'Starting…' : (whole ? 'Split into parts' : 'Find moments');
    priceEl.textContent = cost && st.kind ? cost : '';
    goBtn.disabled = !ready();
    goBtn.title = !st.kind ? 'Choose the kind of video first' : !st.style ? 'Choose the style of the captions first' : '';
    // (V63) The steps' buttons: "next →" on the first, "‹ back" and the press on the second.
    const wait = stepWait();
    nextBtn.hidden = st.step !== 1;
    nextBtn.disabled = !!wait || st.busy;
    nextBtn.title = wait ? wait : 'The music and the captions';
    backBtn.hidden = goBtn.hidden = st.step !== 2;
    priceEl.hidden = st.step !== 2 || !priceEl.textContent;
    backBtn.disabled = st.busy;
    said.textContent = st.said;
    said.classList.toggle('is-err', st.err);
  }

  async function go() {
    if (!ready()) {
      if (!st.kind) say('Choose the kind of video first.', true);
      else if (!st.style) say('Choose the style of the captions first.', true);
      return;
    }
    st.busy = true;
    say('');
    const spec = { from: st.from, length: st.length, ...(isWhole(st.kind) ? {} : { count: st.count }), style: { preset: st.style, name: presetName(st.style) }, kind: st.kind,
      moods: music.get(), title: st.title, fx: st.fx };
    // (V69 P12, (хп93)) auto's "by the video" - for every kind it may find, that kind's captions, moods and title as it remembers them.
    const sets = st.kind === 'auto' ? KIND.byVideoSets(presetName, (idp) => !!presetName(idp), lengths, counts) : null;
    if (sets && spec.moods.includes(BY_VIDEO)) spec.moodsByKind = sets.moodsByKind;
    if (sets && st.title === BY_VIDEO) spec.titleByKind = sets.titleByKind;
    if (st.style === BY_VIDEO) {
      spec.style.byKind = sets ? sets.byKind : {};
    } else if (st.styles.length > 1) {
      // (V49, (пр25)) Several: every fragment the same set, dealt page by page.
      spec.style.mix = st.styles.map((idp) => ({ preset: idp, name: presetName(idp) }));
    }
    // (V49, (пр26)) The animations: one for every page, or several dealt. (V68 P4, (хп8)) The fonts: one for every page, or several
    // dealt; none - each style's own. "By the video" carries each kind's own.
    if (st.anims.length && st.style !== BY_VIDEO) spec.style.anims = st.anims.slice();
    if (st.fonts.length && st.style !== BY_VIDEO) spec.style.fonts = st.fonts.slice();
    // (V43, (ё18)) The sound track chosen, when the video has more than one.
    if (st.audio != null && st.tracks.length > 1 && (st.from === 'file' || st.from === 'source')) {
      spec.audio = st.audio;
      const t = st.tracks.find((x) => x.k === st.audio);
      spec.audioLabel = t ? t.label : '';
    }
    if (st.from === 'link') spec.url = st.url;
    else if (st.from === 'file') spec.path = st.path;
    // A video kept as a tile: the project downloads it by its link (after block 8).
    else if (st.pick && st.pick.type === 'remote') { spec.from = 'link'; spec.url = st.pick.link; }
    else spec.sourceId = st.sourceId;
    try {
      // (V63) Home's quick start: the host makes the project and starts it; Merge's project starts as before.
      const d = typeof start === 'function' ? await start(spec)
        : await _api('/api/highlights/' + encodeURIComponent(id) + '/start',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec) });
      keep();
      closePopup();
      if (onStarted) onStarted(d.alertId, d);
    } catch (e) {
      st.busy = false;
      say(e.message, true);
    }
  }

  // ── What it opens with ──
  // A project stopped before its video was in keeps what it asked: that kind, its length, count and moods. Else the kind
  // chosen last - none at the very first opening (хп35), (хп48), (хп49).
  const ask = rec && rec.ask ? rec.ask : null;
  const askKind = ask && kinds[ask.kind] ? ask.kind : (ask && ask.kind === 'facts' && kinds.documentary ? 'documentary' : '');
  const k0 = askKind || (kinds[KIND.lastKind()] && !kinds[KIND.lastKind()].inDev ? KIND.lastKind() : '');
  if (k0) {
    st.kind = k0;
    const s = KIND.settingsOf(k0, lengthsOf(k0), countsOf(k0));
    if (askKind) {
      if (lengthsOf(k0)[ask.length]) s.length = ask.length;
      if (countsOf(k0).includes(+ask.count)) s.count = +ask.count;
      if (Array.isArray(ask.moods) && ask.moods.length) s.moods = ask.moods.map((m) => String((m && m.id) || m));
      // (phase V90) the effects it asked for - none when it asked none
      s.fx = KIND.okFx(ask.fx) ? ask.fx : 'none';
    }
    use(s);
  } else {
    st.length = Object.keys(lengths)[0];
    picker.recommend('');
    paint();
    price();
  }
  if (st.from === 'link') setTimeout(() => { if (_win && _win.frame === frame) link.focus(); }, 0);
  if (sourceId) {
    st.from = 'source';
    st.sourceId = String(sourceId);
    loadSources().then(() => {
      st.source = (sources || []).find((s) => s.type === 'source' && s.id === st.sourceId) || null;
      st.pick = st.source;
      if (!st.source) st.sourceId = '';
      paintSources(); paint(); price(); readTracks();
    });
  } else if (st.from === 'source') loadSources();
}
