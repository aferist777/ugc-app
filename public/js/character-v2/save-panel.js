// CHARACTER v2 — the save stage's form, in the model column.
//
// Reached from "Save model" at the bottom of that column. While it is up the page is committed
// to finishing one thing, so the two left columns are shut and inert and Cancel is the way out.
// That is the point of a stage rather than a mode.
//
// It has three states and the footer says which one it is in:
//
//   form    the fields are editable      [Cancel] [Save character]
//   saving  the record is being made     both locked
//   saved   the character exists, its 4K sheet is generating in the background
//                                        [Regenerate sheet] [Done]
//
// Cancel disappears once saved, because by then there is nothing to cancel - the character is
// real. What can still go wrong is the sheet, so that is what gets the retry.

const GENDERS = ['female', 'male'];

let _hooks = {};
let _state = 'form';
let _els = {};

function _sec(title) {
  const s = document.createElement('div');
  s.className = 'cv2-save-sec';
  const t = document.createElement('div');
  t.className = 'cv2-save-sec-t';
  t.textContent = title;
  s.appendChild(t);
  return s;
}

function _syncFoot() {
  const { cancel, go, retry } = _els;
  const saving = _state === 'saving';
  cancel.hidden = _state === 'saved';
  retry.hidden = _state !== 'saved';
  cancel.disabled = saving;
  go.disabled = saving || (_state === 'form' && !_els.name.value.trim());
  go.textContent = _state === 'saved' ? 'Done' : (saving ? 'Saving...' : 'Save character');
  _els.name.disabled = _state !== 'form';
  _els.gender.disabled = _state !== 'form';
}

export function build(host, hooks) {
  _hooks = hooks || {};
  host.textContent = '';

  const wrap = document.createElement('div');
  wrap.className = 'cv2-save';

  // ── who it is ──
  const idn = _sec('Identity');
  const nameRow = document.createElement('div');
  nameRow.className = 'cv2-save-row';
  const nameLab = document.createElement('span');
  nameLab.className = 'cv2-save-lab';
  nameLab.textContent = 'Name';
  const name = document.createElement('input');
  name.type = 'text'; name.id = 'cv2-save-name'; name.className = 'cv2-save-in';
  name.placeholder = 'Required';
  name.addEventListener('input', _syncFoot);
  nameRow.appendChild(nameLab); nameRow.appendChild(name);
  idn.appendChild(nameRow);

  const genRow = document.createElement('div');
  genRow.className = 'cv2-save-row';
  const genLab = document.createElement('span');
  genLab.className = 'cv2-save-lab';
  genLab.textContent = 'Gender';
  const gender = document.createElement('select');
  gender.id = 'cv2-save-gender'; gender.className = 'cv2-save-in';
  for (const g of GENDERS) {
    const o = document.createElement('option');
    o.value = g; o.textContent = g;
    gender.appendChild(o);
  }
  genRow.appendChild(genLab); genRow.appendChild(gender);
  idn.appendChild(genRow);
  wrap.appendChild(idn);

  // ── voice ──
  const voice = _sec('Voice');
  const vnote = document.createElement('div');
  vnote.className = 'cv2-save-note';
  vnote.textContent = 'Searching and attaching a voice comes next. A character saved without one can be given a voice later.';
  voice.appendChild(vnote);
  wrap.appendChild(voice);

  // ── the sheet ──
  const sheet = _sec('Reference sheet');
  const snote = document.createElement('div');
  snote.className = 'cv2-save-note';
  snote.textContent = 'A 4K sheet is generated from the image on the left: a large portrait plus '
    + 'three full-body views in a neutral bodysuit. It runs in the background, so saving does not '
    + 'wait for it, and it is what Scenarios reads later.';
  sheet.appendChild(snote);
  const sstat = document.createElement('div');
  sstat.className = 'cv2-save-stat';
  sstat.id = 'cv2-save-stat';
  sheet.appendChild(sstat);
  wrap.appendChild(sheet);

  // ── footer: Cancel to the LEFT of Save character, as asked ──
  const foot = document.createElement('div');
  foot.className = 'cv2-save-foot';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.id = 'cv2-save-cancel'; cancel.className = 'cv2-save-btn';
  cancel.textContent = 'Cancel';
  cancel.title = 'Back to building, and nothing is saved';
  cancel.addEventListener('click', () => { if (_hooks.onCancel) _hooks.onCancel(); });
  const retry = document.createElement('button');
  retry.type = 'button'; retry.id = 'cv2-save-retry'; retry.className = 'cv2-save-btn';
  retry.textContent = 'Regenerate sheet';
  retry.title = 'Submit the 4K sheet again';
  retry.hidden = true;
  retry.addEventListener('click', () => { if (_hooks.onRetrySheet) _hooks.onRetrySheet(); });
  const go = document.createElement('button');
  go.type = 'button'; go.id = 'cv2-save-go'; go.className = 'cv2-save-btn is-go';
  go.textContent = 'Save character';
  go.addEventListener('click', () => {
    if (_state === 'saved') return _hooks.onDone && _hooks.onDone();
    if (_state !== 'form') return;
    const n = name.value.trim();
    if (!n) return;
    if (_hooks.onSave) _hooks.onSave({ name: n, gender: gender.value });
  });
  foot.appendChild(cancel); foot.appendChild(retry); foot.appendChild(go);
  wrap.appendChild(foot);

  host.appendChild(wrap);
  _els = { name, gender, cancel, go, retry, stat: sstat };
  _syncFoot();

  return {
    // Opened afresh each time, so whatever the create column had is what it starts from.
    open: ({ name: n, gender: g } = {}) => {
      _state = 'form';
      name.value = n || '';
      if (g && GENDERS.includes(g)) gender.value = g;
      sstat.textContent = '';
      sstat.className = 'cv2-save-stat';
      _syncFoot();
    },
    state: () => _state,
    setState: (s) => { _state = s; _syncFoot(); },
    status: (text, kind) => {
      sstat.textContent = text || '';
      sstat.className = 'cv2-save-stat' + (kind ? ' ' + kind : '');
    },
    name: () => name.value.trim(),
  };
}
