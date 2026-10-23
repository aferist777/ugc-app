/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the BACKGROUND MUSIC of a highlights project, chosen in its popup (phase V33.8, H3; the owner 2026-10-23:
   "в попапе создания highlights проекта мог выбрать в дропдауне аудио. типа в дропдауне пускай будет список треков по группам
   (группы настроения) и там же в дропдауне мог прослушать трек кнопкой слева на строке, и кнопкой справа отметить галочкой").

   A button that opens a list under it: the tracks of Music -> highlights (GET /api/audio/music/highlights, phase V34.F) in
   their ten MOOD groups, then "yours" - the root of highlights. A row: ▶ on the left plays it here (one at a time, pressed
   again - stops), its name and length, a tick on the right. None ticked - no music; one - every fragment; several - dealt
   to the fragments in a shuffled order (lib/highlights-music.js). The ticks are remembered for the next popup.
   The list is a layer of its own: Escape or a press outside closes it, not the popup.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';

const LS = 'mv3_hl_music_v1';
const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const _len = (s) => { s = Math.max(0, Math.round(+s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

/**
 * A music picker in `host`. `onChange(ids)` when the ticks change. Returns { get() -> [ids], stop() } - stop() silences it
 * and closes its list (the popup closed).
 */
export function musicPicker(host, { onChange } = {}) {
  let data = null;          // { moods, root }
  let err = '';
  let ticked = [];
  try { ticked = JSON.parse(localStorage.getItem(LS) || '[]') || []; } catch (e) { ticked = []; }
  if (!Array.isArray(ticked)) ticked = [];
  let open = false;
  let layer = null;
  const audio = new Audio();
  audio.preload = 'none';
  let playing = '';

  const wrap = _el('div', 'mv3-hlm');
  const btn = _el('button', 'mv3-hlm-btn');
  btn.type = 'button';
  const list = _el('div', 'mv3-hlm-list');
  list.hidden = true;
  wrap.append(btn, list);
  host.appendChild(wrap);

  btn.addEventListener('click', () => (open ? close() : show()));
  audio.addEventListener('ended', () => { playing = ''; paintPlay(); });

  const all = () => (data ? [...data.moods.flatMap((m) => m.tracks || []), ...(data.root || [])] : []);
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(ticked)); } catch (e) { /* private */ } };

  function paintBtn() {
    const n = ticked.length;
    btn.textContent = '';
    btn.appendChild(_el('span', 'mv3-hlm-said', !data ? (err || 'reading Music → highlights…')
      : n === 0 ? 'no music' : n === 1 ? '1 track · on every fragment' : n + ' tracks · shuffled across the fragments'));
    btn.appendChild(_el('span', 'mv3-hlm-arrow', open ? '▴' : '▾'));
    btn.classList.toggle('is-on', n > 0);
    btn.title = 'Background music under every fragment, from Music → highlights: quiet, from the part of the track where it has opened up';
  }

  function row(t) {
    const r = _el('div', 'mv3-hlm-row' + (ticked.includes(t.id) ? ' is-on' : ''));
    r.dataset.id = t.id;
    const play = _el('button', 'mv3-hlm-play', playing === t.id ? '■' : '▶');
    play.type = 'button';
    play.title = playing === t.id ? 'Stop' : 'Listen';
    play.addEventListener('click', (e) => { e.stopPropagation(); toggle(t); });
    const name = _el('span', 'mv3-hlm-name', t.title || 'track');
    name.title = t.title || '';
    const len = _el('span', 'mv3-hlm-len', t.dur ? _len(t.dur) : '');
    const box = _el('input', 'mv3-hlm-tick');
    box.type = 'checkbox';
    box.checked = ticked.includes(t.id);
    box.title = 'Under the fragments';
    box.addEventListener('click', (e) => e.stopPropagation());
    box.addEventListener('change', () => tick(t.id, box.checked));
    // The row itself ticks too - the box is small.
    r.addEventListener('click', () => { box.checked = !box.checked; tick(t.id, box.checked); });
    r.append(play, name, len, box);
    return r;
  }

  function paintList() {
    list.textContent = '';
    if (!data) { list.appendChild(_el('div', 'mv3-hlm-empty', err || 'reading…')); return; }
    if (!all().length) {
      list.appendChild(_el('div', 'mv3-hlm-empty', 'Music → highlights is empty. Make tracks in Merge → generate audio (its highlights moods), '
        + 'or put your own into Music → highlights on the Library\'s Media shelf.'));
      return;
    }
    const head = _el('div', 'mv3-hlm-head');
    head.appendChild(_el('span', null, ticked.length ? ticked.length + ' ticked' : 'tick one or several'));
    const clear = _el('button', 'mv3-hlm-clear', 'none');
    clear.type = 'button';
    clear.title = 'No music';
    clear.disabled = !ticked.length;
    clear.addEventListener('click', (e) => { e.stopPropagation(); ticked = []; save(); paintBtn(); paintList(); if (onChange) onChange(ticked.slice()); });
    head.appendChild(clear);
    list.appendChild(head);
    const group = (label, about, tracks) => {
      const g = _el('div', 'mv3-hlm-group');
      const h = _el('div', 'mv3-hlm-gh', label);
      if (about) h.title = about;
      h.appendChild(_el('span', 'mv3-hlm-n', ' ' + tracks.length));
      g.appendChild(h);
      if (!tracks.length) g.appendChild(_el('div', 'mv3-hlm-none', 'none yet'));
      for (const t of tracks) g.appendChild(row(t));
      list.appendChild(g);
    };
    for (const m of data.moods) group(m.label, m.about, m.tracks || []);
    group('yours', 'Your own tracks in the root of Music → highlights', data.root || []);
  }

  function paintPlay() {
    for (const b of list.querySelectorAll('.mv3-hlm-row')) {
      const p = b.querySelector('.mv3-hlm-play');
      const on = playing === b.dataset.id;
      p.textContent = on ? '■' : '▶';
      p.title = on ? 'Stop' : 'Listen';
      b.classList.toggle('is-playing', on);
    }
  }

  function toggle(t) {
    if (playing === t.id) { audio.pause(); playing = ''; paintPlay(); return; }
    audio.src = t.path;
    audio.currentTime = 0;
    audio.play().then(() => { playing = t.id; paintPlay(); }).catch(() => { playing = ''; paintPlay(); });
    playing = t.id;
    paintPlay();
  }

  function tick(id, on) {
    ticked = ticked.filter((x) => x !== id);
    if (on) ticked.push(id);
    save();
    paintBtn();
    const r = list.querySelector('.mv3-hlm-row[data-id="' + CSS.escape(id) + '"]');
    if (r) r.classList.toggle('is-on', on);
    const h = list.querySelector('.mv3-hlm-head span');
    if (h) h.textContent = ticked.length ? ticked.length + ' ticked' : 'tick one or several';
    const c = list.querySelector('.mv3-hlm-clear');
    if (c) c.disabled = !ticked.length;
    if (onChange) onChange(ticked.slice());
  }

  // A press anywhere outside the list and its button closes it - the popup stays.
  const outside = (e) => { if (open && !wrap.contains(e.target)) close(); };
  function show() {
    if (open) return;
    open = true;
    list.hidden = false;
    paintList();
    paintBtn();
    layer = Layers.open(list, { name: 'highlights music', onEsc: close });
    document.addEventListener('mousedown', outside, true);
  }
  function close() {
    if (!open) return;
    open = false;
    list.hidden = true;
    if (layer) { Layers.close(layer); layer = null; }
    document.removeEventListener('mousedown', outside, true);
    audio.pause();
    playing = '';
    paintBtn();
  }

  (async () => {
    try {
      const r = await fetch('/api/audio/music/highlights');
      const d = await r.json();
      if (!d || !d.success) throw new Error((d && d.error) || 'Music → highlights could not be read');
      data = { moods: Array.isArray(d.moods) ? d.moods : [], root: Array.isArray(d.root) ? d.root : [] };
      // The ticks remembered from the last popup - those still there.
      const have = new Set(all().map((t) => t.id));
      const before = ticked.length;
      ticked = ticked.filter((id) => have.has(id));
      if (ticked.length !== before) save();
    } catch (e) { err = e.message || 'Music → highlights could not be read'; }
    paintBtn();
    if (open) paintList();
    if (onChange) onChange(ticked.slice());
  })();

  paintBtn();
  return {
    get: () => ticked.slice(),
    stop: () => { close(); audio.removeAttribute('src'); },
  };
}
