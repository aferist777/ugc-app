// WHAT IS KNOWN ABOUT A MADE PICTURE - the viewer's right column for a picture the generators made, opened from IMAGES ->
// Environments / Lookbooks (the Library's Media and Merge's Library panel).
//
// What is WRITTEN here: a lookbook's gender, the description, how a place moves; and how many looks were dressed in a
// lookbook.

// And IMAGES -> Props: a product's name, the person's own words and the agent's description (_propRows).
import { t, tc, tn } from '../i18n/t.js';

const MADE = new Set(['environments', 'lookbooks', 'props']);
const GENDERS = ['male', 'female', 'unisex'];
// A gender as its chip says it, and who wears it - the value sent stays the English word.
const GENDER_WORD = { male: tc('gender', 'male'), female: tc('gender', 'female'), unisex: tc('gender', 'unisex') };
const GENDER_TITLE = { male: t('Worn by a male character'), female: t('Worn by a female character'), unisex: t('Worn by either') };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const json = async (url, opts) => {
  const r = await fetch(url, opts);
  let d = null;
  try { d = await r.json(); } catch (e) { d = null; }
  if (!r.ok || !d || d.success === false) throw Object.assign(new Error((d && d.error) || ('HTTP ' + r.status)), { status: r.status });
  return d;
};
const post = (url, body) => json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
const _patchMeta = (it, body) => json('/api/library/meta/' + encodeURIComponent(it.kind) + '/' + encodeURIComponent(it.id), {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

// One text written by hand: its box, and "save" under it only while the box differs from what is kept. `store` sends it
// and answers with what is kept now; the item's meta follows, so the viewer opened again shows it.
function _textRow(value, placeholder, rows, store) {
  const box = el('div', 'made-ed');
  const ta = el('textarea', 'made-ed-ta u-area is-s');
  ta.value = value || '';
  ta.placeholder = placeholder;
  ta.rows = rows;
  ta.spellcheck = true;
  const foot = el('div', 'made-ed-foot');
  const said = el('span', 'made-ed-said');
  const save = el('button', 'u-btn is-s made-ed-save', t('Save'));
  save.type = 'button';
  save.hidden = true;
  let kept = ta.value;
  ta.addEventListener('input', () => { save.hidden = ta.value.trim() === kept.trim(); said.textContent = ''; });
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      kept = await store(ta.value);
      ta.value = kept;
      save.hidden = true;
      said.textContent = t('saved');
    } catch (e) { said.textContent = e.message; }
    save.disabled = false;
  });
  foot.append(said, save);
  box.append(ta, foot);
  // What is kept changed elsewhere ("read again"): the box shows it, nothing to save.
  box.setKept = (v) => { kept = String(v || ''); ta.value = kept; save.hidden = true; said.textContent = ''; };
  return box;
}

function _genderRow(it, m) {
  const row = el('div', 'made-ed-chips');
  let cur = GENDERS.includes(m.gender) ? m.gender : '';
  const paint = () => row.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.g === cur));
  for (const g of GENDERS.concat([''])) {
    const b = el('button', 'made-ed-chip u-chip', g ? GENDER_WORD[g] : '—');
    b.type = 'button';
    b.dataset.g = g;
    b.title = g ? GENDER_TITLE[g] : t('Not said');
    b.addEventListener('click', async () => {
      if (g === cur) return;
      const was = cur;
      cur = g;
      paint();
      try { m.gender = (await _patchMeta(it, { gender: g })).gender; }
      catch (e) { cur = was; paint(); b.title = e.message; }
    });
    row.appendChild(b);
  }
  paint();
  return row;
}

/** The rows for the viewer's right column - [label, value or element] - of a picture the generators made; [] for anything else. */
export function madeRows(it) {
  const m = (it && it.meta) || {};
  if (!it || !m.made || !MADE.has(it.kind)) return [];
  if (it.kind === 'props') return _propRows(it, m);
  const rows = [];
  const look = it.kind === 'lookbooks';
  if (look) rows.push([t('gender'), _genderRow(it, m)]);
  rows.push([look ? t('the outfit') : t('the place'), _textRow(m.description, look
    ? t('What it is - not written yet. Optional: the dressing reads it.')
    : t('What the place is - not written yet. Optional: the first frames are composed from it.'), 4,
  async (text) => (m.description = (await _patchMeta(it, { description: text })).description))]);
  if (!look) {
    const how = _textRow(m.motion, t('How it moves - not written yet. The agent writes it the first time a video is filmed here.'), 3,
      async (text) => (m.motion = String(((await post('/api/scen3/env/motion', { path: it.media, motion: text })).entry || {}).motion || '')));
    how.title = t('What moves in the background by itself. Every video filmed here animates by it, word for word - a prompt written with the old words is written again.');
    rows.push([t('how it moves'), how]);
  }
  if (look) {
    // The looks dressed in it - read when the viewer asks (routes/library.js INFO.lookbooks).
    const n = el('span', 'made-ed-looks', '…');
    json('/api/library/info/lookbooks/' + encodeURIComponent(it.id))
      .then((d) => { const k = (d.looks || []).length; n.textContent = k ? tn(k, '{n} dressed in it', '{n} dressed in it') : t('none dressed in it yet'); })
      .catch(() => { n.textContent = '—'; });
    rows.push([t('looks'), n]);
  }
  if (m.from) rows.push([t('made from'), String(m.from).split('/').pop()]);
  return rows;
}

// A PRODUCT of IMAGES -> Props: its name, what the person said about it (kept apart, as
// typed) and the agent's description (English, in sections) - each written by hand here, "save" under it. The frames chat
// reads the name and the description.
function _propRows(it, m) {
  const name = _textRow(it.name || '', t('What it is called'), 1,
    async (text) => { const d = await _patchMeta(it, { name: text }); it.name = d.name || it.name; return d.name; });
  name.classList.add('is-line');
  const words = _textRow(m.words, t('What you know about the product - what it is, its size, what matters to show. Any language.'), 3,
    async (text) => (m.words = (await _patchMeta(it, { words: text })).words));
  const desc = _textRow(m.description, m.reading ? t('describing…') : m.fail ? t('Not described: {why}', { why: m.fail }) : t('Not described yet.'), 8,
    async (text) => (m.description = (await _patchMeta(it, { description: text })).description));
  desc.title = t('What the frames chat is told about this product, in English. Written by the agent from the picture and your words; yours once you edit it.');
  return [[t('name'), name], [t('your words'), words], [t('description'), desc], ['', _readAgain(it, m, desc)]];
}

// "read again": the agent looks at the picture and reads the words as they are saved now, and its
// description REPLACES the one there (written by hand too). The box says "describing…" until it lands.
function _readAgain(it, m, desc) {
  const box = el('div', 'made-ed-foot');
  const said = el('span', 'made-ed-said');
  const b = el('button', 'u-btn is-s made-ed-save', t('Read again'));
  b.type = 'button';
  b.title = t('The agent writes the description anew from the picture and your words (saved) - it replaces the one here');
  const ta = desc.querySelector('textarea');
  const id = encodeURIComponent(it.id);
  const wait = async (n) => {
    if (!b.isConnected) return;
    let d = null;
    try { d = await json('/api/library/info/props/' + id); } catch (e) { said.textContent = e.message; b.disabled = false; return; }
    if (d.reading && n < 240) { setTimeout(() => wait(n + 1), 1500); return; }
    m.description = d.description || '';
    m.fail = d.fail || '';
    m.reading = false;
    desc.setKept(m.description);
    if (ta) ta.placeholder = m.fail ? t('Not described: {why}', { why: m.fail }) : t('Not described yet.');
    said.textContent = m.fail && !d.description ? t('not described') : t('described');
    if (d.name) it.name = d.name;
    b.disabled = false;
  };
  b.addEventListener('click', async () => {
    b.disabled = true;
    said.textContent = t('describing…');
    try { await post('/api/props/' + id + '/read', {}); }
    catch (e) { said.textContent = e.message; b.disabled = false; return; }
    if (ta) { ta.value = ''; ta.placeholder = t('describing…'); }
    wait(0);
  });
  if (m.reading) { b.disabled = true; said.textContent = t('describing…'); setTimeout(() => wait(0), 1500); }
  box.append(said, b);
  return box;
}
