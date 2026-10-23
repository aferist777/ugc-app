/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the HIGHLIGHTS POPUP: which video, how long and how many fragments, and the style of their captions
   (phase V33.1; the owner 2026-10-20: "появляется попап для вставки ссылки, добавление файла с пк, дропдаун с выбором
   длительности, дропдаун с выбором количества фрагментов", and (х1), (х4), (х13), (х16)).

   THREE WAYS IN (х1): a link, a file of this computer - its path handed over by the app's own window (desktop/preload.js
   pathOf; a browser tab cannot), pressed or let go of anywhere on the popup -, or a source already in the Library. The
   lengths and counts are the server's (lib/highlights-store.js). The CAPTION STYLE IS A MUST (х16): "find moments" is not
   pressed until one is chosen, and the field says so in red, as a choice not made does in a talking head.

   ONE PRESS, NO "ARE YOU SURE" (х13): the price is on the button - the words (Groq's, by the length when it is known, or
   this computer's for nothing, or kept with the source) and the agent's few cents. The server writes the row and answers
   at once; the popup closes and the tiles stand up in the field (highlights.js follows the record).
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { stylePicker, presetName, BY_VIDEO, styleFor, keepFor } from './hl-style.js';
import { musicPicker } from './hl-music.js';

const LS_ASK = 'mv3_hl_ask_v1';           // the length and the count chosen last
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

let _win = null;

export function isOpen() { return !!_win; }
export function closePopup() {
  if (!_win) return;
  const w = _win;
  _win = null;
  try { w.picker.stop(); } catch (e) { /* gone */ }
  try { if (w.music) w.music.stop(); } catch (e) { /* gone */ }
  w.ov.remove();
  Layers.close(w.layer);
}

/**
 * Open it for project `id` (its record `rec`: the lengths and counts it offers). `onStarted(alertId)` once the server
 * took the press. `url` (phase TG, block 5c) - a link written in already: a long video of REFERENCES sent "to highlights".
 * `sourceId` (block 6) - a source of the Library chosen already: a video of the media tree's YOUTUBE sent "to highlights".
 */
export function openPopup(id, rec, { onStarted, url, sourceId } = {}) {
  if (_win) return;
  let remembered = {};
  try { remembered = JSON.parse(localStorage.getItem(LS_ASK) || '{}') || {}; } catch (e) { remembered = {}; }
  const lengths = (rec && rec.lengths) || { 'up30': { label: 'up to 30 s' }, '30-60': { label: '30-60 s' }, '60-90': { label: '60-90 s' } };
  const counts = (rec && rec.counts) || [3, 5, 10, 15, 20];
  // (phase V33.6, the owner's (х54)-(х57)) What kind of video - where the frame looks when there is no face, and what the agent is told.
  // (phase V33.8, (у6), (ф2)) auto, podcast · interview, documentary; a `facts` remembered from before is documentary.
  const kinds = (rec && rec.kinds) || { auto: { label: 'auto' }, podcast: { label: 'podcast · interview' }, documentary: { label: 'documentary' } };
  const ask = rec && rec.ask ? rec.ask : {};
  if (remembered.kind === 'facts') remembered.kind = 'documentary';
  const st = {
    from: 'link', url: '', path: '', fileName: '', sourceId: '', source: null,
    // (after block 8) What is chosen in "from the Library": a downloaded source (`source`) or a video kept as a tile (`remote`).
    pick: null,
    length: lengths[ask.length] ? ask.length : (lengths[remembered.length] ? remembered.length : '30-60'),
    count: counts.includes(+ask.count) ? +ask.count : (counts.includes(+remembered.count) ? +remembered.count : 5),
    // (phase V33.3) The title on top of every fragment - on unless it was taken off last time (the owner's (х35)).
    title: ask.title != null ? ask.title !== false : remembered.title !== false,
    kind: kinds[ask.kind] ? ask.kind : (kinds[remembered.kind] ? remembered.kind : 'auto'),
    style: '', price: null, busy: false, said: '', err: false,
    // (phase V33.8, H3) The tracks of Music → highlights ticked for the background.
    music: [],
  };

  const ov = _el('div', 'mv3-x-ov mv3-hlp-ov');
  const box = _el('div', 'mv3-x mv3-hlp');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  const head = _el('div', 'mv3-x-head');
  head.appendChild(_el('h3', null, 'Highlights - find the moments'));
  const x = _el('button', 'mv3-x-close', '✕');
  x.type = 'button';
  x.title = 'Close (Esc)';
  x.addEventListener('click', closePopup);
  head.appendChild(x);
  const body = _el('div', 'mv3-x-body');
  const foot = _el('div', 'mv3-x-foot');

  // ── The video ──
  body.appendChild(_el('div', 'mv3-x-hdr', 'the video'));
  const tabs = _el('div', 'mv3-hlp-tabs');
  const panes = {};
  for (const [k, label] of [['link', 'a link'], ['file', 'a file'], ['source', 'from the Library']]) {
    const b = _el('button', 'mv3-sc-tab', label);
    b.type = 'button';
    b.dataset.from = k;
    b.addEventListener('click', () => { st.from = k; paint(); price(); if (k === 'source') loadSources(); });
    tabs.appendChild(b);
  }
  body.appendChild(tabs);

  const link = _el('input', 'mv3-sc-inp mv3-hlp-url');
  link.type = 'text';
  link.placeholder = 'https://www.youtube.com/watch?v=…  - one video';
  link.addEventListener('input', () => { st.url = link.value.trim(); paint(); });
  if (url) { st.url = String(url).trim(); link.value = st.url; }
  link.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  panes.link = _el('div', 'mv3-hlp-pane');
  panes.link.appendChild(link);

  const fileIn = _el('input');
  fileIn.type = 'file';
  fileIn.accept = 'video/*';
  fileIn.hidden = true;
  fileIn.addEventListener('change', () => takeFile(fileIn.files && fileIn.files[0]));
  const pick = _el('button', 'mv3-c-btn', 'choose a video file…');
  pick.type = 'button';
  pick.addEventListener('click', () => fileIn.click());
  const fileSaid = _el('span', 'mv3-hlp-file', 'or let a file go anywhere on this window');
  panes.file = _el('div', 'mv3-hlp-pane mv3-hlp-filepane');
  panes.file.append(pick, fileSaid, fileIn);

  panes.source = _el('div', 'mv3-hlp-pane mv3-hlp-srcs');
  for (const k of Object.keys(panes)) body.appendChild(panes[k]);

  // ── How long and how many ──
  const row = _el('div', 'mv3-hlp-row');
  const lenSel = _el('select', 'mv3-hlp-sel');
  for (const [k, v] of Object.entries(lengths)) { const o = _el('option', null, v.label || k); o.value = k; lenSel.appendChild(o); }
  lenSel.value = st.length;
  lenSel.addEventListener('change', () => { st.length = lenSel.value; remember(); });
  const cntSel = _el('select', 'mv3-hlp-sel');
  for (const n of counts) { const o = _el('option', null, n + ' fragments'); o.value = String(n); cntSel.appendChild(o); }
  cntSel.value = String(st.count);
  cntSel.addEventListener('change', () => { st.count = +cntSel.value; remember(); price(); });
  const lw = _el('label', 'mv3-hlp-lab', 'length');
  lw.appendChild(lenSel);
  const cw = _el('label', 'mv3-hlp-lab', 'how many');
  cw.appendChild(cntSel);
  const tw = _el('label', 'mv3-hlp-lab mv3-hlp-tick');
  const titleBox = _el('input');
  titleBox.type = 'checkbox';
  titleBox.checked = st.title;
  titleBox.addEventListener('change', () => { st.title = titleBox.checked; remember(); });
  tw.append(titleBox, document.createTextNode('title on top'));
  tw.title = 'The moment\'s headline, in the video\'s own language, at the top of each fragment for its first three seconds - a text line like any other: edit it, move it or delete it on the timeline';
  const kindSel = _el('select', 'mv3-hlp-sel');
  for (const [k, v] of Object.entries(kinds)) { const o = _el('option', null, v.label || k); o.value = k; kindSel.appendChild(o); }
  kindSel.value = st.kind;
  kindSel.addEventListener('change', () => {
    st.kind = kindSel.value;
    remember();
    if (!_win || !_win.picker) return;
    // (V33.8, (в1)) "By the video" is auto's: another kind takes the style kept for it.
    if (st.style === BY_VIDEO && st.kind !== 'auto') { st.style = styleFor(st.kind); _win.picker.set(st.style); paint(); }
    _win.picker.recommend(st.kind);
  });
  const kw = _el('label', 'mv3-hlp-lab', 'video kind');
  kw.appendChild(kindSel);
  kw.title = 'auto - where a shot has no face, the frame follows a whole person when there is one, else shows the whole frame over its blur\n'
    + 'podcast · interview - the faces; no face: the whole frame; the agent looks for complete thoughts and strong opinions\n'
    + 'documentary - the faces; no face: a 3:2 window from the middle over its blur (text, charts and screens stay nearly whole); the agent looks for a fact with its hook';
  row.append(lw, cw, kw, tw);
  body.appendChild(_el('div', 'mv3-x-hdr', 'the fragments'));
  body.appendChild(row);
  body.appendChild(_el('p', 'mv3-x-note', 'Fewer when the video does not have that many good ones. A fragment may be made of up to three pieces of the video - a theme opened in one place and closed in another.'));

  // ── (phase V33.8, H3) The background music - Music → highlights, by mood ──
  body.appendChild(_el('div', 'mv3-x-hdr', 'music'));
  const musicBox = _el('div', 'mv3-hlp-music');
  body.appendChild(musicBox);
  const music = musicPicker(musicBox, { onChange: (ids) => { st.music = ids; } });

  // ── The caption style, a must ──
  const capHdr = _el('div', 'mv3-x-hdr', 'captions - choose a style');
  body.appendChild(capHdr);
  const capBox = _el('div', 'mv3-hlp-style is-missing');
  const capSaid = _el('div', 'mv3-hlp-style-said', 'Choose the style of the captions - every fragment gets it; one or several can be given another later.');
  body.appendChild(capSaid);
  body.appendChild(capBox);
  // (phase V33.8, H2) The kind's recommended groups first and open.
  // (V33.8, (в1)) A style chosen while the kind is podcast or documentary is kept for it - "by the video" offers those two.
  const picker = stylePicker(capBox, { kind: st.kind, onPick: (pid) => { st.style = pid; if (pid !== BY_VIDEO) keepFor(st.kind, pid); paint(); } });

  // ── The foot: who hears, and the press ──
  const hear = _el('div', 'mv3-hlp-hear');
  const said = _el('div', 'mv3-hlp-said');
  const goBtn = _el('button', 'mv3-c-btn mv3-hlp-go', 'find moments');
  goBtn.type = 'button';
  goBtn.addEventListener('click', go);
  const left = _el('div', 'mv3-hlp-footl');
  left.append(hear, said);
  foot.append(left, goBtn);

  box.append(head, body, foot);
  ov.appendChild(box);
  document.body.appendChild(ov);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closePopup(); });
  // A file let go anywhere on the popup.
  ov.addEventListener('dragover', (e) => { if (Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); box.classList.add('is-drop'); } });
  ov.addEventListener('dragleave', (e) => { if (e.target === ov || !box.contains(e.relatedTarget)) box.classList.remove('is-drop'); });
  ov.addEventListener('drop', (e) => {
    box.classList.remove('is-drop');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    st.from = 'file';
    takeFile(f);
  });
  const layer = Layers.open(ov, { name: 'highlights', onEsc: closePopup });
  _win = { ov, layer, picker, music };
  setTimeout(() => { if (_win && _win.ov === ov) link.focus(); }, 0);

  function remember() { try { localStorage.setItem(LS_ASK, JSON.stringify({ length: st.length, count: st.count, title: st.title, kind: st.kind })); } catch (e) { /* private */ } }

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
  }

  // ── The Library: REFERENCES -> YouTube -> Videos ──
  // (after block 8; the owner's (Y3): "эти окна показывают именно эту папку, вместе с нескачанными, и выбранное видео
  // скачивается") Downloaded videos (sources of the Library) and videos kept as tiles - one of those is downloaded by the
  // project first, by its link. Videos from elsewhere come by "a link" or "a file".
  let sources = null;
  async function loadSources() {
    if (sources) return;
    panes.source.textContent = '';
    panes.source.appendChild(_el('div', 'mv3-ins-note', 'reading REFERENCES · YouTube · Videos…'));
    try {
      const d = await _api('/api/references/youtube');
      sources = d.items || [];
    } catch (e) { sources = []; panes.source.textContent = e.message; return; }
    paintSources();
  }
  function paintSources() {
    panes.source.textContent = '';
    panes.source.appendChild(_el('div', 'mv3-ins-note', 'REFERENCES · YouTube · Videos'));
    if (!sources.length) { panes.source.appendChild(_el('div', 'mv3-ins-note', 'Nothing there yet - give a link or a file.')); return; }
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
        paintSources(); paint(); price();
      });
      panes.source.appendChild(r);
    }
  }

  // ── The price, and who hears ──
  let priceSeq = 0;
  async function price() {
    const seq = ++priceSeq;
    const q = st.from === 'source' && st.source ? '?seconds=' + encodeURIComponent(st.source.seconds || 0) + '&source=' + encodeURIComponent(st.sourceId)
      : (st.from === 'source' && st.pick && st.pick.seconds ? '?seconds=' + encodeURIComponent(st.pick.seconds) : '');
    try {
      const d = await _api('/api/highlights/price' + q);
      if (seq !== priceSeq || !_win) return;
      st.price = d.price;
    } catch (e) { st.price = null; }
    paint();
  }

  function say(text, err) { st.said = text || ''; st.err = !!err; paint(); }

  function ready() {
    if (st.busy) return false;
    if (st.price && st.price.hear.by === 'none' && !(st.from === 'source' && st.source && st.source.words)) return false;
    if (!st.style) return false;
    if (st.from === 'link') return /^https?:\/\/\S+/i.test(st.url);
    if (st.from === 'file') return !!st.path;
    return !!st.pick;
  }

  function paint() {
    for (const b of tabs.children) b.classList.toggle('is-on', b.dataset.from === st.from);
    for (const [k, p] of Object.entries(panes)) p.hidden = k !== st.from;
    capBox.classList.toggle('is-missing', !st.style);
    capSaid.classList.toggle('is-missing', !st.style);
    capHdr.textContent = st.style ? 'captions - ' + (presetName(st.style) || st.style) : 'captions - choose a style';
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
      const sum = (kept ? 0 : (p.hear.cost || 0)) + (p.agent.cost || 0);
      cost = kept || p.hear.cost != null || p.hear.by !== 'groq' ? '~' + _usd(sum) : '~' + _usd(p.agent.cost) + ' + the words';
    }
    goBtn.textContent = st.busy ? 'starting…' : 'find moments' + (cost ? ' · ' + cost : '');
    goBtn.disabled = !ready();
    goBtn.title = !st.style ? 'Choose the style of the captions first' : '';
    said.textContent = st.said;
    said.classList.toggle('is-err', st.err);
  }

  async function go() {
    if (!ready()) {
      if (!st.style) say('Choose the style of the captions first.', true);
      return;
    }
    st.busy = true;
    say('');
    const spec = { from: st.from, length: st.length, count: st.count, style: { preset: st.style, name: presetName(st.style) }, title: st.title, kind: st.kind,
      music: st.music.slice() };
    // (V33.8, (в1)) "By the video": the two styles it chooses between go with it.
    if (st.style === BY_VIDEO) {
      const of = (k) => ({ preset: styleFor(k), name: presetName(styleFor(k)) });
      spec.style.byKind = { podcast: of('podcast'), documentary: of('documentary') };
    } else keepFor(st.kind, st.style);
    if (st.from === 'link') spec.url = st.url;
    else if (st.from === 'file') spec.path = st.path;
    // A video kept as a tile: the project downloads it by its link (after block 8).
    else if (st.pick && st.pick.type === 'remote') { spec.from = 'link'; spec.url = st.pick.link; }
    else spec.sourceId = st.sourceId;
    try {
      const d = await _api('/api/highlights/' + encodeURIComponent(id) + '/start',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec) });
      remember();
      closePopup();
      if (onStarted) onStarted(d.alertId);
    } catch (e) {
      st.busy = false;
      say(e.message, true);
    }
  }

  paint();
  price();
  if (sourceId) {
    st.from = 'source';
    st.sourceId = String(sourceId);
    loadSources().then(() => {
      st.source = (sources || []).find((s) => s.type === 'source' && s.id === st.sourceId) || null;
      st.pick = st.source;
      if (!st.source) st.sourceId = '';
      paintSources(); paint(); price();
    });
  }
}
