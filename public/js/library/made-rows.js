// WHAT IS KNOWN ABOUT A MADE PICTURE - the viewer's right column for a picture the generators made, opened from IMAGES ->
// Environments / Lookbooks (the Library's Media and Merge's Library panel).
//
// (phase V55, the owner's (гн9): "открыть (просмотр как на полке, с описанием)"; phase V56, (ги7)) The shelves of
// Environments and Lookbooks went, so what their right column let one WRITE is written here: a lookbook's gender, the
// description, how a place moves (phase V26.8, the owner: "сделай how it moves редактируемым"); and how many looks were
// dressed in a lookbook. (phase V58) It lived in the Library's making chat (js/library/makechat.js), which went when the
// generators became windows (the owner's (лк6)); the rows stayed, word for word.

// (phase V26.6) And IMAGES -> Props: a product's name, the person's own words and the agent's description (_propRows).
const MADE = new Set(['environments', 'lookbooks', 'props']);
const GENDERS = ['male', 'female', 'unisex'];

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
  const ta = el('textarea', 'made-ed-ta');
  ta.value = value || '';
  ta.placeholder = placeholder;
  ta.rows = rows;
  ta.spellcheck = true;
  const foot = el('div', 'made-ed-foot');
  const said = el('span', 'made-ed-said');
  const save = el('button', 'lib-btn made-ed-save', 'save');
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
      said.textContent = 'saved';
    } catch (e) { said.textContent = e.message; }
    save.disabled = false;
  });
  foot.append(said, save);
  box.append(ta, foot);
  return box;
}

function _genderRow(it, m) {
  const row = el('div', 'made-ed-chips');
  let cur = GENDERS.includes(m.gender) ? m.gender : '';
  const paint = () => row.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.g === cur));
  for (const g of GENDERS.concat([''])) {
    const b = el('button', 'made-ed-chip', g || '—');
    b.type = 'button';
    b.dataset.g = g;
    b.title = g ? 'Worn by ' + (g === 'unisex' ? 'either' : 'a ' + g + ' character') : 'Not said';
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
  if (look) rows.push(['gender', _genderRow(it, m)]);
  rows.push([look ? 'the outfit' : 'the place', _textRow(m.description, look
    ? 'What it is - not written yet. Optional: the dressing reads it.'
    : 'What the place is - not written yet. Optional: the first frames are composed from it.', 4,
  async (text) => (m.description = (await _patchMeta(it, { description: text })).description))]);
  if (!look) {
    const how = _textRow(m.motion, 'How it moves - not written yet. The agent writes it the first time a video is filmed here.', 3,
      async (text) => (m.motion = String(((await post('/api/scen3/env/motion', { path: it.media, motion: text })).entry || {}).motion || '')));
    how.title = 'What moves in the background by itself. Every video filmed here animates by it, word for word -'
      + ' a prompt written with the old words is written again.';
    rows.push(['how it moves', how]);
  }
  if (look) {
    // The looks dressed in it - read when the viewer asks (routes/library.js INFO.lookbooks).
    const n = el('span', 'made-ed-looks', '…');
    json('/api/library/info/lookbooks/' + encodeURIComponent(it.id))
      .then((d) => { const k = (d.looks || []).length; n.textContent = k ? k + ' dressed in it' : 'none dressed in it yet'; })
      .catch(() => { n.textContent = '—'; });
    rows.push(['looks', n]);
  }
  if (m.from) rows.push(['made from', String(m.from).split('/').pop()]);
  return rows;
}

// (phase V26.6, the owner's (п4)) A PRODUCT of IMAGES -> Props: its name, what the person said about it (kept apart, as
// typed) and the agent's description (English, in sections) - each written by hand here, "save" under it. The frames chat
// reads the name and the description.
function _propRows(it, m) {
  const name = _textRow(it.name || '', 'What it is called', 1,
    async (text) => { const d = await _patchMeta(it, { name: text }); it.name = d.name || it.name; return d.name; });
  name.classList.add('is-line');
  const words = _textRow(m.words, 'What you know about the product - what it is, its size, what matters to show. Any language.', 3,
    async (text) => (m.words = (await _patchMeta(it, { words: text })).words));
  const desc = _textRow(m.description, m.reading ? 'describing…' : 'Not described yet.', 8,
    async (text) => (m.description = (await _patchMeta(it, { description: text })).description));
  desc.title = 'What the frames chat is told about this product, in English. Written by the agent from the picture and your words; yours once you edit it.';
  return [['name', name], ['your words', words], ['description', desc]];
}
