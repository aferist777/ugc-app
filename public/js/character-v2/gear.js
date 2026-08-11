// CHARACTER v2 — generation settings, behind the gear beside the column title.
//
// Two rows, because the page generates in two directions and they are not the same job: from the
// parameters (text to image) and from a reference (image to image). Each row is a model and a
// quality tier, and the tiers are that model's own vocabulary - 1K/2K/4K, 2K/3K,
// low/medium/high, megapixels - because that is literally what its API accepts. Choosing a model
// re-offers the tiers, keeping the current one when the new model also has it.
//
// The list is fetched rather than written here (GET /api/character-v2/engines), because the
// server builds it from the same table it submits with. Every engine on that list can do 3:2,
// checked against each model's schema. The ratio itself is not a setting: it is what the page is.
//
// No Save button. A setting is not a document - it takes effect on the next generation the
// moment it is chosen, and the choice is remembered in localStorage, which storage-sync mirrors
// to the server so it survives a different browser.

const LS_T2I = 'cv2_t2i_v1';
const LS_I2I = 'cv2_i2i_v1';

let _cfg = null;                     // what the server offers
let _pick = {                        // what is chosen, per direction
  t2i: { engine: '', quality: '' },
  i2i: { engine: '', quality: '' },
};
let _panel = null;

function _load(key, into) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    if (raw && typeof raw === 'object') {
      into.engine = String(raw.engine || '');
      into.quality = String(raw.quality || '');
    }
  } catch (e) {}
}

function _save() {
  try {
    localStorage.setItem(LS_T2I, JSON.stringify(_pick.t2i));
    localStorage.setItem(LS_I2I, JSON.stringify(_pick.i2i));
  } catch (e) {}
}

// A remembered choice can name an engine the server no longer offers, or a tier a model dropped.
// Both are repaired against what is actually on offer rather than passed on to fail at submit.
function _settle(dir) {
  const side = _cfg[dir];
  const list = side.engines;
  let eng = list.find(e => e.id === _pick[dir].engine) || list.find(e => e.id === side.default) || list[0];
  if (!eng) return;
  _pick[dir].engine = eng.id;
  if (!eng.tiers.includes(_pick[dir].quality)) _pick[dir].quality = eng.def;
}

function _row(dir, title, note) {
  const wrap = document.createElement('div');
  wrap.className = 'cv2-gear-row';

  const t = document.createElement('div');
  t.className = 'cv2-gear-t';
  t.textContent = title;
  wrap.appendChild(t);

  const n = document.createElement('div');
  n.className = 'cv2-gear-n';
  n.textContent = note;
  wrap.appendChild(n);

  const line = document.createElement('div');
  line.className = 'cv2-gear-line';

  const model = document.createElement('select');
  model.className = 'cv2-gear-sel';
  model.id = 'cv2-gear-' + dir + '-model';
  for (const e of _cfg[dir].engines) {
    const o = document.createElement('option');
    o.value = e.id; o.textContent = e.label;
    model.appendChild(o);
  }

  const qual = document.createElement('select');
  qual.className = 'cv2-gear-sel is-qual';
  qual.id = 'cv2-gear-' + dir + '-quality';

  const fillTiers = () => {
    const e = _cfg[dir].engines.find(x => x.id === _pick[dir].engine);
    qual.textContent = '';
    for (const tier of (e ? e.tiers : [])) {
      const o = document.createElement('option');
      o.value = tier; o.textContent = tier;
      qual.appendChild(o);
    }
    qual.value = _pick[dir].quality;
  };

  model.addEventListener('change', () => {
    _pick[dir].engine = model.value;
    _settle(dir);                    // the new model may not have the old tier
    fillTiers();
    _save();
  });
  qual.addEventListener('change', () => { _pick[dir].quality = qual.value; _save(); });

  model.value = _pick[dir].engine;
  fillTiers();
  line.appendChild(model); line.appendChild(qual);
  wrap.appendChild(line);
  return wrap;
}

export async function init(host, button) {
  if (!host || !button) return { t2i: () => null, i2i: () => null };

  _load(LS_T2I, _pick.t2i);
  _load(LS_I2I, _pick.i2i);

  try {
    const d = await (await fetch('/api/character-v2/engines')).json();
    if (!d || !d.success) throw new Error('engine list unavailable');
    _cfg = d;
  } catch (e) {
    // Without the list there is nothing honest to show, so the gear stays shut and the server's
    // own defaults are used - which is exactly what sending no engine at all means.
    button.disabled = true;
    button.title = 'Generation settings unavailable: ' + e.message;
    return { t2i: () => null, i2i: () => null };
  }
  _settle('t2i');
  _settle('i2i');
  _save();

  _panel = document.createElement('div');
  _panel.className = 'cv2-gear-panel';
  _panel.id = 'cv2-gear-panel';
  _panel.hidden = true;
  _panel.appendChild(_row('t2i', 'From the parameters', 'Text to image. Built at 3:2.'));
  _panel.appendChild(_row('i2i', 'From a reference', 'Image to image: TPDNE and your own uploads.'));
  const foot = document.createElement('div');
  foot.className = 'cv2-gear-foot';
  foot.textContent = 'Only engines that can do 3:2 are listed. Changes apply to the next generation.';
  _panel.appendChild(foot);
  host.appendChild(_panel);

  const close = () => { _panel.hidden = true; button.classList.remove('is-on'); };
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    _panel.hidden = !_panel.hidden;
    button.classList.toggle('is-on', !_panel.hidden);
  });
  _panel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  return {
    t2i: () => ({ ..._pick.t2i }),
    i2i: () => ({ ..._pick.i2i }),
  };
}
