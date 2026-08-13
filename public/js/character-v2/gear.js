// CHARACTER v2 — generation settings, behind the gears.
//
// TWO gears, because the page makes two different things and they are not the same decision.
//
//   Create model   the portrait being built: text to image, and image to image.
//   Portrait       the 4K reference sheet - the character's one canonical asset, the thing
//                  every scene is later built from. It used to be un-settable: hard-wired to
//                  nano-banana-2 at 4K, with no way to say otherwise from the page.
//
// Each row is three choices: WHO is asked, WHAT draws it, and HOW GOOD. The aggregator comes
// first, on the left, because it decides what the model list can contain - not every engine is on
// every aggregator. It exists at all because the two fail separately: the day google/nano-banana-2
// answered ModelRateLimitError on Replicate, the same model answered with an image through
// OpenRouter. One model, three doors.
//
// Tiers are that model's own vocabulary - 1K/2K/4K, 2K/3K, low/medium/high, megapixels - because
// that is literally what its API accepts. Choosing a model re-offers the tiers, keeping the
// current one when the new model also has it.
//
// The list is fetched rather than written here (GET /api/character-v2/engines), because the
// server builds it from the same table it submits with. The ratio itself is not a setting: it is
// what the page is.
//
// No Save button on the settings. A setting is not a document - it takes effect on the next
// generation the moment it is chosen, and the choice is remembered in localStorage, which
// storage-sync mirrors to the server so it survives a different browser. The sheet's panel does
// carry ONE button, because generating a 4K sheet is neither instant nor free: that is an action,
// not a setting.

const LS_T2I = 'cv2_t2i_v2';
const LS_I2I = 'cv2_i2i_v2';
const LS_SHEET = 'cv2_sheet_v1';
const LS_OLD = { t2i: 'cv2_t2i_v1', i2i: 'cv2_i2i_v1' };

let _cfg = null;                     // what the server offers
let _cfgP = null;                    // fetched once, awaited by both gears
let _pick = {                        // what is chosen, per direction
  t2i: { provider: '', engine: '', quality: '' },
  i2i: { provider: '', engine: '', quality: '' },
};
// The sheet is an edit of a face, so it lives on the i2i list - but it is its own choice, at its
// own tier, and 4K is the point of it.
let _sheet = { provider: '', engine: '', quality: '' };
const SHEET_PREFER = { engine: 'nano-banana-2', quality: '4K' };

function _config() {
  if (!_cfgP) {
    _cfgP = fetch('/api/character-v2/engines')
      .then(r => r.json())
      .then(d => {
        if (!d || !d.success) throw new Error('engine list unavailable');
        _cfg = d;
        return d;
      });
  }
  return _cfgP;
}

// v1 held { engine, quality } and knew nothing about aggregators; reading it keeps a remembered
// model through the upgrade instead of resetting everyone to the default.
function _load(keys, into) {
  for (const k of keys) {
    if (!k) continue;
    try {
      const raw = JSON.parse(localStorage.getItem(k) || 'null');
      if (raw && typeof raw === 'object' && raw.engine) {
        into.provider = String(raw.provider || '');
        into.engine = String(raw.engine || '');
        into.quality = String(raw.quality || '');
        return;
      }
    } catch (e) {}
  }
}
const _put = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} };
function _save() {
  _put(LS_T2I, _pick.t2i);
  _put(LS_I2I, _pick.i2i);
  _put(LS_SHEET, _sheet);
}

// A remembered choice can name an engine the server no longer offers, a tier a model dropped, or
// an aggregator that never carried it. All three are repaired against what is actually on offer
// rather than passed on to fail at submit.
function _settle(dir, p, prefer) {
  const side = _cfg[dir];
  const list = side.engines;
  if (!list.length) return;
  const want = (prefer && prefer.engine) || side.default;
  const eng = list.find(e => e.id === p.engine) || list.find(e => e.id === want) || list[0];
  p.engine = eng.id;
  if (!eng.providers.includes(p.provider)) {
    p.provider = eng.providers.includes(_cfg.defaultProvider) ? _cfg.defaultProvider : eng.providers[0];
  }
  if (!eng.tiers.includes(p.quality)) {
    const pq = prefer && prefer.quality;
    p.quality = (pq && eng.tiers.includes(pq)) ? pq : eng.def;
  }
}

function _opt(sel, value, label) {
  const o = document.createElement('option');
  o.value = value; o.textContent = label;
  sel.appendChild(o);
}

// The three selects, wired to one choice object. Shared by both gears so they behave the same:
// pick the aggregator, and the model list becomes what that aggregator can actually serve.
function _line(dir, p, idPrefix, prefer) {
  const line = document.createElement('div');
  line.className = 'cv2-gear-line';

  const list = _cfg[dir].engines;
  // Only the aggregators that serve something in THIS direction: kie.ai has no image-to-image
  // seedream, so offering it there would be offering an empty model list.
  const provs = _cfg.providers.filter(x => list.some(e => e.providers.includes(x.id)));

  const prov = document.createElement('select');
  prov.className = 'cv2-gear-sel is-prov';
  prov.id = idPrefix + '-provider';
  for (const x of provs) _opt(prov, x.id, x.label);

  const model = document.createElement('select');
  model.className = 'cv2-gear-sel';
  model.id = idPrefix + '-model';

  const qual = document.createElement('select');
  qual.className = 'cv2-gear-sel is-qual';
  qual.id = idPrefix + '-quality';

  const fillModels = () => {
    model.textContent = '';
    for (const e of list.filter(e => e.providers.includes(p.provider))) _opt(model, e.id, e.label);
    model.value = p.engine;
  };
  const fillTiers = () => {
    const e = list.find(x => x.id === p.engine);
    qual.textContent = '';
    for (const tier of (e ? e.tiers : [])) _opt(qual, tier, tier);
    qual.value = p.quality;
  };
  const repaint = () => { fillModels(); fillTiers(); prov.value = p.provider; };

  prov.addEventListener('change', () => {
    p.provider = prov.value;
    // Switching aggregator can leave the current model behind - kie.ai has no flux, Replicate has
    // everything. Land on that aggregator's first engine rather than on nothing.
    const serves = list.filter(e => e.providers.includes(prov.value));
    if (serves.length && !serves.some(e => e.id === p.engine)) p.engine = serves[0].id;
    _settle(dir, p, prefer);
    repaint(); _save();
  });
  model.addEventListener('change', () => {
    p.engine = model.value;
    _settle(dir, p, prefer);         // the new model may not have the old tier or the old aggregator
    repaint(); _save();
  });
  qual.addEventListener('change', () => { p.quality = qual.value; _save(); });

  repaint();
  line.appendChild(prov); line.appendChild(model); line.appendChild(qual);
  // Handed back up so an owner can put the selects back where it wants them - the sheet gear
  // returns to nano-banana-2 after every run.
  line._repaint = repaint;
  return line;
}

function _row(dir, title, note, p, idPrefix, prefer) {
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

  const line = _line(dir, p, idPrefix, prefer);
  wrap.appendChild(line);
  wrap._repaint = line._repaint;
  return wrap;
}

// One panel, opened and shut by one button, closing on a click anywhere else or on Escape.
function _panelFor(host, button, build) {
  const panel = document.createElement('div');
  panel.className = 'cv2-gear-panel';
  panel.hidden = true;
  build(panel);
  host.appendChild(panel);

  const close = () => { panel.hidden = true; button.classList.remove('is-on'); };
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    button.classList.toggle('is-on', !panel.hidden);
  });
  panel.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return { panel, close };
}

// ── The Create gear: the portrait being built ───────────────────────────────
export async function init(host, button) {
  if (!host || !button) return { t2i: () => null, i2i: () => null };

  _load([LS_T2I, LS_OLD.t2i], _pick.t2i);
  _load([LS_I2I, LS_OLD.i2i], _pick.i2i);

  try {
    await _config();
  } catch (e) {
    // Without the list there is nothing honest to show, so the gear stays shut and the server's
    // own defaults are used - which is exactly what sending no engine at all means.
    button.disabled = true;
    button.title = 'Generation settings unavailable: ' + e.message;
    return { t2i: () => null, i2i: () => null };
  }
  _settle('t2i', _pick.t2i);
  _settle('i2i', _pick.i2i);
  _save();

  _panelFor(host, button, (panel) => {
    panel.id = 'cv2-gear-panel';
    panel.appendChild(_row('t2i', 'From the parameters', 'Text to image. Built at 3:2.', _pick.t2i, 'cv2-gear-t2i'));
    panel.appendChild(_row('i2i', 'From a reference', 'Image to image: TPDNE and your own uploads.', _pick.i2i, 'cv2-gear-i2i'));
    const foot = document.createElement('div');
    foot.className = 'cv2-gear-foot';
    foot.textContent = 'Aggregator, then model, then quality. The same model can be up on one aggregator '
      + 'and rate-limited on another. Changes apply to the next generation.';
    panel.appendChild(foot);
  });

  return {
    t2i: () => ({ ..._pick.t2i }),
    i2i: () => ({ ..._pick.i2i }),
  };
}

// ── The Portrait gear: the 4K reference sheet ───────────────────────────────
// Settings AND the button that uses them, in one place. Regenerating the sheet was only
// reachable during the save stage, which is the one moment you are least likely to want it -
// the sheet you want to redo is usually one you saved yesterday.
export async function initSheet(host, button, opts = {}) {
  if (!host || !button) return { get: () => null };
  _load([LS_SHEET], _sheet);
  try {
    await _config();
  } catch (e) {
    button.disabled = true;
    button.title = 'Sheet settings unavailable: ' + e.message;
    return { get: () => null };
  }
  _settle('i2i', _sheet, SHEET_PREFER);
  _save();

  let go = null;
  let row = null;
  const { close } = _panelFor(host, button, (panel) => {
    panel.id = 'cv2-sheet-panel';
    row = _row('i2i', '4K reference sheet',
      'The character\'s canonical asset: portrait plus full-body turnaround, 16:9.',
      _sheet, 'cv2-sheet', SHEET_PREFER);
    panel.appendChild(row);

    go = document.createElement('button');
    go.type = 'button';
    go.className = 'cv2-gear-go';
    go.id = 'cv2-sheet-go';
    go.textContent = 'Generate 4K sheet';
    go.title = 'Regenerate this character\'s reference sheet with the settings above';
    go.addEventListener('click', () => {
      close();
      if (opts.onGenerate) opts.onGenerate({ ..._sheet });
    });
    panel.appendChild(go);

    const foot = document.createElement('div');
    foot.className = 'cv2-gear-foot';
    foot.textContent = 'Regenerates from the current sheet when there is one, and from the saved face when '
      + 'there is not. Costs one generation.';
    panel.appendChild(foot);
  });

  return {
    get: () => ({ ..._sheet }),
    // Nothing to generate for without a saved character, and a button that refuses is worse than
    // one that says so by being unavailable. `why` becomes its tooltip, so the reason is a hover
    // away rather than a guess - the settings above stay usable either way, because they are what
    // Save will generate the sheet with.
    setEnabled: (on, why) => {
      if (!go) return;
      go.disabled = !on;
      go.title = on
        ? 'Regenerate this character\'s reference sheet with the settings above'
        : (why || 'Select a saved character first');
    },
    // Back to the house engine once a run is over, win or lose. The sheet's model is
    // nano-banana-2; anything else is a one-off - a deliberate try of gpt-image-2, a way around
    // an aggregator that is refusing - and a one-off that quietly stays selected would draw every
    // future character with whatever was last experimented with. The AGGREGATOR is kept: it is
    // chosen because one of them is up today, and that answer is still true on the next run.
    reset: () => {
      _sheet.engine = SHEET_PREFER.engine;
      _sheet.quality = SHEET_PREFER.quality;
      _settle('i2i', _sheet, SHEET_PREFER);
      if (row && row._repaint) row._repaint();
      _save();
    },
    close,
  };
}
